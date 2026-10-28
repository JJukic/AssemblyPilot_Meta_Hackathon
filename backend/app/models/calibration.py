"""Versioned deterministic geometry contracts; no assembly measurements in Phase 4.1A."""

import hashlib
import json
import math
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class GeometryModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, validate_default=True)


class BoardSpec(GeometryModel):
    squares_x: int = Field(default=7, ge=3, le=20)
    squares_y: int = Field(default=5, ge=3, le=20)
    square_mm: float = Field(default=20, ge=5, le=100)
    marker_mm: float = Field(default=15, ge=2, le=99)
    dictionary: Literal["DICT_4X4_50", "DICT_5X5_100", "DICT_6X6_250"] = "DICT_4X4_50"

    @model_validator(mode="after")
    def valid_board(self):
        capacity = int(self.dictionary.split("_")[-1])
        if self.marker_mm >= self.square_mm * 0.9:
            raise ValueError("Marker length must be less than 90% of square length")
        if self.squares_x * self.squares_y // 2 > capacity:
            raise ValueError("Dictionary has too few unique marker IDs")
        return self

    @property
    def board_id(self) -> str:
        canonical = json.dumps(self.model_dump(), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode()).hexdigest()[:24]


DEFAULT_BOARD = BoardSpec()


class CameraConfiguration(GeometryModel):
    device_label: str = Field(min_length=1, max_length=200)
    lens: str = Field(min_length=1, max_length=200)
    configuration: str = Field(min_length=1, max_length=1500)
    # A user-declared configuration identifier, not proof of physical camera identity.
    width: int = Field(ge=32, le=8192)
    height: int = Field(ge=32, le=8192)


class CalibrationProfile(GeometryModel):
    schema_version: Literal[1] = 1
    id: UUID
    created_at: datetime
    opencv_version: str
    board: BoardSpec
    board_id: str
    camera: CameraConfiguration
    measured_width_mm: float = Field(gt=0)
    measured_height_mm: float = Field(gt=0)
    camera_matrix: list[list[float]]
    distortion: list[float] = Field(min_length=5, max_length=5)
    reprojection_rms_px: float = Field(ge=0, le=2)
    per_view_rms_px: list[float] = Field(min_length=12, max_length=20)
    accepted_views: int = Field(ge=12, le=20)
    coverage_fraction: float = Field(ge=0.15, le=1)
    normal_spread_degrees: float = Field(ge=15, le=180)

    @model_validator(mode="after")
    def validate_profile(self):
        k = self.camera_matrix
        if len(k) != 3 or any(len(row) != 3 for row in k):
            raise ValueError("Camera matrix must be 3 by 3")
        size = max(self.camera.width, self.camera.height)
        if (
            not all(math.isfinite(v) for row in k for v in row)
            or not 0.3 * size <= k[0][0] <= 5 * size
            or not 0.3 * size <= k[1][1] <= 5 * size
            or not 0 < k[0][2] < self.camera.width
            or not 0 < k[1][2] < self.camera.height
            or k[0][1] != 0
            or k[1][0] != 0
            or k[2] != [0, 0, 1]
        ):
            raise ValueError("Camera matrix is invalid or implausible")
        if (
            any(
                abs(v) > limit
                for v, limit in zip(self.distortion, [2, 2, 0.1, 0.1, 0.001], strict=True)
            )
            or not 0.8 <= k[0][0] / k[1][1] <= 1.2
        ):
            raise ValueError("Unsupported distortion or pixel aspect ratio; recalibrate")
        if self.board_id != self.board.board_id or self.created_at.tzinfo is None:
            raise ValueError("Profile board identity or timestamp is invalid")
        if len(self.per_view_rms_px) != self.accepted_views or any(
            not math.isfinite(v) or not 0 <= v <= 3 for v in self.per_view_rms_px
        ):
            raise ValueError("Per-view calibration errors are invalid")
        validate_print(self.board, self.measured_width_mm, self.measured_height_mm)
        return self


def validate_print(board: BoardSpec, width: float, height: float) -> None:
    # This checks gross scaling only. A ruler does not certify a precision target.
    if (
        not math.isfinite(width)
        or not math.isfinite(height)
        or abs(width / (board.squares_x * board.square_mm) - 1) > 0.01
        or abs(height / (board.squares_y * board.square_mm) - 1) > 0.01
    ):
        raise ValueError(
            "Measure the printed pattern: width and height must be within 1% of nominal"
        )


class DetectedCorner(GeometryModel):
    id: int = Field(ge=0)
    x_px: float = Field(ge=0)
    y_px: float = Field(ge=0)


class BoardPose(GeometryModel):
    calibration_id: UUID
    board_id: str
    # X_camera = R_board_to_camera X_board + t_board_to_camera_mm
    rvec: list[float] = Field(min_length=3, max_length=3)
    translation_mm: list[float] = Field(min_length=3, max_length=3)
    viewing_angle_degrees: float = Field(ge=0, le=90)
    reprojection_rms_px: float = Field(ge=0, le=2)


class GeometryEvidence(GeometryModel):
    schema_version: Literal[1] = 1
    measurement_status: Literal["not_measured"] = "not_measured"
    coordinate_frame: Literal["charuco_board"] = "charuco_board"
    units: Literal["mm"] = "mm"
    measurements: list = Field(default_factory=list, max_length=0)
    calibration_valid: bool = False
    limitations: list[str] = Field(
        default_factory=lambda: [
            "Elevated block geometry is not measured in Phase 4.1A.",
            "Board-plane transforms apply only to points physically on the board plane.",
            "Semantic AI diagnosis is not metrological verification.",
        ]
    )


class CaptureAssessment(GeometryModel):
    schema_version: Literal[1] = 1
    board_id: str
    analyzed_snapshot: str = ""
    snapshot_sha256: str
    width: int
    height: int
    board_status: Literal["detected", "not_detected", "ambiguous"]
    marker_count: int
    corner_count: int
    corners: list[DetectedCorner]
    board_visibility: float = Field(ge=0, le=1)
    sharpness: float = Field(ge=0)
    calibration_status: Literal["missing", "compatible", "mismatch"]
    pose: BoardPose | None = None
    suitable_for_top_down_capture: bool = False
    sample_acceptable: bool = False
    guidance: list[str]
    geometry: GeometryEvidence = Field(default_factory=GeometryEvidence)


class CalibrationStatus(GeometryModel):
    board: BoardSpec = DEFAULT_BOARD
    board_id: str = DEFAULT_BOARD.board_id
    opencv_version: str
    profiles: list[CalibrationProfile]
    invalid_profile_count: int = 0
