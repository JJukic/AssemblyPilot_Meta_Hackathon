from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile

from app.core.config import Settings, get_settings
from app.db.database import ReadSession, WriteSession
from app.db.tables import AssemblyStep, now
from app.models.blocks import ImageRead
from app.models.inspection_context import InspectionContext
from app.models.projects import StepInput, StepOrder, StepRead
from app.services.inspection_context import build_inspection_context
from app.services.media_service import images_for, schedule_image_cleanup, store_image
from app.services.project_service import (
    apply_order,
    ordered_steps,
    public_step,
    replace_blocks,
    require_project,
    require_step,
    touch_project,
)

router = APIRouter(prefix="/api/projects/{project_id}/steps", tags=["steps"])
Config = Annotated[Settings, Depends(get_settings)]


@router.get("", response_model=list[StepRead])
def list_steps(project_id: str, session: ReadSession):
    require_project(session, project_id)
    return [public_step(session, step) for step in ordered_steps(session, project_id)]


@router.post("", response_model=StepRead, status_code=201)
def create_step(project_id: str, data: StepInput, session: WriteSession):
    require_project(session, project_id)
    steps = ordered_steps(session, project_id)
    position = data.position if data.position is not None else len(steps) + 1
    if position > len(steps) + 1:
        raise HTTPException(422, "Step position must be within the project order")
    step = AssemblyStep(
        project_id=project_id,
        position=len(steps) + 1,
        title=data.title,
        instruction=data.instruction,
    )
    session.add(step)
    session.flush()
    replace_blocks(session, step, data)
    steps.insert(position - 1, step)
    apply_order(session, steps)
    touch_project(session, project_id)
    return public_step(session, step)


@router.put("/order", response_model=list[StepRead])
def reorder_steps(project_id: str, data: StepOrder, session: WriteSession):
    require_project(session, project_id)
    steps = ordered_steps(session, project_id)
    by_id = {step.id: step for step in steps}
    if len(data.step_ids) != len(steps) or set(data.step_ids) != set(by_id):
        raise HTTPException(
            409, "Order must contain every current step exactly once; reload the project"
        )
    ordered = [by_id[step_id] for step_id in data.step_ids]
    apply_order(session, ordered)
    touch_project(session, project_id)
    return [public_step(session, step) for step in ordered]


@router.put("/{step_id}", response_model=StepRead)
def update_step(project_id: str, step_id: str, data: StepInput, session: WriteSession):
    step = require_step(session, project_id, step_id)
    steps = ordered_steps(session, project_id)
    position = data.position if data.position is not None else step.position
    if position > len(steps):
        raise HTTPException(422, "Step position must be within the project order")
    replace_blocks(session, step, data)
    step.title, step.instruction, step.updated_at = data.title, data.instruction, now()
    steps.remove(step)
    steps.insert(position - 1, step)
    apply_order(session, steps)
    touch_project(session, project_id)
    return public_step(session, step)


@router.delete("/{step_id}", status_code=204)
def delete_step(project_id: str, step_id: str, session: WriteSession, settings: Config):
    step = require_step(session, project_id, step_id)
    schedule_image_cleanup(session, settings, images_for(session, step_id=step_id))
    session.delete(step)
    session.flush()
    apply_order(session, ordered_steps(session, project_id))
    touch_project(session, project_id)
    return Response(status_code=204)


@router.post("/{step_id}/images", response_model=ImageRead, status_code=201)
def upload_step_image(
    project_id: str,
    step_id: str,
    session: WriteSession,
    settings: Config,
    image: Annotated[UploadFile, File()],
):
    step = require_step(session, project_id, step_id)
    try:
        result = store_image(
            session,
            settings,
            image.file.read(settings.max_upload_bytes + 1),
            image.filename,
            step_id=step_id,
        )
        step.updated_at = now()
        session.add(step)
        touch_project(session, project_id)
        return result
    finally:
        image.file.close()


@router.get("/{step_id}/context", response_model=InspectionContext)
def inspection_context(project_id: str, step_id: str, session: ReadSession):
    return build_inspection_context(session, project_id, step_id)
