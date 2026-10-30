from fastapi import HTTPException
from sqlmodel import Session, select

from app.db.tables import (
    AssemblyProject,
    AssemblyStep,
    AssemblyStepBlock,
    BlockFace,
    BuildingBlock,
    StepFaceConstraint,
    StepSpatialConstraint,
    now,
)
from app.models.faces import FaceConstraint
from app.models.geometry import StudOffsetConstraintRead
from app.models.projects import ProjectRead, StepBlockRead, StepInput, StepRead
from app.services.block_service import public_block, require_block
from app.services.media_service import images_for, public_image


def require_project(session: Session, project_id: str) -> AssemblyProject:
    project = session.get(AssemblyProject, project_id)
    if project is None:
        raise HTTPException(404, "Assembly project not found")
    return project


def ordered_steps(session: Session, project_id: str) -> list[AssemblyStep]:
    return list(
        session.exec(
            select(AssemblyStep)
            .where(AssemblyStep.project_id == project_id)
            .order_by(AssemblyStep.position, AssemblyStep.id)
        ).all()
    )


def require_step(session: Session, project_id: str, step_id: str) -> AssemblyStep:
    require_project(session, project_id)
    step = session.get(AssemblyStep, step_id)
    if step is None or step.project_id != project_id:
        raise HTTPException(404, "Step not found in this project")
    return step


def public_project(session: Session, project: AssemblyProject) -> ProjectRead:
    return ProjectRead(**project.model_dump(), step_count=len(ordered_steps(session, project.id)))


def public_step(session: Session, step: AssemblyStep) -> StepRead:
    assignments = session.exec(
        select(AssemblyStepBlock)
        .where(AssemblyStepBlock.step_id == step.id)
        .order_by(AssemblyStepBlock.id)
    ).all()
    constraint = session.exec(
        select(StepSpatialConstraint).where(StepSpatialConstraint.step_id == step.id)
    ).first()
    return StepRead(
        **step.model_dump(),
        face_constraint=FaceConstraint.model_validate(face.model_dump(exclude={"step_id"}))
        if (face := session.get(StepFaceConstraint, step.id))
        else None,
        required_blocks=[
            StepBlockRead(
                block_id=item.block_id,
                required_quantity=item.required_quantity,
                block=public_block(session, require_block(session, item.block_id)),
            )
            for item in assignments
        ],
        reference_images=[public_image(image) for image in images_for(session, step_id=step.id)],
        spatial_constraint=StudOffsetConstraintRead.model_validate(
            constraint.model_dump(exclude={"step_id"})
        )
        if constraint
        else None,
    )


def replace_blocks(session: Session, step: AssemblyStep, data: StepInput):
    # Validate all references before touching existing associations.
    blocks = {item.block_id: require_block(session, item.block_id) for item in data.required_blocks}
    if data.spatial_constraint:
        validate_spatial_constraint(blocks, data.spatial_constraint)
    face_rule = session.get(StepFaceConstraint, step.id)
    if data.face_constraint:
        face = session.get(BlockFace, data.face_constraint.required_face_id)
        if face is None or face.block_id != data.face_constraint.target_block_id:
            raise HTTPException(422, "Required face must belong to the target block")
        if (
            next(
                item.required_quantity
                for item in data.required_blocks
                if item.block_id == face.block_id
            )
            != 1
        ):
            raise HTTPException(422, "Face inspection requires one target instance")
        if face_rule:
            face_rule.sqlmodel_update(data.face_constraint.model_dump())
        else:
            face_rule = StepFaceConstraint(step_id=step.id, **data.face_constraint.model_dump())
        session.add(face_rule)
    elif face_rule:
        session.delete(face_rule)
    existing = session.exec(
        select(AssemblyStepBlock).where(AssemblyStepBlock.step_id == step.id)
    ).all()
    for item in existing:
        session.delete(item)
    session.flush()
    for item in data.required_blocks:
        session.add(AssemblyStepBlock(step_id=step.id, **item.model_dump()))
    existing_constraint = session.exec(
        select(StepSpatialConstraint).where(StepSpatialConstraint.step_id == step.id)
    ).first()
    if data.spatial_constraint:
        values = data.spatial_constraint.model_dump()
        if existing_constraint:
            existing_constraint.sqlmodel_update(values)
            session.add(existing_constraint)
        else:
            session.add(StepSpatialConstraint(step_id=step.id, **values))
    elif existing_constraint:
        session.delete(existing_constraint)
    session.flush()


def validate_spatial_constraint(blocks: dict[str, BuildingBlock], constraint) -> None:
    """Validate the deliberately narrow first metrology mode."""

    target = blocks[constraint.target_block_id]
    reference = blocks[constraint.reference_block_id]
    for role, block in (("target", target), ("reference", reference)):
        if (
            block.shape.lower() != "rectangular"
            or sorted((block.studs_x or 0, block.studs_y or 0)) != [2, 4]
            or block.height_mm is None
            or block.height_mm <= 0
        ):
            raise HTTPException(
                422,
                f"The first geometric mode supports registered rectangular 2x4 blocks; "
                f"the {role} block is unsupported.",
            )
        if block.color.lower() not in {"red", "yellow", "blue", "green", "orange"}:
            raise HTTPException(
                422,
                f"The first geometric mode cannot associate the {role} color deterministically. "
                "Use red, yellow, blue, green or orange.",
            )
    if target.color.lower() == reference.color.lower():
        raise HTTPException(
            422,
            "Target and reference need different registered colors for deterministic association.",
        )
    if abs(constraint.reference_surface_height_mm - reference.height_mm) > 0.5:
        raise HTTPException(
            422,
            "Reference surface height must match the registered reference block height "
            "within 0.5 mm.",
        )
    expected_target_height = constraint.reference_surface_height_mm + target.height_mm
    if abs(constraint.target_surface_height_mm - expected_target_height) > 0.5:
        raise HTTPException(
            422,
            "Target surface height must describe one target block stacked directly above "
            "the reference surface (within 0.5 mm).",
        )


def apply_order(session: Session, steps: list[AssemblyStep]):
    # Two passes avoid transient unique(project_id, position) collisions inside the transaction.
    offset = max((step.position for step in steps), default=0) + 1
    for index, step in enumerate(steps):
        step.position = offset + index
        session.add(step)
    session.flush()
    for index, step in enumerate(steps, 1):
        step.position = index
        step.updated_at = now()
        session.add(step)
    session.flush()


def touch_project(session: Session, project_id: str):
    project = require_project(session, project_id)
    project.updated_at = now()
    session.add(project)
