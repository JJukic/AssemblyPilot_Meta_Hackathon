from typing import Literal

from pydantic import BaseModel, Field

from app.models.blocks import BlockInput, ImageRead
from app.models.faces import FaceConstraint, FaceRead
from app.models.geometry import StudOffsetConstraintRead
from app.models.setup import SimplePrintConstraint


class ExpectedBlock(BlockInput):
    id: str
    required_quantity: int
    reference_images: list[ImageRead]


class CameraFrame(BaseModel):
    """Transient, normalized frame supplied at inspection time; never stored by this service."""

    mime_type: Literal["image/jpeg"] = "image/jpeg"
    width: int
    height: int
    jpeg_base64: str


class PreviousInspection(BaseModel):
    step_id: str
    notes: str = Field(max_length=4000)


class InspectionContext(BaseModel):
    simple_print: SimplePrintConstraint | None = Field(default=None, exclude_if=lambda v: v is None)
    project_id: str
    project_name: str
    step_id: str
    position: int
    title: str
    instruction: str
    expected_blocks: list[ExpectedBlock]
    step_reference_images: list[ImageRead]
    step_reference_image: str | None
    spatial_constraint: StudOffsetConstraintRead | None = None
    face_constraint: FaceConstraint | None = None
    faces: list[FaceRead] = Field(default_factory=list)
    snapshot: CameraFrame | None = None
    previous_context: PreviousInspection | None = None
