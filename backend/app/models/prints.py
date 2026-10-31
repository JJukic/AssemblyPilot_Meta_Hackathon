"""Versioned recognition evidence separate from orientation and placement."""

from typing import Literal

from pydantic import Field, model_validator

from app.models.calibration import GeometryModel
from app.models.diagnosis import BoundingBox


class PrintRecognitionResult(GeometryModel):
    schema_version: Literal[1] = 1
    target_block_id: str | None = None
    expected_print: str | None = None
    observed_print: str | None = None
    observed_logo: str | None = None
    observed_registered_side_id: str | None = None
    observed_registered_side_name: str | None = None
    recognition_status: Literal["match", "mismatch", "uncertain", "not_applicable"]
    recognition_method: Literal[
        "meta_zero_shot", "meta_reference", "contour_matching", "hybrid", "none"
    ]
    evidence_quality: Literal["clear", "partial", "unreadable", "ambiguous", "not_measured"]
    known_alternative: bool = False
    description: str
    suggested_action: str
    snapshot_id: str = Field(pattern=r"^[a-f0-9]{64}$")
    bounding_box: BoundingBox | None = None
    reference_image_id: str | None = None
    direction_required: bool = False
    direction_supported: bool = False
    gate_status: Literal["pass", "fail", "uncertain", "not_applicable"]

    @model_validator(mode="after")
    def supported_gate(self):
        if self.gate_status in {"pass", "fail"}:
            if self.recognition_status != ("match" if self.gate_status == "pass" else "mismatch"):
                raise ValueError("Print gate contradicts recognition")
            if self.evidence_quality != "clear" or not self.target_block_id:
                raise ValueError("Print gate requires clear target evidence")
            if self.direction_required and not self.direction_supported:
                raise ValueError("Print identity alone cannot establish facing direction")
        if (self.recognition_status == "not_applicable") != (self.gate_status == "not_applicable"):
            raise ValueError("A required print check cannot be skipped")
        return self
