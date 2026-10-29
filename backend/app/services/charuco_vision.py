"""OpenCV geometry on Pillow-validated, oriented, unscaled images.

Board: origin top-left outer corner, +X right, +Y down, Z=0 on print.
OpenCV camera: +X right, +Y down, +Z forward. All 3D units are millimeters.
No function in this module locates elevated LEGO surfaces.
"""

import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime
from io import BytesIO
from uuid import uuid4

import cv2
import numpy as np
from PIL import Image

from app.models.calibration import (
    DEFAULT_BOARD,
    BoardPose,
    BoardSpec,
    CalibrationProfile,
    CameraConfiguration,
    CaptureAssessment,
    DetectedCorner,
    validate_print,
)
from app.services.image_processor import ProcessedImage


def make_board(spec: BoardSpec = DEFAULT_BOARD):
    dictionary = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, spec.dictionary))
    return cv2.aruco.CharucoBoard(
        (spec.squares_x, spec.squares_y), spec.square_mm, spec.marker_mm, dictionary
    )


def board_image(spec=DEFAULT_BOARD, dpi=300) -> Image.Image:
    if not 72 <= dpi <= 600:
        raise ValueError("DPI must be between 72 and 600")
    size = tuple(round(n * spec.square_mm / 25.4 * dpi) for n in (spec.squares_x, spec.squares_y))
    if size[0] * size[1] > 25_000_000:
        raise ValueError("Printable image is too large")
    return Image.fromarray(make_board(spec).generateImage(size, marginSize=0, borderBits=1))


@dataclass
class Detection:
    image: ProcessedImage
    points: np.ndarray
    ids: np.ndarray
    markers: int
    ambiguous: bool
    sharpness: float
    coverage: float
    board_id: str


def detect(image: ProcessedImage, spec=DEFAULT_BOARD) -> Detection:
    # Pillow remains the trust boundary; OpenCV receives its already decoded JPEG.
    with Image.open(BytesIO(image.jpeg_bytes)) as pil:
        gray = np.asarray(pil.convert("L"))
    board = make_board(spec)
    points, ids, _, markers = cv2.aruco.CharucoDetector(board).detectBoard(gray)
    marker_ids = markers.flatten().tolist() if markers is not None else []
    ambiguous = len(set(marker_ids)) != len(marker_ids) or not set(marker_ids).issubset(
        set(board.getIds().flatten().tolist())
    )
    points = points.reshape(-1, 2) if points is not None else np.empty((0, 2), np.float32)
    ids = ids.flatten() if ids is not None else np.empty(0, np.int32)
    if (
        len(set(ids.tolist())) != len(ids)
        or not np.isfinite(points).all()
        or (
            len(points)
            and (
                np.any(points < 0)
                or np.any(points[:, 0] >= image.width)
                or np.any(points[:, 1] >= image.height)
            )
        )
    ):
        ambiguous = True
    coverage = (
        float(cv2.contourArea(cv2.convexHull(points))) / (image.width * image.height)
        if len(points) >= 3
        else 0
    )
    # Assess board-region focus when possible; background detail cannot rescue a blurry board.
    roi = gray
    if len(points) >= 4:
        x, y, w, h = cv2.boundingRect(points)
        roi = gray[y : y + h, x : x + w]
    sharpness = float(cv2.Laplacian(roi, cv2.CV_64F).var())
    return Detection(
        image, points, ids, len(marker_ids), ambiguous, sharpness, coverage, spec.board_id
    )


def sample_problems(d: Detection) -> list[str]:
    problems = []
    if d.ambiguous:
        problems.append("Ambiguous board IDs. Show only the configured board.")
    if len(d.ids) < 12 or d.coverage < 0.015:
        problems.append("Show at least 12 ChArUco corners; move closer and keep the board visible.")
    if d.sharpness < 50:
        problems.append("Image is too blurry. Hold the camera steady and improve focus.")
    return problems


def object_points(d: Detection, spec=DEFAULT_BOARD):
    return make_board(spec).getChessboardCorners()[d.ids]


