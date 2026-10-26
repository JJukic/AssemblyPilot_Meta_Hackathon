"""Internal persistence models; API schemas deliberately exclude storage paths."""

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import CheckConstraint, UniqueConstraint
from sqlmodel import Field, SQLModel


def new_id() -> str:
    return str(uuid4())


def now() -> datetime:
    return datetime.now(UTC)


class BuildingBlock(SQLModel, table=True):
    __tablename__ = "building_blocks"
    __table_args__ = (
        CheckConstraint("length(trim(name)) > 0"),
        CheckConstraint("default_quantity > 0"),
        CheckConstraint("studs_x IS NULL OR studs_x >= 0"),
        CheckConstraint("studs_y IS NULL OR studs_y >= 0"),
        CheckConstraint("height_mm IS NULL OR height_mm >= 0"),
    )
    id: str = Field(default_factory=new_id, primary_key=True)
    name: str
    description: str | None = None
    category: str = "brick"
    color: str = "unspecified"
    shape: str = "rectangular"
    studs_x: int | None = None
    studs_y: int | None = None
    height_mm: float | None = None
    default_quantity: int = 1
    created_at: datetime = Field(default_factory=now)
    updated_at: datetime = Field(default_factory=now)


class AssemblyProject(SQLModel, table=True):
    __tablename__ = "assembly_projects"
    __table_args__ = (CheckConstraint("length(trim(name)) > 0"),)
    id: str = Field(default_factory=new_id, primary_key=True)
    name: str
    description: str | None = None
    created_at: datetime = Field(default_factory=now)
    updated_at: datetime = Field(default_factory=now)


class AssemblyStep(SQLModel, table=True):
    __tablename__ = "assembly_steps"
    __table_args__ = (
        UniqueConstraint("project_id", "position"),
        CheckConstraint("position > 0"),
        CheckConstraint("length(trim(title)) > 0"),
        CheckConstraint("length(trim(instruction)) > 0"),
    )
    id: str = Field(default_factory=new_id, primary_key=True)
    project_id: str = Field(foreign_key="assembly_projects.id", ondelete="CASCADE", index=True)
    position: int
    title: str
    instruction: str
    created_at: datetime = Field(default_factory=now)
    updated_at: datetime = Field(default_factory=now)


class AssemblyStepBlock(SQLModel, table=True):
    __tablename__ = "assembly_step_blocks"
    __table_args__ = (
        UniqueConstraint("step_id", "block_id"),
        CheckConstraint("required_quantity > 0"),
    )
    id: str = Field(default_factory=new_id, primary_key=True)
    step_id: str = Field(foreign_key="assembly_steps.id", ondelete="CASCADE", index=True)
    block_id: str = Field(foreign_key="building_blocks.id", ondelete="RESTRICT", index=True)
    required_quantity: int


class ReferenceImage(SQLModel, table=True):
    __tablename__ = "reference_images"
    __table_args__ = (
        CheckConstraint("(block_id IS NOT NULL) != (step_id IS NOT NULL)"),
        CheckConstraint("width > 0 AND height > 0"),
    )
    id: str = Field(default_factory=new_id, primary_key=True)
    block_id: str | None = Field(
        default=None, foreign_key="building_blocks.id", ondelete="CASCADE", index=True
    )
    step_id: str | None = Field(
        default=None, foreign_key="assembly_steps.id", ondelete="CASCADE", index=True
    )
    storage_path: str = Field(unique=True)
    original_filename: str
    mime_type: str = "image/jpeg"
    width: int
    height: int
    created_at: datetime = Field(default_factory=now)
