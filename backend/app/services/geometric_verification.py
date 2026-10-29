"""Conservative one-view geometry for the controlled registered 2x4-brick mode."""

import base64
import hashlib
from dataclasses import dataclass
from io import BytesIO

import cv2
import numpy as np
from PIL import Image
from sqlalchemy.engine import Engine
from sqlmodel import Session, select

from app.core.config import Settings
from app.db.tables import BuildingBlock, StepSpatialConstraint
from app.models.calibration import BoardPose, CalibrationProfile
from app.models.diagnosis import AnalyzedSnapshot
from app.models.geometry import (
    BoardPoint,
    GeometricVerificationResult,
    GeometryEvidence,
    GeometryFormContext,
    ImagePoint,
    ImageSegment,
    MeasurementAxis,
    StudFeature,
    StudOffsetConstraintRead,
)
from app.services.calibration_store import CalibrationStore
from app.services.charuco_vision import detect, estimate_pose, image_to_board_surface
from app.services.image_processor import ProcessedImage
from app.services.project_service import require_step

STUD_PITCH_MM = 8.0
SUPPORTED_COLORS = {
    "red": ((0, 75, 45), (10, 255, 255), (170, 75, 45), (179, 255, 255)),
    "orange": ((8, 70, 50), (24, 255, 255)),
    "yellow": ((20, 65, 55), (40, 255, 255)),
    "green": ((38, 50, 35), (90, 255, 255)),
    "blue": ((90, 55, 35), (135, 255, 255)),
}


@dataclass(frozen=True)
class GeometrySpecification:
    step_id: str
    constraint: StudOffsetConstraintRead | None
    target_color: str | None = None
    reference_color: str | None = None
    support_error: str | None = None


@dataclass(frozen=True)
class FittedGrid:
    center: np.ndarray
    long_axis: np.ndarray
    pitch_mm: float
    residual_mm: float


def load_specification(session: Session, project_id: str, step_id: str) -> GeometrySpecification:
    require_step(session, project_id, step_id)
    row = session.exec(
        select(StepSpatialConstraint).where(StepSpatialConstraint.step_id == step_id)
    ).first()
    if row is None:
        return GeometrySpecification(step_id=step_id, constraint=None)
    target = session.get(BuildingBlock, row.target_block_id)
    reference = session.get(BuildingBlock, row.reference_block_id)
    if target is None or reference is None:
        return GeometrySpecification(
            step_id=step_id,
            constraint=StudOffsetConstraintRead.model_validate(
                row.model_dump(exclude={"step_id"})
            ),
            support_error="A constrained registered block no longer exists.",
        )
    def supported(block):
        return (
            block.shape.lower() == "rectangular"
            and sorted((block.studs_x or 0, block.studs_y or 0)) == [2, 4]
            and block.height_mm is not None
            and block.height_mm > 0
            and block.color.lower() in SUPPORTED_COLORS
        )

    support_error = None
    if not supported(target) or not supported(reference):
        support_error = "A constrained block changed and is no longer supported; update the step."
    elif target.color.lower() == reference.color.lower():
        support_error = (
            "Target and reference colors are no longer distinguishable; update the step."
        )
    return GeometrySpecification(
        step_id=step_id,
        constraint=StudOffsetConstraintRead.model_validate(row.model_dump(exclude={"step_id"})),
        target_color=target.color.lower(),
        reference_color=reference.color.lower(),
        support_error=support_error,
    )


def color_mask(rgb: np.ndarray, color: str) -> np.ndarray:
    ranges = SUPPORTED_COLORS.get(color.lower())
    if ranges is None:
        raise ValueError("Unsupported registered block color")
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    mask = np.zeros(hsv.shape[:2], np.uint8)
    for index in range(0, len(ranges), 2):
        mask = cv2.bitwise_or(
            mask,
            cv2.inRange(hsv, np.array(ranges[index]), np.array(ranges[index + 1])),
        )
    kernel = np.ones((3, 3), np.uint8)
    return cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)


