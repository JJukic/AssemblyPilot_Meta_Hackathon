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


# ---------- Multi-block, cumulative step holograms (v2) ----------


def _step_blocks(client, base, step_id):
    step = client.get(f"{base}/steps").json()
    return next(s for s in step if s["id"] == step_id)["required_blocks"]


def _placement(data, block_id, x=0.0, y=0.0, instance=1):
    p = deepcopy(data)
    p.update(target_block_id=block_id, instance=instance, position_m=[x, y, 0.0])
    return p


def test_step_hologram_stores_several_blocks_and_stacked_heights(client, assembly):
    base, steps, data = assembly
    blue_id, yellow_id = [b["block_id"] for b in _step_blocks(client, base, steps[0]["id"])]
    route = f"{base}/steps/{steps[0]['id']}/ar-placements"
    assert client.get(route).json() == {"version": 2, "placements": []}
    # Yellow (9.6 mm body) on the table, blue stacked on it: blue bottom Y = 0.0096 m.
    body = {"version": 2, "placements": [
        _placement(data, yellow_id, y=0.0),
        _placement(data, blue_id, y=0.0096),
    ]}
    saved = client.put(route, json=body)
    assert saved.status_code == 200, saved.text
    got = client.get(route).json()["placements"]
    assert [p["position_m"][1] for p in got] == [0.0, 0.0096]
    # Legacy single endpoint never silently edits a multi-block hologram.
    legacy = f"{base}/steps/{steps[0]['id']}/ar-placement"
    assert client.get(legacy).json()["target_block_id"] == yellow_id
    assert client.put(legacy, json=data).status_code == 409
    assert client.delete(legacy).status_code == 409
    assert len(client.get(route).json()["placements"]) == 2


@pytest.mark.parametrize(
    "fault",
    ["duplicate_instance", "below_table", "unassigned_instance", "foreign_block"],
)
def test_step_hologram_validation(client, assembly, fault):
    base, steps, data = assembly
    blue_id, yellow_id = [b["block_id"] for b in _step_blocks(client, base, steps[0]["id"])]
    placements = [_placement(data, yellow_id), _placement(data, blue_id, x=0.05)]
    if fault == "duplicate_instance":
        placements.append(_placement(data, yellow_id, x=0.1))
    elif fault == "below_table":
        placements[1]["position_m"][1] = -0.001
    elif fault == "unassigned_instance":
        placements[1]["instance"] = 2  # step requires only one blue
    else:
        placements[1]["target_block_id"] = "not-in-this-step"
    response = client.put(
        f"{base}/steps/{steps[0]['id']}/ar-placements",
        json={"version": 2, "placements": placements},
    )
    assert response.status_code == 422
    assert client.get(f"{base}/steps/{steps[0]['id']}/ar-placements").json()["placements"] == []


def test_legacy_single_placement_is_read_as_v2_without_rewriting_storage(client, assembly):
    from app.db.tables import ARPlacement

    base, steps, data = assembly
    step_id = steps[1]["id"]
    assert client.put(f"{base}/steps/{step_id}/ar-placement", json=data).status_code == 200
    with Session(client.app.state.engine) as session:
        raw_before = session.get(ARPlacement, step_id).configuration_json
    assert '"version"' not in raw_before  # genuine legacy v1 row
    got = client.get(f"{base}/steps/{step_id}/ar-placements").json()
    assert got["version"] == 2 and len(got["placements"]) == 1
    assert got["placements"][0]["position_m"] == data["position_m"]
    scene = client.get(f"{base}/steps/{step_id}/ar-scene").json()
    assert [b["step_id"] for b in scene["blocks"]] == [step_id]
    with Session(client.app.state.engine) as session:
        assert session.get(ARPlacement, step_id).configuration_json == raw_before  # lazy
    # Saving through v2 is the only rewrite.
    assert client.put(f"{base}/steps/{step_id}/ar-placements", json=got).status_code == 200
    with Session(client.app.state.engine) as session:
        assert '"version":2' in session.get(ARPlacement, step_id).configuration_json


def test_scene_is_cumulative_and_never_verifies(client, assembly):
    base, steps, data = assembly
    blue_id, yellow_id = [b["block_id"] for b in _step_blocks(client, base, steps[0]["id"])]
    client.put(f"{base}/steps/{steps[0]['id']}/ar-placements",
               json={"version": 2, "placements": [_placement(data, yellow_id)]})
    client.put(f"{base}/steps/{steps[1]['id']}/ar-placements",
               json={"version": 2, "placements": [_placement(data, blue_id, y=0.0096)]})
    first = client.get(f"{base}/steps/{steps[0]['id']}/ar-scene").json()
    assert [b["step_position"] for b in first["blocks"]] == [1]
    second = client.get(f"{base}/steps/{steps[1]['id']}/ar-scene").json()
    assert [(b["step_position"], b["placement"]["target_block_id"]) for b in second["blocks"]] == [
        (1, yellow_id), (2, blue_id)
    ]
    assert second["excluded"] == []
    # Viewing / saving guidance never creates verified progress.
    assert all(p["status"] != "verified" for p in client.get(f"{base}/progress").json())


def test_scene_excludes_outdated_earlier_blocks_but_rejects_invalid_current_ones(client, assembly):
    base, steps, data = assembly
    blue_id, yellow_id = [b["block_id"] for b in _step_blocks(client, base, steps[0]["id"])]
    client.put(f"{base}/steps/{steps[0]['id']}/ar-placements",
               json={"version": 2, "placements": [_placement(data, yellow_id)]})
    client.put(f"{base}/steps/{steps[1]['id']}/ar-placements",
               json={"version": 2, "placements": [_placement(data, blue_id)]})
    # Step 1 no longer requires yellow: its old block cannot be rendered any more.
    step = steps[0]
    client.put(f"{base}/steps/{step['id']}", json={
        "title": step["title"], "instruction": step["instruction"],
        "required_blocks": [{"block_id": blue_id, "required_quantity": 1}],
    })
    scene = client.get(f"{base}/steps/{steps[1]['id']}/ar-scene").json()
    assert [b["step_position"] for b in scene["blocks"]] == [2]
    assert scene["excluded"][0]["step_position"] == 1
    assert client.get(f"{base}/steps/{steps[0]['id']}/ar-scene").status_code == 422
