"""Independent Canny controls and exact-camera-snapshot evidence."""

import base64
import hashlib
from io import BytesIO

from PIL import Image
from pydantic import Field, model_validator

from app.models.calibration import GeometryModel
from app.models.contours import ContourLayer
from app.models.diagnosis import AnalyzedSnapshot


class EdgeROI(GeometryModel):
    left: int = Field(ge=0, strict=True)
    top: int = Field(ge=0, strict=True)
    width: int = Field(ge=2, le=8192, strict=True)
    height: int = Field(ge=2, le=8192, strict=True)


class EdgeOptions(GeometryModel):
    blur_kernel: int = Field(default=3, ge=1, le=21, strict=True)
    low_threshold: int = Field(default=50, ge=0, le=254, strict=True)
    high_threshold: int = Field(default=150, ge=1, le=255, strict=True)
    roi: EdgeROI | None = None

    @model_validator(mode="after")
    def valid_controls(self):
        if self.blur_kernel % 2 == 0:
            raise ValueError("Gaussian blur must be an odd kernel size from 1 to 21")
        if self.low_threshold >= self.high_threshold:
            raise ValueError("Low threshold must be smaller than high threshold")
        return self


class EdgeDebugResult(GeometryModel):
    snapshot_id: str = Field(pattern=r"^[a-f0-9]{64}$")
    analyzed_snapshot: AnalyzedSnapshot
    options: EdgeOptions
    applied_roi: EdgeROI
    edge_image: str = Field(max_length=8_400_000)
    contours: ContourLayer
    edge_pixel_count: int = Field(ge=0)
    processing_ms: float = Field(ge=0)

    @model_validator(mode="after")
    def consistent_evidence(self):
        image = self.analyzed_snapshot
        data = base64.b64decode(image.data_url.split(",", 1)[1], validate=True)
        if hashlib.sha256(data).hexdigest() != self.snapshot_id:
            raise ValueError("Edge debug snapshot identity mismatch")
        if not self.contours.belongs_to(self.snapshot_id, image.width, image.height):
            raise ValueError("Edge contours belong to another snapshot")
        if self.contours.kind != "canny_edges":
            raise ValueError("Debug mode produces only raw edges")
        roi = self.applied_roi
        if roi.left + roi.width > image.width or roi.top + roi.height > image.height:
            raise ValueError("ROI extends outside snapshot")
        if self.options.roi and self.options.roi != roi:
            raise ValueError("Applied ROI differs from requested ROI")
        if self.options.roi is None and (roi.left, roi.top, roi.width, roi.height) != (
            0,
            0,
            image.width,
            image.height,
        ):
            raise ValueError("Default ROI must cover the complete snapshot")
        if any(
            not (roi.left <= x < roi.left + roi.width and roi.top <= y < roi.top + roi.height)
            for path in self.contours.paths
            for x, y in path.points
        ):
            raise ValueError("Raw contours extend outside requested ROI")
        prefix = "data:image/png;base64,"
        if not self.edge_image.startswith(prefix):
            raise ValueError("Expected a PNG edge image")
        with Image.open(
            BytesIO(base64.b64decode(self.edge_image[len(prefix) :], validate=True))
        ) as png:
            if png.format != "PNG" or png.mode != "L" or png.size != (image.width, image.height):
                raise ValueError("Edge image dimensions disagree with snapshot")
            png.verify()
        return self
