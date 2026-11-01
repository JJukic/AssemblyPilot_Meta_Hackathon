from copy import deepcopy

import pytest
from sqlmodel import Session

from app.services.progress_service import specification_id


@pytest.fixture
def assembly(client):
    blocks = [
        client.post(
            "/api/blocks", json={"name": color, "color": color, "studs_x": 2, "studs_y": 4}
        ).json()
        for color in ["blue", "yellow"]
    ]
    project = client.post("/api/projects", json={"name": "AR tower"}).json()
    steps = [
        client.post(
            f"/api/projects/{project['id']}/steps",
            json={
                "title": f"Step {i + 1}",
                "instruction": "Place the block.",
                "required_blocks": [{"block_id": b["id"], "required_quantity": 1} for b in blocks],
            },
        ).json()
        for i in range(2)
    ]
    base = f"/api/projects/{project['id']}"
    data = dict(
        target_block_id=blocks[1]["id"],
        instance=1,
        evidence="measured",
        confirmed=True,
        dimensions=dict(x_mm=16.0, y_mm=9.6, z_mm=32.0),
        position_m=[0.0, 0.0096, 0.0],
        rotation_deg=[0.0, 90.0, 0.0],
        studs=dict(x=2, z=4, pitch_mm=8.0, diameter_mm=4.8, height_mm=1.8),
    )
    return base, steps, data


def test_optional_reversible_guidance_and_viewing_never_verifies(client, assembly):
    base, steps, data = assembly
    route = f"{base}/steps/{steps[1]['id']}/ar-placement"
    assert client.get(route).json() is None
    assert client.put(route, json=data).status_code == 200
    assert client.get(route).json()["position_m"] == [0.0, 0.0096, 0.0]
    assert client.get(f"{base}/ar-view").json() == {"step_id": steps[0]["id"], "revision": 0}
    assert (
        client.put(f"{base}/ar-view", json={"step_id": steps[1]["id"], "revision": 0}).status_code
        == 200
    )
    assert (
        client.put(f"{base}/ar-view", json={"step_id": steps[0]["id"], "revision": 0}).status_code
        == 409
    )
    assert all(p["status"] != "verified" for p in client.get(f"{base}/progress").json())
    assert client.delete(route).status_code == 204
    assert client.get(route).json() is None


@pytest.mark.parametrize(
    "fault",
    [
        "target",
        "instance",
        "bounds",
        "rotation",
        "dimension",
        "nan",
        "origin",
        "asset",
        "confirmation",
        "studs",
        "approximate_studs",
    ],
)
def test_invalid_guidance_rejected(client, assembly, fault):
    base, steps, data = assembly
    data = deepcopy(data)
    if fault == "target":
        data["target_block_id"] = "unknown"
    if fault == "instance":
        data["instance"] = 2
    if fault == "bounds":
        data["position_m"] = [3.0, 0.0, 0.0]
    if fault == "rotation":
        data["rotation_deg"] = [0.0, 361.0, 0.0]
    if fault == "dimension":
        data["dimensions"]["x_mm"] = 0
    if fault == "nan":
        data["position_m"] = ["NaN", 0.0, 0.0]
    if fault == "origin":
        data["origin"] = "iphone_charuco"
    if fault == "asset":
        data["asset_url"] = "https://untrusted.invalid/figure.glb"
    if fault == "confirmation":
        data["confirmed"] = False
    if fault == "studs":
        data["studs"]["pitch_mm"] = 100.0
    if fault == "approximate_studs":
        data["evidence"] = "approximate"
    assert client.put(f"{base}/steps/{steps[0]['id']}/ar-placement", json=data).status_code == 422


def test_guidance_changes_invalidate_progress_and_deleted_targets_cannot_render(client, assembly):
    base, steps, data = assembly
    project_id = base.split("/")[-1]
    step = steps[0]
    with Session(client.app.state.engine) as session:
        before = specification_id(session, project_id, step["id"])
    assert client.put(f"{base}/steps/{step['id']}/ar-placement", json=data).status_code == 200
    with Session(client.app.state.engine) as session:
        assert before != specification_id(session, project_id, step["id"])
    assert (
        client.put(
            f"{base}/steps/{step['id']}",
            json={
                "title": step["title"],
                "instruction": step["instruction"],
                "required_blocks": [],
            },
        ).status_code
        == 200
    )
    assert client.get(f"{base}/steps/{step['id']}/ar-placement").status_code == 422


def test_cross_project_view_denied(client, assembly):
    base, steps, _ = assembly
    other = client.post("/api/projects", json={"name": "Other"}).json()
    assert (
        client.put(
            f"/api/projects/{other['id']}/ar-view", json={"step_id": steps[0]["id"], "revision": 0}
        ).status_code
        == 404
    )
    assert client.get(f"{base}/steps/wrong/ar-placement").status_code == 404


def test_additive_upgrade_preserves_existing_project_and_upload(
    client, assembly, settings, image_bytes
):
    from app.db.database import database_engine

    base, steps, _ = assembly
    image = client.post(
        f"{base}/steps/{steps[0]['id']}/images",
        files={"image": ("reference.jpg", image_bytes(), "image/jpeg")},
    )
    assert image.status_code == 201
    before = client.get(base).json()
    # Simulate a pre-AR SQLite schema, using only this test's disposable database.
    with client.app.state.engine.begin() as connection:
        connection.exec_driver_sql("DROP TABLE ar_views")
        connection.exec_driver_sql("DROP TABLE ar_placements")
    upgraded = database_engine(settings)
    upgraded.dispose()
    assert client.get(base).json() == before
    assert client.get(image.json()["url"]).status_code == 200
    assert client.get(f"{base}/steps/{steps[0]['id']}/ar-placement").json() is None


def test_deleted_step_cascades_guidance_and_resets_view_safely(client, assembly):
    base, steps, data = assembly
    assert client.put(f"{base}/steps/{steps[0]['id']}/ar-placement", json=data).status_code == 200
    client.put(f"{base}/ar-view", json={"step_id": steps[0]["id"], "revision": 0})
    assert client.delete(f"{base}/steps/{steps[0]['id']}").status_code == 204
    assert client.get(f"{base}/ar-view").json() == {"step_id": steps[1]["id"], "revision": 0}
    assert client.delete(base).status_code == 204
