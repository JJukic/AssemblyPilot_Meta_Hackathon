"""Restart Assembly = a new run: progress re-scoped, nothing deleted, late old work rejected."""

import pytest
from fastapi import HTTPException
from sqlmodel import Session, select

from app.db.tables import AssemblyRun, StepProgress
from app.services.progress_service import begin_progress, complete_progress, specification_id


@pytest.fixture
def project(client):
    block = client.post(
        "/api/blocks", json={"name": "2x4", "color": "red", "studs_x": 2, "studs_y": 4}
    ).json()
    project = client.post("/api/projects", json={"name": "Run tower"}).json()
    base = f"/api/projects/{project['id']}"
    steps = [
        client.post(
            f"{base}/steps",
            json={
                "title": f"Step {i + 1}",
                "instruction": "Place the red brick.",
                "required_blocks": [{"block_id": block["id"], "required_quantity": 1}],
            },
        ).json()
        for i in range(3)
    ]
    placement = dict(
        target_block_id=block["id"],
        instance=1,
        evidence="measured",
        confirmed=True,
        dimensions=dict(x_mm=31.8, y_mm=9.6, z_mm=15.8),
        position_m=[0.0, 0.0032, 0.0],
        rotation_deg=[0.0, 0.0, 0.0],
    )
    assert (
        client.put(f"{base}/steps/{steps[0]['id']}/ar-placement", json=placement).status_code == 200
    )
    return client, project, base, steps, block


def verify(client, project_id, step_id, revision="rev"):
    with Session(client.app.state.engine) as session:
        fingerprint = begin_progress(session, project_id, step_id, revision)
        complete_progress(session, project_id, step_id, revision, fingerprint, True)
        session.commit()


def statuses(client, base):
    return [p["status"] for p in client.get(f"{base}/progress").json()]


def test_projects_without_a_run_keep_their_progress_identity(project):
    client, data, base, steps, _ = project
    assert client.get(f"{base}/assembly-run").json() == {
        "run_id": None,
        "number": 0,
        "started_at": None,
    }
    before = [p["specification_id"] for p in client.get(f"{base}/progress").json()]
    verify(client, data["id"], steps[0]["id"])
    assert statuses(client, base)[0] == "verified"
    assert [p["specification_id"] for p in client.get(f"{base}/progress").json()] == before


def test_restart_starts_a_new_run_on_step_1_with_every_step_unverified(project):
    client, data, base, steps, block = project
    for step in steps:
        verify(client, data["id"], step["id"])
    assert (
        client.put(f"{base}/ar-view", json={"step_id": steps[2]["id"], "revision": 0}).status_code
        == 200
    )
    assert statuses(client, base) == ["verified"] * 3
    kept = {
        "project": client.get(base).json(),
        "steps": client.get(f"{base}/steps").json(),
        "placement": client.get(f"{base}/steps/{steps[0]['id']}/ar-placement").json(),
        "block": client.get(f"/api/blocks/{block['id']}").json(),
    }
    old_specs = [p["specification_id"] for p in client.get(f"{base}/progress").json()]

    response = client.post(f"{base}/assembly-runs", json={"expected_run_id": None})
    assert response.status_code == 201
    run = response.json()
    assert run["number"] == 1 and run["run_id"]
    assert run["view"]["step_id"] == steps[0]["id"], "the new run starts on Step 1"
    assert client.get(f"{base}/ar-view").json() == run["view"]
    assert client.get(f"{base}/assembly-run").json()["run_id"] == run["run_id"]

    progress = client.get(f"{base}/progress").json()
    assert [p["status"] for p in progress] == ["not_started"] * 3, "no step verified in the new run"
    assert all(p["verified_at"] is None for p in progress)
    assert all(
        new != old
        for new, old in zip([p["specification_id"] for p in progress], old_specs, strict=True)
    )
    # Nothing was deleted or rewritten.
    assert client.get(base).json() == kept["project"]
    assert client.get(f"{base}/steps").json() == kept["steps"]
    assert client.get(f"{base}/steps/{steps[0]['id']}/ar-placement").json() == kept["placement"]
    assert client.get(f"/api/blocks/{block['id']}").json() == kept["block"]
    with Session(client.app.state.engine) as session:
        rows = session.exec(
            select(StepProgress).where(StepProgress.step_id.in_([s["id"] for s in steps]))
        ).all()
        assert len(rows) == 3 and all(r.status == "verified" for r in rows), (
            "earlier run history kept"
        )

    # A new check in the new run verifies normally again.
    verify(client, data["id"], steps[0]["id"], "rev-new")
    assert statuses(client, base) == ["verified", "not_started", "not_started"]


def test_late_request_from_the_old_run_can_never_verify_the_new_run(project):
    client, data, base, steps, _ = project
    with Session(client.app.state.engine) as session:
        fingerprint = begin_progress(session, data["id"], steps[0]["id"], "old-rev")
        session.commit()
    assert client.post(f"{base}/assembly-runs", json={"expected_run_id": None}).status_code == 201
    with Session(client.app.state.engine) as session, pytest.raises(HTTPException) as late:
        complete_progress(session, data["id"], steps[0]["id"], "old-rev", fingerprint, True)
    assert late.value.status_code == 409
    assert statuses(client, base)[0] != "verified"


def test_second_device_restart_with_a_stale_run_is_refused_and_runs_are_kept(project):
    client, data, base, steps, _ = project
    first = client.post(f"{base}/assembly-runs", json={"expected_run_id": None}).json()
    # Device B still believes no run exists: its restart must not stack another run.
    stale = client.post(f"{base}/assembly-runs", json={"expected_run_id": None})
    assert stale.status_code == 409
    assert client.get(f"{base}/assembly-run").json()["run_id"] == first["run_id"]
    # Device B cannot move the cursor with its old revision (no skipped step).
    assert (
        client.put(f"{base}/ar-view", json={"step_id": steps[1]["id"], "revision": 0}).status_code
        == 409
    )
    second = client.post(f"{base}/assembly-runs", json={"expected_run_id": first["run_id"]}).json()
    assert second["number"] == 2
    with Session(client.app.state.engine) as session:
        assert [
            r.number
            for r in session.exec(select(AssemblyRun).where(AssemblyRun.project_id == data["id"]))
        ] == [1, 2]
    with Session(client.app.state.engine) as session:
        assert (
            specification_id(session, data["id"], steps[0]["id"])
            == client.get(f"{base}/progress").json()[0]["specification_id"]
        )


def test_restart_validation(project):
    client, data, base, steps, _ = project
    assert (
        client.post(f"{base}/assembly-runs", json={"expected_run_id": None, "extra": 1}).status_code
        == 422
    )
    assert client.post("/api/projects/nope/assembly-runs", json={}).status_code == 404
    empty = client.post("/api/projects", json={"name": "Empty"}).json()
    assert client.post(f"/api/projects/{empty['id']}/assembly-runs", json={}).status_code == 409
