"""Human-authored guidance in metres; not inspection evidence or a camera transform."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ARModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, strict=True)


class Dimensions(ARModel):
    x_mm: float = Field(gt=0, le=1000)
    y_mm: float = Field(gt=0, le=1000)
    z_mm: float = Field(gt=0, le=1000)


class Studs(ARModel):
    x: int = Field(ge=1, le=20)
    z: int = Field(ge=1, le=20)
    pitch_mm: float = Field(gt=0, le=100)
    diameter_mm: float = Field(gt=0, le=100)
    height_mm: float = Field(gt=0, le=100)


class Placement(ARModel):
    target_block_id: str = Field(min_length=1, max_length=100)
    instance: int = Field(ge=1, le=1000)
    origin: Literal["tabletop_session"] = "tabletop_session"
    method: Literal["manual_authoring"] = "manual_authoring"
    evidence: Literal["measured", "approximate"]
    confirmed: Literal[True]
    dimensions: Dimensions
    studs: Studs | None = None
    position_m: list[float] = Field(min_length=3, max_length=3)
    rotation_deg: list[float] = Field(min_length=3, max_length=3)

    @model_validator(mode="after")
    def bounded(self):
        if any(abs(v) > 2 for v in self.position_m):
            raise ValueError("Tabletop positions must be within 2 metres of the origin")
        if any(abs(v) > 180 for v in self.rotation_deg):
            raise ValueError("Rotation must be within -180..180 degrees")
        s, d = self.studs, self.dimensions
        if s and (
            self.evidence != "measured"
            or s.diameter_mm > s.pitch_mm
            or (s.x - 1) * s.pitch_mm + s.diameter_mm > d.x_mm
            or (s.z - 1) * s.pitch_mm + s.diameter_mm > d.z_mm
        ):
            raise ValueError(
                "Stud layout requires confirmed measurements within the block footprint"
            )
        return self


class ViewInput(ARModel):
    step_id: str
    revision: int = Field(ge=0)
