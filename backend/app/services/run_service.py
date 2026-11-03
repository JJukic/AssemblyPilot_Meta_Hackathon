"""Assembly runs: a new run re-scopes step progress without deleting anything."""

from sqlmodel import Session, col, select

from app.db.tables import AssemblyRun


def current_run(session: Session, project_id: str) -> AssemblyRun | None:
    return session.exec(
        select(AssemblyRun)
        .where(AssemblyRun.project_id == project_id)
        .order_by(col(AssemblyRun.number).desc())
        .limit(1)
    ).first()


def public_run(run: AssemblyRun | None) -> dict:
    if run is None:  # projects that never restarted keep their original progress scope
        return {"run_id": None, "number": 0, "started_at": None}
    return {"run_id": run.id, "number": run.number, "started_at": run.started_at.isoformat()}


def start_run(session: Session, project_id: str) -> AssemblyRun:
    latest = current_run(session, project_id)
    run = AssemblyRun(project_id=project_id, number=(latest.number if latest else 0) + 1)
    session.add(run)
    session.flush()
    return run