def validate_feature_mask(mask: np.ndarray, image_shape: tuple[int, int]) -> np.ndarray:
    if (
        not isinstance(mask, np.ndarray)
        or mask.ndim != 2
        or mask.shape != image_shape
        or mask.dtype not in (np.uint8, np.bool_)
    ):
        raise ValueError("Segmentation mask must be a matching two-dimensional byte mask")
    binary = (mask > 0).astype(np.uint8) * 255
    if cv2.countNonZero(binary) < 100:
        raise ValueError("Segmentation mask has insufficient visible area")
    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary)
    if count < 2:
        raise ValueError("Segmentation mask has no block component")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    component = np.where(labels == largest, 255, 0).astype(np.uint8)
    if stats[largest, cv2.CC_STAT_AREA] < 0.002 * image_shape[0] * image_shape[1]:
        raise ValueError("Visible block region is too small")
    return component


def detect_stud_centers(
    rgb: np.ndarray, mask: np.ndarray, allowed_counts: tuple[int, ...] = (8,)
) -> np.ndarray:
    """Find circular local contrast features inside one validated block mask."""

    component = validate_feature_mask(mask, rgb.shape[:2])
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    x, y, width, height = cv2.boundingRect(component)
    minimum_radius = max(2, round(min(width, height) / 18))
    maximum_radius = max(minimum_radius + 1, round(min(width, height) / 4))
    blurred = cv2.GaussianBlur(gray, (0, 0), 1.2)
    circles = cv2.HoughCircles(
        blurred,
        cv2.HOUGH_GRADIENT,
        dp=1,
        minDist=max(4, min(width, height) / 5),
        param1=70,
        param2=10,
        minRadius=minimum_radius,
        maxRadius=maximum_radius,
    )
    candidates: list[tuple[float, float]] = []
    if circles is not None:
        for center_x, center_y, radius in circles[0]:
            ix, iy = round(float(center_x)), round(float(center_y))
            if (
                0 <= iy < component.shape[0]
                and 0 <= ix < component.shape[1]
                and component[iy, ix]
                and cv2.countNonZero(
                    component[
                        max(0, iy - round(radius)) : iy + round(radius) + 1,
                        max(0, ix - round(radius)) : ix + round(radius) + 1,
                    ]
                )
                > 0
            ):
                candidates.append((float(center_x), float(center_y)))
    if len(candidates) not in allowed_counts:
        expected = ", ".join(str(count) for count in allowed_counts)
        raise ValueError(
            f"Expected {expected} visible studs but found {len(candidates)}; "
            "capture a sharp unobstructed top-down view"
        )
    return np.asarray(candidates, dtype=np.float64)


def _cluster_means(values: np.ndarray, cluster_count: int) -> tuple[np.ndarray, np.ndarray]:
    order = np.argsort(values)
    groups = np.array_split(order, cluster_count)
    if any(len(group) == 0 for group in groups):
        raise ValueError("Incomplete stud grid")
    means = np.asarray([values[group].mean() for group in groups])
    assignments = np.empty(len(values), dtype=int)
    for index, group in enumerate(groups):
        assignments[group] = index
    return means, assignments


def fit_2x4_grid(points_mm: np.ndarray, positive_direction: str) -> FittedGrid:
    if points_mm.shape != (8, 2) or not np.isfinite(points_mm).all():
        raise ValueError("A complete finite 2x4 stud pattern is required")
    center = points_mm.mean(axis=0)
    covariance = np.cov(points_mm - center, rowvar=False)
    values, vectors = np.linalg.eigh(covariance)
    if values[1] <= 2 * values[0] or values[0] <= 0:
        raise ValueError("Stud pattern orientation is ambiguous")
    long_axis = vectors[:, 1]
    preferred = (
        np.array([1.0, 0.0])
        if positive_direction == "board_positive_x"
        else np.array([0.0, 1.0])
    )
    if float(np.dot(long_axis, preferred)) < 0:
        long_axis = -long_axis
    short_axis = np.array([-long_axis[1], long_axis[0]])
    longitudinal = (points_mm - center) @ long_axis
    transverse = (points_mm - center) @ short_axis
    long_means, long_group = _cluster_means(longitudinal, 4)
    short_means, short_group = _cluster_means(transverse, 2)
    long_steps = np.diff(long_means)
    short_steps = np.diff(short_means)
    pitch = float(np.median(np.concatenate([long_steps, short_steps])))
    ideal = np.column_stack([long_means[long_group], short_means[short_group]])
    actual = np.column_stack([longitudinal, transverse])
    residual = float(np.sqrt(np.mean(np.sum((actual - ideal) ** 2, axis=1))))
    if not 7.2 <= pitch <= 8.8 or residual > 0.75:
        raise ValueError("Detected pattern is inconsistent with an 8 mm 2x4 stud grid")
    return FittedGrid(center=center, long_axis=long_axis, pitch_mm=pitch, residual_mm=residual)


