"""Optional print semantics attached to a physical block side, not a human face."""

from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.models.calibration import GeometryModel


class PrintConfig(GeometryModel):
    expected_text: str = Field(default="", max_length=500)
    alternative_texts: list[str] = Field(default_factory=list, max_length=12)
    logo_description: str = Field(default="", max_length=1000)
    recognition_mode: Literal["meta_auto", "meta_references", "contour", "hybrid"] = "meta_auto"

    @field_validator("expected_text", "logo_description")
    @classmethod
    def trim(cls, value):
        return value.strip()

    @field_validator("alternative_texts")
    @classmethod
    def bounded_labels(cls, values):
        cleaned = [value.strip() for value in values]
        if any(not value or len(value) > 500 for value in cleaned):
            raise ValueError("Alternative texts must contain 1–500 characters")
        if len(set(cleaned)) != len(cleaned):
            raise ValueError("Alternative texts must be distinct")
        return cleaned

    @model_validator(mode="after")
    def usable_definition(self):
        if self.recognition_mode == "meta_auto" and not self.expected_text:
            raise ValueError("Meta Auto requires expected printed text")
        if (
            not self.expected_text
            and not self.logo_description
            and self.recognition_mode != "contour"
        ):
            raise ValueError("Supply expected text or a logo description")
        return self
