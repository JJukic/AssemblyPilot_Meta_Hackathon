"""Validated diagnostic output, not a guarantee of physical correctness."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, model_validator


class StrictOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class BoundingBox(StrictOutput):
    """Normalized coordinates in the EXIF-oriented current camera image, never a reference."""

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def inside_image(self) -> "BoundingBox":
        if self.x + self.width > 1 or self.y + self.height > 1:
            raise ValueError("Bounding box extends beyond the camera image")
        return self


class VisibleBlock(StrictOutput):
    block_id: str | None = Field(description="A supplied registered ID, or null if unidentified")
    description: str = Field(min_length=1, max_length=2000)
    estimated_count: int | None = Field(ge=0, le=100000)


class InspectionIssue(StrictOutput):
    type: Literal[
        "missing_part",
        "misplaced_part",
        "wrong_color",
        "wrong_orientation",
        "unexpected_part",
        "unknown",
    ]
    block_id: str | None
    description: str = Field(min_length=1, max_length=2000)
    expected: str = Field(min_length=1, max_length=2000)
    observed: str = Field(min_length=1, max_length=2000)
    suggested_fix: str = Field(min_length=1, max_length=2000)
    bounding_box: BoundingBox | None

    @model_validator(mode="after")
    def visible_localization_only(self) -> "InspectionIssue":
        if self.type == "missing_part" and self.bounding_box is not None:
            raise ValueError("Missing parts have no observed location; bounding_box must be null")
        return self


class ActiveVision(StrictOutput):
    reason: str = Field(min_length=1, max_length=2000)
    requested_view: Literal[
        "top_down", "front", "back", "left_side", "right_side", "close_up", "other"
    ]
    instruction: str = Field(
        min_length=1,
        max_length=2000,
        description="Specific camera movement and area to reveal, not a repair",
    )


class InspectionResult(StrictOutput):
    # Transport-owned, excluded from both the model schema and serialized diagnoses.
    _meta_attempt_count: int = PrivateAttr(default=0)

    step_id: str = Field(min_length=1, max_length=100)
    status: Literal["correct", "incorrect", "uncertain"]
    confidence: float | None = Field(
        ge=0, le=1, description="Model estimate, not a calibrated probability; null if unavailable"
    )
    visible_blocks: list[VisibleBlock] = Field(max_length=200)
    issues: list[InspectionIssue] = Field(max_length=100)
    explanation: str = Field(min_length=1, max_length=6000)
    next_action: str = Field(min_length=1, max_length=2000)
    active_vision: ActiveVision | None

    @model_validator(mode="after")
    def consistent_status(self) -> "InspectionResult":
        if (self.status == "uncertain") != (self.active_vision is not None):
            raise ValueError(
                "Uncertain results require Active Vision; other statuses must use null"
            )
        if self.status == "correct" and self.issues:
            raise ValueError("A correct result cannot also report discrepancies")
        if self.status == "incorrect" and not self.issues:
            raise ValueError("An incorrect result must identify a supported discrepancy")
        return self


class AnalyzedSnapshot(StrictOutput):
    data_url: str = Field(pattern=r"^data:image/jpeg;base64,")
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class InspectionResponse(InspectionResult):
    """Server-owned provenance. These fields are never requested from the model."""

    analyzed_snapshot: AnalyzedSnapshot
    model: str
    model_latency_ms: float = Field(ge=0)
    inspected_at: datetime
