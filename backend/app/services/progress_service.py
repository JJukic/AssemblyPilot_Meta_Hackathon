"""Version-bound progress, using an additive SQLite table and atomic final checks."""

import hashlib
import json
from datetime import UTC

from fastapi import HTTPException
from sqlmodel import Session, select

from app.db.tables import BlockFace, StepProgress, now
from app.models.workflow import StepProgressRead
from app.services.face_registry import public_face
from app.services.project_service import public_step, require_project, require_step
from app.services.run_service import current_run


def specification_id(session: Session, project_id: str, step_id: str) -> str:
    project = require_project(session, project_id)
    step = public_step(session, require_step(session, project_id, step_id))
    # Includes step/block revisions, quantities, selected reference order and all photo IDs.
    # Reverting an edit cannot resurrect old verification because revision timestamps change.
    data = {"project": project.model_dump(mode="json"), "step": step.model_dump(mode="json")}
    # A restarted assembly (new run) is a new progress scope: earlier verification no
    # longer matches, and a request begun in the old run fails its final identity check.
    # Projects without a run keep their original identity (no silent invalidation).
    run = current_run(session, project_id)
    if run is not None:
        data["run"] = run.id
    if step.face_constraint:
        data["faces"] = [
            public_face(session, face).model_dump(mode="json")
            for face in session.exec(
                select(BlockFace)
                .where(BlockFace.block_id == step.face_constraint.target_block_id)
                .order_by(BlockFace.id)
            ).all()
        ]
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def begin_progress(
    session: Session,
    project_id: str,
    step_id: str,
    revision: str,
    expected_spec: str | None = None,
    previous_id: str | None = None,
) -> str:
    fingerprint = specification_id(session, project_id, step_id)
    current = session.get(StepProgress, step_id)
    if expected_spec is not None and fingerprint != expected_spec:
        raise HTTPException(409, "The assembly specification changed. Start a new inspection.")
    if previous_id is not None and (current is None or current.inspection_id != previous_id):
        raise HTTPException(409, "This inspection was superseded. Start a new inspection.")
    row = current or StepProgress(step_id=step_id, specification_id=fingerprint, revision=revision)
    row.specification_id, row.revision, row.status = fingerprint, revision, "in_progress"
    row.verified_at = None
    # Retain the prior ID for retries if a provider request fails.
    row.inspection_id = previous_id
    session.add(row)
    return fingerprint


def complete_progress(
    session: Session, project_id: str, step_id: str, revision: str, fingerprint: str, verified: bool
) -> None:
    current_spec = specification_id(session, project_id, step_id)
    row = session.get(StepProgress, step_id)
    if current_spec != fingerprint or row is None or row.revision != revision:
        raise HTTPException(
            409, "The step or active inspection changed while AI was running. Inspect again."
        )
    row.inspection_id = revision
    row.status = "verified" if verified else "in_progress"
    row.verified_at = now() if verified else None
    session.add(row)


def read_progress(session: Session, project_id: str, step_id: str) -> StepProgressRead:
    fingerprint = specification_id(session, project_id, step_id)
    row = session.get(StepProgress, step_id)
    valid = row is not None and row.specification_id == fingerprint
    return StepProgressRead(
        step_id=step_id,
        specification_id=fingerprint,
        status=row.status if valid else "not_started",
        verified_at=row.verified_at.replace(tzinfo=UTC) if valid and row.verified_at else None,
    )