def calibrate(
    detections: list[Detection],
    camera: CameraConfiguration,
    measured_width_mm: float,
    measured_height_mm: float,
    spec=DEFAULT_BOARD,
) -> CalibrationProfile:
    validate_print(spec, measured_width_mm, measured_height_mm)
    if not 12 <= len(detections) <= 20:
        raise ValueError("Capture 12–20 different calibration views")
    hashes = [hashlib.sha256(d.image.jpeg_bytes).hexdigest() for d in detections]
    if len(set(hashes)) != len(hashes):
        raise ValueError("Duplicate calibration images; capture different positions and tilts")
    for index, d in enumerate(detections):
        if d.board_id != spec.board_id:
            raise ValueError("Calibration views belong to another board configuration")
        if (d.image.width, d.image.height) != (camera.width, camera.height):
            raise ValueError("All images must match the declared camera resolution")
        problems = sample_problems(d)
        if problems:
            raise ValueError(f"Sample {index + 1}: " + " ".join(problems))
    # Near duplicates with common IDs also fail, even after JPEG re-encoding.
    for i, left in enumerate(detections):
        for right in detections[:i]:
            common, ia, ib = np.intersect1d(left.ids, right.ids, return_indices=True)
            if (
                len(common) >= 8
                and np.sqrt(np.mean(np.sum((left.points[ia] - right.points[ib]) ** 2, axis=1))) < 5
            ):
                raise ValueError("Nearly identical views; vary board position, scale and tilt")
    points = [d.points for d in detections]
    objects = [object_points(d, spec) for d in detections]
    coverage = float(cv2.contourArea(cv2.convexHull(np.concatenate(points)))) / (
        camera.width * camera.height
    )
    if coverage < 0.15:
        raise ValueError("Move the board across more of the image, including edges")
    try:
        rms, k, distortion, rotations, translations = cv2.calibrateCamera(
            objects,
            points,
            (camera.width, camera.height),
            None,
            None,
            flags=cv2.CALIB_FIX_K3,
        )
    except cv2.error as exc:
        raise ValueError("Calibration could not converge. Capture more varied board tilts") from exc
    errors, normals = [], []
    for obj, pts, rvec, tvec in zip(objects, points, rotations, translations, strict=True):
        projected = cv2.projectPoints(obj, rvec, tvec, k, distortion)[0].reshape(-1, 2)
        errors.append(float(np.sqrt(np.mean(np.sum((projected - pts) ** 2, axis=1)))))
        normals.append(cv2.Rodrigues(rvec)[0][:, 2])
    spread = max(
        float(np.degrees(np.arccos(np.clip(np.dot(a, b), -1, 1)))) for a in normals for b in normals
    )
    if spread < 15:
        raise ValueError("Geometrically degenerate views: include different moderate board tilts")
    try:
        return CalibrationProfile(
            id=uuid4(),
            created_at=datetime.now(UTC),
            opencv_version=cv2.__version__,
            board=spec,
            board_id=spec.board_id,
            camera=camera,
            measured_width_mm=measured_width_mm,
            measured_height_mm=measured_height_mm,
            camera_matrix=k.tolist(),
            distortion=distortion.flatten().tolist(),
            reprojection_rms_px=rms,
            per_view_rms_px=errors,
            accepted_views=len(detections),
            coverage_fraction=coverage,
            normal_spread_degrees=spread,
        )
    except ValueError as exc:
        raise ValueError(
            "Calibration quality failed: excessive residuals or implausible intrinsics. "
            "Check focus, flatness and capture varied views"
        ) from exc


