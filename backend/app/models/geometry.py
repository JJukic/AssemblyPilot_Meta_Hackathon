"""Versioned stud-level constraints and deterministic measurement evidence."""

from typing import Literal
from uuid import UUID

from pydantic import Field, model_validator

from app.models.calibration import CameraConfiguration, GeometryModel
from app.models.diagnosis import AnalyzedSnapshot


class StudOffsetConstraintInput(GeometryModel):
    target_block_id: str = Field(min_length=1, max_length=100)
    reference_block_id: str = Field(min_length=1, max_length=100)
    constraint_type: Literal["relative_stud_offset"] = "relative_stud_offset"
    axis: Literal["longitudinal"] = "longitudinal"
    positive_direction: Literal["board_positive_x", "board_positive_y"]
    expected_stud_offset: float = Field(ge=-32, le=32)
    tolerance_studs: float = Field(gt=0, le=0.5)
    reference_surface_height_mm: float = Field(gt=0, le=200)
    target_surface_height_mm: float = Field(gt=0, le=200)

    @model_validator(mode="after")
    def distinct_supported_surfaces(self):
        if self.target_block_id == self.reference_block_id:
            raise ValueError("Target and reference blocks must be different")
        if self.target_surface_height_mm <= self.reference_surface_height_mm:
            raise ValueError("Target stud surface must be above the reference stud surface")
        return self


class StudOffsetConstraintRead(StudOffsetConstraintInput):
    id: str


class GeometryRequest(GeometryModel):
    profile_id: UUID | None = None
    camera: CameraConfiguration | None = None
    configuration_confirmed: bool = False


class ImagePoint(GeometryModel):
    x_px: float = Field(ge=0)
    y_px: float = Field(ge=0)


class BoardPoint(GeometryModel):
    x_mm: float
    y_mm: float
    z_mm: float = Field(ge=0, le=200)


class StudFeature(GeometryModel):
    block_id: str
    role: Literal["target", "reference"]
    image: ImagePoint
    board: BoardPoint


class MeasurementAxis(GeometryModel):
    origin: BoardPoint
    unit_x: float = Field(ge=-1, le=1)
    unit_y: float = Field(ge=-1, le=1)


class ImageSegment(GeometryModel):
    start: ImagePoint
    end: ImagePoint


class GeometryEvidence(GeometryModel):
    calibration_profile_id: UUID | None = None
    snapshot_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    calibration_valid: bool = False
    board_pose_valid: bool = False
    target_feature_count: int = Field(default=0, ge=0, le=64)
    reference_feature_count: int = Field(default=0, ge=0, le=64)
    features: list[StudFeature] = Field(default_factory=list, max_length=128)
    reference_axis: MeasurementAxis | None = None
    reference_axis_image: ImageSegment | None = None