def fit_partial_reference_grid(points_mm: np.ndarray, target: FittedGrid) -> FittedGrid:
    """Recover a known 2x4 reference center from contiguous exposed end columns."""

    if (
        points_mm.ndim != 2
        or points_mm.shape[1] != 2
        or len(points_mm) not in {2, 4, 6, 8}
        or not np.isfinite(points_mm).all()
    ):
        raise ValueError("Reference needs one to four complete visible two-stud columns")
    if len(points_mm) == 8:
        direction = (
            "board_positive_x"
            if abs(target.long_axis[0]) >= abs(target.long_axis[1])
            else "board_positive_y"
        )
        fitted = fit_2x4_grid(points_mm, direction)
        if float(np.dot(fitted.long_axis, target.long_axis)) < 0:
            fitted = FittedGrid(
                fitted.center,
                -fitted.long_axis,
                fitted.pitch_mm,
                fitted.residual_mm,
            )
        return fitted
    visible_center = points_mm.mean(axis=0)
    long_axis = target.long_axis
    short_axis = np.array([-long_axis[1], long_axis[0]])
    longitudinal = (points_mm - visible_center) @ long_axis
    transverse = (points_mm - visible_center) @ short_axis
    columns = len(points_mm) // 2
    long_means, long_group = _cluster_means(longitudinal, columns)
    short_means, short_group = _cluster_means(transverse, 2)
    steps = [*np.diff(long_means), *np.diff(short_means)]
    pitch = float(np.median(steps))
    ideal = np.column_stack([long_means[long_group], short_means[short_group]])
    actual = np.column_stack([longitudinal, transverse])
    residual = float(np.sqrt(np.mean(np.sum((actual - ideal) ** 2, axis=1))))
    if not 7.2 <= pitch <= 8.8 or residual > 0.75:
        raise ValueError("Visible reference studs do not form contiguous 8 mm columns")
    target_side = float(np.dot(target.center - visible_center, long_axis))
    if abs(target_side) < STUD_PITCH_MM / 2:
        raise ValueError("Visible reference end cannot be associated unambiguously")
    full_positions = np.array([-12.0, -4.0, 4.0, 12.0])
    visible_positions = full_positions[:columns] if target_side > 0 else full_positions[-columns:]
    center = visible_center - float(visible_positions.mean()) * long_axis
    return FittedGrid(
        center=center,
        long_axis=long_axis,
        pitch_mm=pitch,
        residual_mm=residual + (4 - columns) * 0.1,
    )


def compare_offset(
    reference: FittedGrid,
    target: FittedGrid,
    expected_studs: float,
    tolerance_studs: float,
    calibration_error_mm: float,
) -> tuple[float, float, float, str]:
    alignment = abs(float(np.dot(reference.long_axis, target.long_axis)))
    if alignment < np.cos(np.deg2rad(10)):
        raise ValueError("Target and reference stud axes are not reliably aligned")
    observed = float(np.dot(target.center - reference.center, reference.long_axis) / STUD_PITCH_MM)
    deviation = observed - expected_studs
    uncertainty = max(
        0.03,
        2 * (reference.residual_mm + target.residual_mm + calibration_error_mm) / STUD_PITCH_MM,
    )
    error = abs(deviation)
    if error + uncertainty <= tolerance_studs:
        status = "correct"
    elif max(0.0, error - uncertainty) > tolerance_studs:
        status = "incorrect"
    else:
        status = "uncertain"
    return observed, deviation, uncertainty, status