def estimate_pose(d: Detection, profile: CalibrationProfile) -> BoardPose:
    if d.board_id != profile.board_id or (d.image.width, d.image.height) != (
        profile.camera.width,
        profile.camera.height,
    ):
        raise ValueError("Detection does not match the calibration board or resolution")
    if d.ambiguous or len(d.ids) < 8 or d.coverage < 0.015 or d.sharpness < 50:
        raise ValueError("Insufficient sharp, well-spread board corners for pose")
    obj = object_points(d, profile.board)
    k, dist = np.array(profile.camera_matrix), np.array(profile.distortion)
    result = cv2.solvePnPGeneric(obj, d.points, k, dist, flags=cv2.SOLVEPNP_IPPE)
    candidates = []
    for rvec, tvec in zip(result[1], result[2], strict=True):
        rotation = cv2.Rodrigues(rvec)[0]
        if np.any((obj @ rotation.T + tvec.reshape(1, 3))[:, 2] <= 0):
            continue
        projected = cv2.projectPoints(obj, rvec, tvec, k, dist)[0].reshape(-1, 2)
        error = float(np.sqrt(np.mean(np.sum((projected - d.points) ** 2, axis=1))))
        if np.isfinite(error):
            candidates.append((error, rvec, tvec, rotation))
    candidates.sort(key=lambda item: item[0])
    if not candidates or candidates[0][0] > 2:
        raise ValueError("Board pose has excessive reprojection residuals")
    best = candidates[0]
    # Reject materially different planar solutions when reprojection cannot distinguish them.
    if len(candidates) > 1 and candidates[1][0] - best[0] < 0.1:
        angle = np.degrees(np.arccos(np.clip(np.dot(best[3][:, 2], candidates[1][3][:, 2]), -1, 1)))
        if angle > 5:
            raise ValueError("Board pose is ambiguous. Capture a clearer, slightly tilted view")
    tilt = float(np.degrees(np.arccos(np.clip(abs(best[3][2, 2]), 0, 1))))
    return BoardPose(
        calibration_id=profile.id,
        board_id=profile.board_id,
        rvec=best[1].flatten().tolist(),
        translation_mm=best[2].flatten().tolist(),
        viewing_angle_degrees=tilt,
        reprojection_rms_px=best[0],
    )


def assess(
    d: Detection,
    camera: CameraConfiguration,
    profile: CalibrationProfile | None,
    configuration_confirmed: bool,
    spec=DEFAULT_BOARD,
) -> CaptureAssessment:
    problems = sample_problems(d)
    messages = list(problems)
    status = "missing" if profile is None else "mismatch"
    pose = None
    if profile is None:
        messages.append("Camera calibration is missing. Detection alone provides no metric pose.")
    elif (
        profile.camera != camera
        or (d.image.width, d.image.height) != (camera.width, camera.height)
        or profile.board != spec
        or not configuration_confirmed
    ):
        messages.append(
            "Calibration mismatch. Confirm the same camera, lens, resolution, "
            "focus, zoom, crop and stabilization configuration or recalibrate."
        )
    else:
        status = "compatible"
        try:
            pose = estimate_pose(d, profile)
        except ValueError as exc:
            messages.append(str(exc))
    if not d.markers:
        messages.append("Calibration board not detected.")
    elif not d.ambiguous:
        messages.append("Calibration board detected.")
    centered = False
    if len(d.points):
        center = d.points.mean(axis=0) / [d.image.width, d.image.height]
        centered = bool(np.all(np.abs(center - 0.5) < 0.25))
        if not centered:
            messages.append("Move the board closer to the center of the image.")
    if pose and pose.viewing_angle_degrees > 25:
        messages.append("Tilt the camera less for a top-down inspection.")
    suitable = bool(pose and pose.viewing_angle_degrees <= 25 and centered and not problems)
    if suitable:
        messages.append(
            "Perspective is suitable for top-down capture; block geometry is not measured."
        )
    return CaptureAssessment(
        board_id=spec.board_id,
        snapshot_sha256=hashlib.sha256(d.image.jpeg_bytes).hexdigest(),
        width=d.image.width,
        height=d.image.height,
        board_status="ambiguous" if d.ambiguous else "detected" if d.markers else "not_detected",
        marker_count=d.markers,
        corner_count=0 if d.ambiguous else len(d.ids),
        corners=[
            DetectedCorner(id=int(i), x_px=float(p[0]), y_px=float(p[1]))
            for i, p in zip(d.ids, d.points, strict=True)
        ]
        if not d.ambiguous
        else [],
        board_visibility=len(d.ids) / ((spec.squares_x - 1) * (spec.squares_y - 1)),
        sharpness=d.sharpness,
        calibration_status=status,
        pose=pose,
        suitable_for_top_down_capture=suitable,
        sample_acceptable=not problems,
        guidance=messages,
        geometry={"calibration_valid": status == "compatible" and pose is not None},
    )


