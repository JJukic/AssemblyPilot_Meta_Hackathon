"""Validated browser contract. PNG masks are box-local, never full-frame guesses."""

import base64
from io import BytesIO
from typing import Literal

from PIL import Image
from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_MASK_BYTES = 512 * 1024


class MaskPNG(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    encoding: Literal["png"] = "png"
    width: int = Field(gt=0, le=1600)
    height: int = Field(gt=0, le=1600)
    data_url: str = Field(max_length=700000)

    @model_validator(mode="after")
    def valid_png(self):
        prefix = "data:image/png;base64,"
        if not self.data_url.startswith(prefix):
            raise ValueError("Expected an inline PNG")
        data = base64.b64decode(self.data_url[len(prefix) :], validate=True)
        if len(data) > MAX_MASK_BYTES:
            raise ValueError("Mask payload exceeds limit")
        with Image.open(BytesIO(data)) as image:
            if image.format != "PNG" or image.size != (self.width, self.height):
                raise ValueError("Mask dimensions disagree")
            if image.mode != "RGBA" or getattr(image, "is_animated", False):
                raise ValueError("Expected a static RGBA mask")
            image.verify()
        return self


class SegmentationInstance(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    instance_id: str = Field(min_length=1, max_length=100)
    # Pixel bounds avoid rounding until the browser maps them to the exact image.
    left: int = Field(ge=0)
    top: int = Field(ge=0)
    mask: MaskPNG


class SegmentationResult(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    snapshot_id: str = Field(pattern=r"^[a-f0-9]{64}$")
    width: int = Field(gt=0, le=1600)
    height: int = Field(gt=0, le=1600)
    model: Literal["sam-3.1"] = "sam-3.1"
    instances: list[SegmentationInstance] = Field(max_length=32)

    @model_validator(mode="after")
    def geometry(self):
        if len({item.instance_id for item in self.instances}) != len(self.instances):
            raise ValueError("Duplicate instance identity")
        if sum(len(item.mask.data_url) for item in self.instances) > 2 * 1024 * 1024:
            raise ValueError("Combined masks exceed limit")
        for item in self.instances:
            if (
                item.left + item.mask.width > self.width
                or item.top + item.mask.height > self.height
            ):
                raise ValueError("Mask extends beyond snapshot")
        return self


class IssueSegmentation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    issue_index: int = Field(ge=0, le=99)
    status: Literal["matched", "ambiguous", "no_match", "unavailable", "disabled", "skipped"]
    concept: str | None = None
    prompt_kind: Literal["concept", "box"] | None = None
    message: str
    latency_ms: float = Field(default=0, ge=0)
    selected_instance_id: str | None = None
    result: SegmentationResult | None = None

    @model_validator(mode="after")
    def consistent_selection(self):
        ids = {item.instance_id for item in self.result.instances} if self.result else set()
        if self.status == "matched":
            if self.selected_instance_id is None or self.selected_instance_id not in ids:
                raise ValueError("Matched status requires a validated instance")
        elif self.selected_instance_id is not None:
            raise ValueError("Only matched localizations may select an instance")
        if self.status in {"unavailable", "disabled", "skipped"} and self.result is not None:
            raise ValueError("Unavailable localizations cannot carry instances")
        if self.status == "no_match" and (self.result is None or ids):
            raise ValueError("No-match requires an empty completed result")
        if self.status == "ambiguous" and not ids:
            raise ValueError("Ambiguous status requires candidates")
        return self