def _snapshot(image: ProcessedImage) -> tuple[str, AnalyzedSnapshot]:
    digest = hashlib.sha256(image.jpeg_bytes).hexdigest()
    return digest, AnalyzedSnapshot(
        data_url="data:image/jpeg;base64," + base64.b64encode(image.jpeg_bytes).decode("ascii"),
        width=image.width,
        height=image.height,
    )


def _not_measured(
    spec: GeometrySpecification,
    guidance: str,
    *,
    geometry_status: str = "not_measured",
    limitations: list[str] | None = None,
) -> GeometricVerificationResult:
    constraint = spec.constraint
    return GeometricVerificationResult(
        step_id=spec.step_id,
        constraint_id=constraint.id if constraint else None,
        measurement_status="not_measured",
        geometry_status=geometry_status,
        constraint_type=constraint.constraint_type if constraint else None,
        axis=constraint.axis if constraint else None,
        expected_studs=constraint.expected_stud_offset if constraint else None,
        tolerance_studs=constraint.tolerance_studs if constraint else None,
        guidance=guidance,
        limitations=limitations or [],
    )


class GeometricVerifier:
    def __init__(self, engine: Engine, settings: Settings):
        self.engine = engine
        self.settings = settings

    def specification(self, project_id: str, step_id: str) -> GeometrySpecification:
        with Session(self.engine) as session:
            return load_specification(session, project_id, step_id)

    def verify(
        self,
        project_id: str,
        step_id: str,
        image: ProcessedImage,
        context: GeometryFormContext,
    ) -> GeometricVerificationResult:
        spec = self.specification(project_id, step_id)
        if spec.constraint is None:
            return _not_measured(spec, "This step has no geometric constraint.")
        if spec.support_error:
            return _not_measured(spec, spec.support_error, geometry_status="uncertain")
        if (
            context.profile_id is None
            or context.camera is None
            or not context.configuration_confirmed
        ):
            return _not_measured(
                spec,
                "Select a calibration profile and confirm the unchanged camera configuration.",
                geometry_status="uncertain",
                limitations=["Metric geometry requires a confirmed matching calibration."],
            )
        try:
            profile = CalibrationStore(self.settings.calibration_path).load(context.profile_id)
        except FileNotFoundError:
            return _not_measured(
                spec,
                "Calibration profile was not found; calibrate this camera.",
                geometry_status="uncertain",
            )
        except (ValueError, OSError):
            return _not_measured(
                spec,
                "Calibration profile is invalid; recalibrate this camera.",
                geometry_status="uncertain",
            )
        if profile.camera != context.camera or (image.width, image.height) != (
            context.camera.width,
            context.camera.height,
        ):
            return _not_measured(
                spec,
                "Camera profile or native image resolution does not match this capture.",
                geometry_status="uncertain",
            )
        try:
            board_detection = detect(image)
            pose = estimate_pose(board_detection, profile)
            return self._measure(spec, image, profile, pose)
        except (ValueError, cv2.error) as exc:
            return _not_measured(
                spec,
                str(exc),
                geometry_status="uncertain",
                limitations=["No numeric result is returned without complete validated evidence."],
            )

    def _measure(
        self,
        spec: GeometrySpecification,
        image: ProcessedImage,
        profile: CalibrationProfile,
        pose: BoardPose,
    ) -> GeometricVerificationResult:
        constraint = spec.constraint
        assert constraint is not None and spec.target_color and spec.reference_color
        with Image.open(BytesIO(image.jpeg_bytes)) as source:
            rgb = np.asarray(source.convert("RGB"))
        target_pixels = detect_stud_centers(rgb, color_mask(rgb, spec.target_color))
        reference_pixels = detect_stud_centers(
            rgb,
            color_mask(rgb, spec.reference_color),
            allowed_counts=(2, 4, 6, 8),
        )
        target_board = np.asarray(
            image_to_board_surface(
                target_pixels.tolist(),
                profile,
                pose,
                surface_z_mm=constraint.target_surface_height_mm,
            )
        )
        reference_board = np.asarray(
            image_to_board_surface(
                reference_pixels.tolist(),
                profile,
                pose,
                surface_z_mm=constraint.reference_surface_height_mm,
            )
        )
        target_grid = fit_2x4_grid(target_board, constraint.positive_direction)
        reference_grid = fit_partial_reference_grid(reference_board, target_grid)
        focal = min(profile.camera_matrix[0][0], profile.camera_matrix[1][1])
        camera_distance = abs(float(np.asarray(pose.translation_mm)[2]))
        calibration_error_mm = (
            (profile.reprojection_rms_px + pose.reprojection_rms_px)
            * camera_distance
            / focal
        )
        observed, deviation, uncertainty, status = compare_offset(
            reference_grid,
            target_grid,
            constraint.expected_stud_offset,
            constraint.tolerance_studs,
            calibration_error_mm,
        )
        digest, analyzed = _snapshot(image)
        axis_board = np.array(
            [
                [
                    *(reference_grid.center - 1.5 * STUD_PITCH_MM * reference_grid.long_axis),
                    constraint.reference_surface_height_mm,
                ],
                [
                    *(reference_grid.center + 1.5 * STUD_PITCH_MM * reference_grid.long_axis),
                    constraint.reference_surface_height_mm,
                ],
            ]
        )
        axis_pixels = cv2.projectPoints(
            axis_board,
            np.asarray(pose.rvec),
            np.asarray(pose.translation_mm),
            np.asarray(profile.camera_matrix),
            np.asarray(profile.distortion),
        )[0].reshape(-1, 2)
        features = [
            StudFeature(
                block_id=block_id,
                role=role,
                image=ImagePoint(x_px=float(pixel[0]), y_px=float(pixel[1])),
                board=BoardPoint(
                    x_mm=float(board[0]), y_mm=float(board[1]), z_mm=surface_height
                ),
            )
            for block_id, role, pixels, boards, surface_height in (
                (
                    constraint.target_block_id,
                    "target",
                    target_pixels,
                    target_board,
                    constraint.target_surface_height_mm,
                ),
                (
                    constraint.reference_block_id,
                    "reference",
                    reference_pixels,
                    reference_board,
                    constraint.reference_surface_height_mm,
                ),
            )
            for pixel, board in zip(pixels, boards, strict=True)
        ]
        return GeometricVerificationResult(
            step_id=spec.step_id,
            constraint_id=constraint.id,
            measurement_status="measured",
            geometry_status=status,
            constraint_type=constraint.constraint_type,
            axis=constraint.axis,
            expected_studs=constraint.expected_stud_offset,
            observed_studs=observed,
            deviation_studs=deviation,
            uncertainty_studs=uncertainty,
            observed_mm=observed * STUD_PITCH_MM,
            deviation_mm=deviation * STUD_PITCH_MM,
            tolerance_studs=constraint.tolerance_studs,
            evidence=GeometryEvidence(
                calibration_profile_id=profile.id,
                snapshot_id=digest,
                calibration_valid=True,
                board_pose_valid=True,
                target_feature_count=len(target_pixels),
                reference_feature_count=len(reference_pixels),
                features=features,
                reference_axis=MeasurementAxis(
                    origin=BoardPoint(
                        x_mm=float(reference_grid.center[0]),
                        y_mm=float(reference_grid.center[1]),
                        z_mm=constraint.reference_surface_height_mm,
                    ),
                    unit_x=float(reference_grid.long_axis[0]),
                    unit_y=float(reference_grid.long_axis[1]),
                ),
                reference_axis_image=ImageSegment(
                    start=ImagePoint(
                        x_px=float(axis_pixels[0][0]), y_px=float(axis_pixels[0][1])
                    ),
                    end=ImagePoint(
                        x_px=float(axis_pixels[1][0]), y_px=float(axis_pixels[1][1])
                    ),
                ),
            ),
            analyzed_snapshot=analyzed,
            guidance=(
                "Placement is within the configured tolerance."
                if status == "correct"
                else (
                    "Move the target along the displayed signed reference axis to the "
                    "expected offset."
                )
                if status == "incorrect"
                else (
                    "The uncertainty interval overlaps the configured tolerance; capture a "
                    "sharper, closer top-down image."
                )
            ),
            limitations=[
                "Supported mode: two color-distinct registered 2x4 blocks; all target studs "
                "and at least one complete exposed reference column must be visible.",
                "Known block heights and one calibrated board pose are required.",
            ],
        )
