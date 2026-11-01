"""Drafts contain observations/instructions, never generated metrology."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.blocks import Name, ShortText


class SetupModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class SimplePrintConstraint(SetupModel):
    target_block_id: str = Field(min_length=1, max_length=100)
    expected_text: str = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def nonblank(self):
        self.expected_text = self.expected_text.strip()
        if not self.expected_text:
            raise ValueError("Expected text cannot be blank")
        return self


class SetupBlock(SetupModel):
    key: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,80}$")
    existing_id: str | None = Field(default=None, max_length=100)
    name: Name
    color: ShortText
    quantity: int = Field(ge=1, le=1000)
    printed_text: str = Field(default="", max_length=500)
    logo_description: str = Field(default="", max_length=1000)
    photo: str | None = Field(default=None, pattern=r"^[a-zA-Z0-9_-]{1,80}$")


class PlanPart(SetupModel):
    block_key: str = Field(min_length=1, max_length=80)
    quantity: int = Field(ge=1, le=1000)


class PlanPrint(SetupModel):
    block_key: str = Field(min_length=1, max_length=80)
    expected_text: str = Field(min_length=1, max_length=500)


class PlanStep(SetupModel):
    title: Name
    instruction: str = Field(min_length=1, max_length=4000)
    parts: list[PlanPart] = Field(min_length=1, max_length=20)
    print_check: PlanPrint | None
    reference_suggestion: str = Field(max_length=1000)
    limitations: list[str] = Field(max_length=10)

    @model_validator(mode="after")
    def valid(self):
        if not self.instruction.strip() or any(
            not x.strip() or len(x) > 500 for x in self.limitations
        ):
            raise ValueError("Instructions and limitations must be bounded, nonblank text")
        ids = [p.block_key for p in self.parts]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate block assignment")
        if self.print_check and (
            not self.print_check.expected_text.strip()
            or not any(
                p.block_key == self.print_check.block_key and p.quantity == 1 for p in self.parts
            )
        ):
            raise ValueError("Text recognition needs one assigned target instance")
        return self


class AssemblyPlan(SetupModel):
    steps: list[PlanStep] = Field(min_length=1, max_length=20)


class SetupDescription(SetupModel):
    name: Name
    description: str = Field(min_length=1, max_length=4000)
    step_instructions: str = Field(default="", max_length=8000)
    blocks: list[SetupBlock] = Field(min_length=1, max_length=20)
    finished_photo: str | None = Field(default=None, pattern=r"^[a-zA-Z0-9_-]{1,80}$")

    @model_validator(mode="after")
    def valid_inventory(self):
        if not self.description.strip():
            raise ValueError("Describe the intended assembly")
        keys = [b.key for b in self.blocks]
        ids = [b.existing_id for b in self.blocks if b.existing_id]
        if len(keys) != len(set(keys)) or len(ids) != len(set(ids)):
            raise ValueError("Select each library block once and use unique block keys")
        return self


class SetupCommit(SetupDescription):
    request_id: UUID
    confirmed: Literal[True]
    source: Literal["manual", "meta", "template"]
    mode: Literal["simple", "advanced"]
    plan: AssemblyPlan
    step_photos: dict[str, str] = Field(default_factory=dict, max_length=20)


def validate_plan(plan: AssemblyPlan, inventory: list[SetupBlock]):
    available = {b.key: b.quantity for b in inventory}
    for step in plan.steps:
        for part in step.parts:
            if part.block_key not in available or part.quantity > available[part.block_key]:
                raise ValueError("Plan contains an unknown block or exceeds available quantity")
