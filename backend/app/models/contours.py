"""Bounded pixel-space overlay evidence, never an assembly correctness verdict."""

from typing import Literal

from pydantic import Field, model_validator

from app.models.calibration import GeometryModel

ContourKind = Literal["sam_outline", "canny_edges", "reference_match"]


class ContourPath(GeometryModel):
    points: list[tuple[float, float]] = Field(min_length=2, max_length=128)
    closed: bool = False


class ContourLayer(GeometryModel):
    kind: ContourKind
    status: Literal["available", "unavailable"]
    message: str = Field(min_length=1, max_length=500)
    snapshot_id: str = Field(pattern=r"^[a-f0-9]{64}$")
    width: int = Field(gt=0, le=8192)
    height: int = Field(gt=0, le=8192)
    paths: list[ContourPath] = Field(default_factory=list, max_length=64)

    @model_validator(mode="after")
    def bounded_geometry(self):
        if (self.status == "available") != bool(self.paths):
            raise ValueError("Only available contours may contain geometry")
        if sum(len(path.points) for path in self.paths) > 4096:
            raise ValueError("Contour point budget exceeded")
        for path in self.paths:
            if path.closed and len(path.points) < 3:
                raise ValueError("Closed contours require at least three points")
            if any(not (0 <= x < self.width and 0 <= y < self.height) for x, y in path.points):
                raise ValueError("Contour lies outside its snapshot")
        return self

    def belongs_to(self, snapshot_id, width, height):
        return (self.snapshot_id, self.width, self.height) == (snapshot_id, width, height)
