"""Physical face identity is independent of the camera viewpoint."""

from typing import Literal

from pydantic import Field, model_validator

from app.models.blocks import ImageRead
from app.models.calibration import GeometryModel
from app.models.contours import ContourLayer
from app.models.diagnosis import AnalyzedSnapshot
from app.models.print_config import PrintConfig


class FaceInput(GeometryModel):
    print_rule: PrintConfig | None = Field(default=None, exclude_if=lambda value: value is None)
    label: Literal["front", "back", "left", "right", "top", "bottom"]
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=1000)
    width_mm: float = Field(gt=0, le=500)
    height_mm: float = Field(gt=0, le=500)


class FaceRead(FaceInput):
    id: str
    block_id: str
    references: list[ImageRead]


class FaceConstraint(GeometryModel):
    target_block_id: str = Field(min_length=1, max_length=100)
    required_face_id: str = Field(min_length=1, max_length=100)
    facing_direction: Literal[
        "board_positive_x",
        "board_negative_x",
        "board_positive_y",
        "board_negative_y",
        "operator_front",
        "not_required",
    ]


class FaceResult(GeometryModel):
    schema_version: Literal[1] = 1
    status: Literal["correct", "incorrect", "uncertain", "not_measured"]
    expected_face_id: str | None = None
    target_block_id: str | None = None
    expected_face_name: str | None = None
    observed_face_name: str | None = None
    observed_face_id: str | None = None
    matched_reference_image_id: str | None = None
    matching_score: float | None = Field(default=None, ge=0, le=1)
    method: Literal["orb_ransac_canny", "none"] = "none"
    snapshot_id: str = Field(pattern=r"^[a-f0-9]{64}$")
    analyzed_snapshot: AnalyzedSnapshot | None = None
    quadrilateral: list[list[float]] = Field(default_factory=list, max_length=4)
    directional_evidence: bool = False
    calibration_profile_id: str | None = None
    guidance: str
    contours: list[ContourLayer] = Field(default_factory=list, max_length=2)

    @model_validator(mode="after")
    def supported_decision(self):
        import base64
        import hashlib

        if len({layer.kind for layer in self.contours}) != len(self.contours):
            raise ValueError("Duplicate face contour layer")
        for layer in self.contours:
            if layer.kind not in {"canny_edges", "reference_match"}:
                raise ValueError("Unexpected face contour layer")
            if layer.snapshot_id != self.snapshot_id:
                raise ValueError("Face contours belong to another snapshot")
            if layer.status == "available" and (
                not self.analyzed_snapshot
                or not self.matched_reference_image_id
                or not self.quadrilateral
                or self.method != "orb_ransac_canny"
                or not layer.belongs_to(
                    self.snapshot_id, self.analyzed_snapshot.width, self.analyzed_snapshot.height
                )
            ):
                raise ValueError("Contours require supported face localization")

        if self.status == "not_measured" and self.expected_face_id:
            raise ValueError("A required face cannot be skipped")
        if self.status in {"correct", "incorrect"}:
            if not (
                self.directional_evidence
                and self.expected_face_id
                and self.observed_face_id
                and self.matched_reference_image_id
                and self.analyzed_snapshot
                and len(self.quadrilateral) == 4
                and self.matching_score is not None
                and self.method != "none"
            ):
                raise ValueError("A physical face decision requires directional and image evidence")
            if (self.expected_face_id == self.observed_face_id) != (self.status == "correct"):
                raise ValueError("Face decision contradicts registered identity")
        if self.quadrilateral:
            image = self.analyzed_snapshot
            if (
                not image
                or len(self.quadrilateral) != 4
                or any(
                    len(p) != 2 or not 0 <= p[0] < image.width or not 0 <= p[1] < image.height
                    for p in self.quadrilateral
                )
            ):
                raise ValueError("Invalid face quadrilateral")
            actual = hashlib.sha256(
                base64.b64decode(image.data_url.split(",", 1)[1], validate=True)
            ).hexdigest()
            if actual != self.snapshot_id:
                raise ValueError("Face snapshot identity mismatch")
        return self