def image_to_board_plane(
    points_px: list[list[float]],
    profile: CalibrationProfile,
    pose: BoardPose,
    *,
    plane_z_mm: float = 0,
) -> list[list[float]]:
    """Intersect undistorted camera rays with Z_board=0; returns [X_mm, Y_mm].

    Caller must establish that points physically lie on the board. Pixel locations
    alone cannot prove this. Elevated surfaces are deliberately unsupported.
    """
    if pose.calibration_id != profile.id or pose.board_id != profile.board_id:
        raise ValueError("Pose belongs to another calibration or board")
    if pose.viewing_angle_degrees > 70:
        raise ValueError("Unreliable grazing-angle pose")
    if plane_z_mm != 0:
        raise ValueError("Elevated block geometry is not measured in Phase 4.1A")
    return image_to_board_surface(points_px, profile, pose, surface_z_mm=0)


def image_to_board_surface(
    points_px: list[list[float]],
    profile: CalibrationProfile,
    pose: BoardPose,
    *,
    surface_z_mm: float,
) -> list[list[float]]:
    """Intersect calibrated camera rays with an explicit board-parallel surface.

    This is valid only when the caller has trusted dimensions for the feature's
    physical height. It must not be used to infer an unknown height from one view.
    """

    if pose.calibration_id != profile.id or pose.board_id != profile.board_id:
        raise ValueError("Pose belongs to another calibration or board")
    if pose.viewing_angle_degrees > 70:
        raise ValueError("Unreliable grazing-angle pose")

    pts = np.asarray(points_px, dtype=np.float64)
    if not np.isfinite(surface_z_mm) or not 0 <= surface_z_mm <= 200:
        raise ValueError("Surface height must be a known finite value from 0 to 200 mm")
    if (
        pts.ndim != 2
        or pts.shape[1] != 2
        or not 1 <= len(pts) <= 1000
        or not np.isfinite(pts).all()
        or np.any(pts < 0)
        or np.any(pts >= [profile.camera.width, profile.camera.height])
    ):
        raise ValueError("Supply finite in-image pixel coordinates")
    normalized = cv2.undistortPoints(
        pts.reshape(-1, 1, 2), np.array(profile.camera_matrix), np.array(profile.distortion)
    ).reshape(-1, 2)
    # OpenCV's iterative inverse can fail to converge for strong distortion.
    # Never silently turn a bad inverse into nominal millimeter coordinates.
    round_trip = cv2.projectPoints(
        np.column_stack([normalized, np.ones(len(pts))]),
        np.zeros(3),
        np.zeros(3),
        np.array(profile.camera_matrix),
        np.array(profile.distortion),
    )[0].reshape(-1, 2)
    if (
        not np.isfinite(normalized).all()
        or not np.isfinite(round_trip).all()
        or np.max(np.linalg.norm(round_trip - pts, axis=1)) > 0.25
    ):
        raise ValueError("Unreliable distortion inversion; point cannot be transformed")
    rotation = cv2.Rodrigues(np.array(pose.rvec))[0]
    origin = -rotation.T @ np.array(pose.translation_mm)
    rays = np.column_stack([normalized, np.ones(len(pts))]) @ rotation
    if np.any(np.abs(rays[:, 2]) < 0.1):
        raise ValueError("Unreliable grazing-angle plane intersection")
    distances = (surface_z_mm - origin[2]) / rays[:, 2]
    if not np.isfinite(distances).all() or np.any(distances <= 0):
        raise ValueError("Requested surface is behind the camera")
    board_points = origin + rays * distances[:, None]
    if np.any(board_points[:, :2] < 0) or np.any(
        board_points[:, :2]
        > [
            profile.board.squares_x * profile.board.square_mm,
            profile.board.squares_y * profile.board.square_mm,
        ]
    ):
        raise ValueError("Point lies outside the calibrated board footprint")
    return board_points[:, :2].tolist()
