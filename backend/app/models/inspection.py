from typing import Literal

from pydantic import BaseModel, Field


class ImageMetadata(BaseModel):
    width: int
    height: int
    original_width: int
    original_height: int
    format: Literal["JPEG"] = "JPEG"


class InspectionUnavailable(BaseModel):
    status: Literal["not_implemented"] = "not_implemented"
    detail: str = "Image validated. AI inspection is not implemented in Phase 1."
    image: ImageMetadata


# Future internal contracts only; Phase 1 never returns manufactured model outputs.
class Diagnosis(BaseModel):
    observations: list[str]
    issues: list[str]


class CorrectionPlan(BaseModel):
    actions: list[str]


class Verification(BaseModel):
    verified: bool
    explanation: str
    confidence: float = Field(ge=0, le=1)
