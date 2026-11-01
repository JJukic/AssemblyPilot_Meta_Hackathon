from fastapi import APIRouter, HTTPException, Response

from app.db.database import ReadSession, WriteSession
from app.db.tables import ARPlacement, ARView, now
from app.models.ar import Placement, ViewInput
from app.services.project_service import ordered_steps, public_step, require_project, require_step

router = APIRouter(prefix="/api/projects/{project_id}", tags=["spatial guidance"])


def validate_target(session, project_id, step_id, data):
    step = public_step(session, require_step(session, project_id, step_id))
    target = next((b for b in step.required_blocks if b.block_id == data.target_block_id), None)
    if not target or data.instance > target.required_quantity:
        raise HTTPException(422, "Select an assigned block instance")
    if data.evidence == "measured" and target.block.shape.lower() != "rectangular":
        raise HTTPException(
            422, "Procedural measured geometry requires a rectangular registered block"
        )
    if data.studs and (
        target.block.studs_x != data.studs.x or target.block.studs_y != data.studs.z
    ):
        raise HTTPException(422, "Confirmed stud grid must agree with registered block metadata")


@router.get("/steps/{step_id}/ar-placement", response_model=Placement | None)
def get_placement(project_id: str, step_id: str, session: ReadSession):
    require_step(session, project_id, step_id)
    row = session.get(ARPlacement, step_id)
    if not row:
        return None
    data = Placement.model_validate_json(row.configuration_json)
    validate_target(session, project_id, step_id, data)
    return data


@router.put("/steps/{step_id}/ar-placement", response_model=Placement)
def save_placement(project_id: str, step_id: str, data: Placement, session: WriteSession):
    validate_target(session, project_id, step_id, data)
    step = require_step(session, project_id, step_id)
    row = session.get(ARPlacement, step_id) or ARPlacement(step_id=step_id, configuration_json="")
    row.configuration_json = data.model_dump_json()
    session.add(row)
    # Changing intended guidance invalidates previously recorded progress, but never verifies it.
    step.updated_at = now()
    session.add(step)
    return data


@router.delete("/steps/{step_id}/ar-placement", status_code=204)
def delete_placement(project_id: str, step_id: str, session: WriteSession):
    step = require_step(session, project_id, step_id)
    row = session.get(ARPlacement, step_id)
    if row:
        session.delete(row)
        step.updated_at = now()
        session.add(step)
    return Response(status_code=204)


def view(session, project_id):
    require_project(session, project_id)
    steps = ordered_steps(session, project_id)
    row = session.get(ARView, project_id)
    return {
        "step_id": row.step_id if row else steps[0].id if steps else None,
        "revision": row.revision if row else 0,
    }


@router.get("/ar-view")
def get_view(project_id: str, session: ReadSession):
    return view(session, project_id)


@router.put("/ar-view")
def set_view(project_id: str, data: ViewInput, session: WriteSession):
    require_step(session, project_id, data.step_id)
    current = view(session, project_id)
    if current["revision"] != data.revision:
        raise HTTPException(409, "Another device changed the viewed step. Reload and retry.")
    row = session.get(ARView, project_id) or ARView(project_id=project_id, step_id=data.step_id)
    row.step_id, row.revision = data.step_id, data.revision + 1
    session.add(row)
    return {"step_id": row.step_id, "revision": row.revision}
