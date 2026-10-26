from fastapi import HTTPException
from sqlmodel import Session, select

from app.db.tables import AssemblyProject, AssemblyStep, AssemblyStepBlock, now
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
    return StepRead(
        **step.model_dump(),
        required_blocks=[
            StepBlockRead(
                block_id=item.block_id,
                required_quantity=item.required_quantity,
                block=public_block(session, require_block(session, item.block_id)),
            )
            for item in assignments
        ],
        reference_images=[public_image(image) for image in images_for(session, step_id=step.id)],
    )


def replace_blocks(session: Session, step: AssemblyStep, data: StepInput):
    # Validate all references before touching existing associations.
    for item in data.required_blocks:
        require_block(session, item.block_id)
    existing = session.exec(
        select(AssemblyStepBlock).where(AssemblyStepBlock.step_id == step.id)
    ).all()
    for item in existing:
        session.delete(item)
    session.flush()
    for item in data.required_blocks:
        session.add(AssemblyStepBlock(step_id=step.id, **item.model_dump()))
    session.flush()


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