class GeometricVerificationResult(GeometryModel):
    schema_version: Literal[1] = 1
    step_id: str
    constraint_id: str | None = None
    measurement_status: Literal["measured", "not_measured"]
    geometry_status: Literal["correct", "incorrect", "uncertain", "not_measured"]
    constraint_type: Literal["relative_stud_offset"] | None = None
    axis: Literal["longitudinal"] | None = None
    expected_studs: float | None = None
    observed_studs: float | None = None
    deviation_studs: float | None = None
    uncertainty_studs: float | None = Field(default=None, ge=0)
    stud_pitch_mm: Literal[8.0] = 8.0
    observed_mm: float | None = None
    deviation_mm: float | None = None
    tolerance_studs: float | None = Field(default=None, gt=0)
    evidence: GeometryEvidence = Field(default_factory=GeometryEvidence)
    analyzed_snapshot: AnalyzedSnapshot | None = None
    guidance: str
    limitations: list[str] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def consistent_measurement(self):
        import base64
        import hashlib
        import math

        numeric = (
            self.expected_studs,
            self.observed_studs,
            self.deviation_studs,
            self.uncertainty_studs,
            self.observed_mm,
            self.deviation_mm,
            self.tolerance_studs,
        )
        if self.measurement_status == "measured":
            if any(value is None for value in numeric):
                raise ValueError("Measured geometry requires complete numeric evidence")
            if self.geometry_status not in {"correct", "incorrect", "uncertain"}:
                raise ValueError("Measured geometry needs an evidence-based status")
            if not self.evidence.calibration_valid or not self.evidence.board_pose_valid:
                raise ValueError("Measured geometry requires valid calibration and board pose")
            if self.analyzed_snapshot is None or self.evidence.snapshot_id is None:
                raise ValueError("Measured geometry requires snapshot provenance")
            if (
                self.evidence.calibration_profile_id is None
                or self.evidence.reference_axis is None
                or self.evidence.reference_axis_image is None
                or self.evidence.target_feature_count != 8
                or self.evidence.reference_feature_count not in {2, 4, 6, 8}
                or len(self.evidence.features)
                != self.evidence.target_feature_count + self.evidence.reference_feature_count
            ):
                raise ValueError("Measured geometry requires a complete supported evidence set")
            axis = self.evidence.reference_axis
            if not 0.99 <= axis.unit_x**2 + axis.unit_y**2 <= 1.01:
                raise ValueError("Measurement axis must be a unit vector")
            if (
                not math.isclose(
                    self.deviation_studs,
                    self.observed_studs - self.expected_studs,
                    abs_tol=1e-6,
                )
                or not math.isclose(
                    self.observed_mm, self.observed_studs * self.stud_pitch_mm, abs_tol=1e-6
                )
                or not math.isclose(
                    self.deviation_mm,
                    self.deviation_studs * self.stud_pitch_mm,
                    abs_tol=1e-6,
                )
            ):
                raise ValueError("Geometry units or deviation are inconsistent")
            error = abs(self.deviation_studs)
            expected_status = (
                "correct"
                if error + self.uncertainty_studs <= self.tolerance_studs
                else "incorrect"
                if max(0.0, error - self.uncertainty_studs) > self.tolerance_studs
                else "uncertain"
            )
            if self.geometry_status != expected_status:
                raise ValueError("Geometry status contradicts its uncertainty interval")
            encoded = self.analyzed_snapshot.data_url.split(",", 1)[1]
            if hashlib.sha256(base64.b64decode(encoded, validate=True)).hexdigest() != (
                self.evidence.snapshot_id
            ):
                raise ValueError("Geometry snapshot identity mismatch")
            points = [feature.image for feature in self.evidence.features]
            if self.evidence.reference_axis_image:
                points.extend(
                    [
                        self.evidence.reference_axis_image.start,
                        self.evidence.reference_axis_image.end,
                    ]
                )
            if any(
                point.x_px >= self.analyzed_snapshot.width
                or point.y_px >= self.analyzed_snapshot.height
                for point in points
            ):
                raise ValueError("Geometry overlay point lies outside the analyzed snapshot")
        elif any(value is not None for value in numeric[1:6]):
            raise ValueError("Unmeasured geometry cannot contain observed values")
        elif (
            self.evidence.features
            or self.evidence.calibration_valid
            or self.evidence.board_pose_valid
            or self.analyzed_snapshot is not None
        ):
            raise ValueError("Unmeasured geometry cannot contain nominal measurement evidence")
        elif self.geometry_status not in {"uncertain", "not_measured"}:
            raise ValueError("Unmeasured geometry cannot claim correct or incorrect")
        if self.constraint_id is None and self.geometry_status != "not_measured":
            raise ValueError("A geometry decision requires an explicit constraint")
        return self


class GeometryFormContext(GeometryModel):
    """Validated optional multipart fields passed to the orchestrator."""

    profile_id: UUID | None = None
    camera: CameraConfiguration | None = None
    configuration_confirmed: bool = False
