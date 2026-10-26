from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class ImageRead(BaseModel):
    id: str
    owner_type: Literal["block", "step"]
    owner_id: str
    url: str
    original_filename: str
    mime_type: str
    width: int
    height: int
    created_at: datetime


class BlockInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Name
    description: str | None = Field(default=None, max_length=4000)
    category: ShortText = "brick"
    color: ShortText = "unspecified"
    shape: ShortText = "rectangular"
    studs_x: int | None = Field(default=None, ge=0, le=1000)
    studs_y: int | None = Field(default=None, ge=0, le=1000)
    height_mm: float | None = Field(default=None, ge=0, le=100000, allow_inf_nan=False)
    default_quantity: int = Field(default=1, gt=0, le=100000)


class BlockRead(BlockInput):
    id: str
    created_at: datetime
    updated_at: datetime
    reference_images: list[ImageRead]
