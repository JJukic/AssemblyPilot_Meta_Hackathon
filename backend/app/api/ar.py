import json

from fastapi import APIRouter, HTTPException, Response
from pydantic import ValidationError

from app.db.database import ReadSession, WriteSession
from app.db.tables import ARPlacement, ARView, now
from app.models.ar import (
    Placement,
    Placements,
    RunInput,
    Scene,
    SceneBlock,
    SceneExclusion,
    ViewInput,
)
from app.services.project_service import ordered_steps, public_step, require_project, require_step
from app.services.run_service import current_run, public_run, start_run

router = APIRouter(prefix="/api/projects/{project_id}", tags=["spatial guidance"])


def read_placements(session, step_id):
    """Read v1 (single object) and v2 rows without modifying storage.

    Lazy migration: v2 is written only when the step hologram is saved through
    /ar-placements; untouched legacy rows keep their original JSON forever.
    """
    row = session.get(ARPlacement, step_id)
    if not row:
        return Placements(placements=[])
    raw = json.loads(row.configuration_json)
    if "version" in raw:
        return Placements.model_validate(raw)
    return Placements(placements=[Placement.model_validate(raw)])


@router.get("/steps/{step_id}/ar-placements", response_model=Placements)
def get_placements(project_id: str, step_id: str, session: ReadSession):
    require_step(session, project_id, step_id)
    data = read_placements(session, step_id)
    for placement in data.placements:
        validate_target(session, project_id, step_id, placement)
    return data


@router.put("/steps/{step_id}/ar-placements", response_model=Placements)
def save_placements(project_id: str, step_id: str, data: Placements, session: WriteSession):
    step = require_step(session, project_id, step_id)
    for placement in data.placements:
        validate_target(session, project_id, step_id, placement)
        if placement.position_m[1] < 0:
            # Save-time rule only, so legacy rows remain readable.
            raise HTTPException(
                422, "Position Y is the bottom face of the block; it cannot be below the tabletop"
            )
    row = session.get(ARPlacement, step_id) or ARPlacement(step_id=step_id, configuration_json="")
    row.configuration_json = data.model_dump_json()
    session.add(row)
    step.updated_at = now()
    session.add(step)
    return data


@router.get("/steps/{step_id}/ar-scene", response_model=Scene)
def get_scene(project_id: str, step_id: str, session: ReadSession):
    current = require_step(session, project_id, step_id)
    blocks, excluded = [], []
    for step in ordered_steps(session, project_id):
        if step.position > current.position:
            break
        if step.id == current.id:
            # The current step's guidance must be valid; errors are explicit.
            for p in read_placements(session, step.id).placements:
                validate_target(session, project_id, step.id, p)
                blocks.append(SceneBlock(step_id=step.id, step_position=step.position, placement=p))
            continue
        # Earlier steps: an outdated block is left out (never drawn) and reported,
        # instead of hiding the whole AR view.
        try:
            earlier = read_placements(session, step.id).placements
        except (ValidationError, ValueError) as exc:
            excluded.append(SceneExclusion(
                step_id=step.id, step_position=step.position, reason=f"Unreadable guidance: {exc}"
            ))
            continue
        for p in earlier:
            try:
                validate_target(session, project_id, step.id, p)
            except HTTPException as exc:
                excluded.append(SceneExclusion(
                    step_id=step.id, step_position=step.position, reason=str(exc.detail)
                ))
                continue
            blocks.append(SceneBlock(step_id=step.id, step_position=step.position, placement=p))
    return Scene(blocks=blocks, excluded=excluded)


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
    placements = read_placements(session, step_id).placements
    if not placements:
        return None
    data = placements[0]
    validate_target(session, project_id, step_id, data)
    return data


@router.put("/steps/{step_id}/ar-placement", response_model=Placement)
def save_placement(project_id: str, step_id: str, data: Placement, session: WriteSession):
    validate_target(session, project_id, step_id, data)
    step = require_step(session, project_id, step_id)
    if len(read_placements(session, step_id).placements) > 1:
        raise HTTPException(409, "Use ar-placements to edit a multi-block hologram")
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
    if len(read_placements(session, step_id).placements) > 1:
        raise HTTPException(409, "Use ar-placements to clear a multi-block hologram")
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


@router.get("/assembly-run")
def get_run(project_id: str, session: ReadSession):
    require_project(session, project_id)
    return public_run(current_run(session, project_id))


@router.post("/assembly-runs", status_code=201)
def restart_run(project_id: str, data: RunInput, session: WriteSession):
    """Restart Assembly: a new run and the shared cursor back on Step 1, atomically.

    `expected_run_id` is the run the caller is restarting; if another device already
    started a newer run the request is refused (409) so two restarts never stack up.
    Nothing is deleted: project, blocks, references, placements, calibration and the
    earlier run (with its progress rows) stay as they are.
    """
    require_project(session, project_id)
    steps = ordered_steps(session, project_id)
    if not steps:
        raise HTTPException(409, "This project has no steps to assemble.")
    latest = current_run(session, project_id)
    if (latest.id if latest else None) != data.expected_run_id:
        raise HTTPException(
            409, "Another device already started a new assembly. Reload and continue."
        )
    run = start_run(session, project_id)
    row = session.get(ARView, project_id) or ARView(project_id=project_id, step_id=steps[0].id)
    row.step_id, row.revision = steps[0].id, (row.revision or 0) + 1
    session.add(row)
    return {**public_run(run), "view": {"step_id": row.step_id, "revision": row.revision}}
