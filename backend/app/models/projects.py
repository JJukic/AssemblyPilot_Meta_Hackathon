from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.blocks import BlockRead, ImageRead, Name


class ProjectInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Name
    description: str | None = Field(default=None, max_length=4000)


class ProjectRead(ProjectInput):
    id: str
    created_at: datetime
    updated_at: datetime
    step_count: int


class StepBlockInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    block_id: str = Field(min_length=1, max_length=100)
    required_quantity: int = Field(gt=0, le=100000)


class StepBlockRead(StepBlockInput):
    block: BlockRead


class StepInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Name
    instruction: str = Field(min_length=1, max_length=10000)
    position: int | None = Field(default=None, gt=0)
    required_blocks: list[StepBlockInput] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def validate_step(self) -> "StepInput":
        self.instruction = self.instruction.strip()
        if not self.instruction:
            raise ValueError("Instruction cannot be empty")
        ids = [block.block_id for block in self.required_blocks]
        if len(ids) != len(set(ids)):
            raise ValueError("Assign each block only once; adjust its quantity instead")
        return self


class StepRead(BaseModel):
    id: str
    project_id: str
    position: int
    title: str
    instruction: str
    created_at: datetime
    updated_at: datetime
    required_blocks: list[StepBlockRead]
    reference_images: list[ImageRead]


class ProjectDetail(ProjectRead):
    steps: list[StepRead]


class StepOrder(BaseModel):
    model_config = ConfigDict(extra="forbid")
    step_ids: list[str]


class ReferenceSelectionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    image_id: str = Field(min_length=1, max_length=100)
