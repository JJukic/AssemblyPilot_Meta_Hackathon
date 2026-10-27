import base64
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.core.config import BACKEND_ROOT, Settings
from app.db.database import database_engine
from app.db.tables import AssemblyStep, AssemblyStepBlock, BuildingBlock, ReferenceImage
from app.main import create_app
from app.models.inspection_context import PreviousInspection
from app.services.image_processor import process_image
from app.services.inspection_context import build_inspection_context
from app.services.inspection_request import build_multimodal_request


def block(client, **fields):
    response = client.post("/api/blocks", json={"name": "Blue brick", "color": "blue", **fields})
    assert response.status_code == 201, response.text
    return response.json()


def project(client, name="Bridge"):
    response = client.post("/api/projects", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


def step(client, project_id, **fields):
    response = client.post(
        f"/api/projects/{project_id}/steps",
        json={
            "title": "Base",
            "instruction": "Place the base on the table.",
            **fields,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def upload(client, endpoint, image_bytes, **options):
    response = client.post(
        endpoint,
        files={
            "image": (
                options.get("filename", "reference.png"),
                image_bytes(options.get("format", "PNG")),
                "application/octet-stream",
            )
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_block_crud_and_filters(client):
    first = block(client, name=" Blue 2x4 ", category="custom prototype", studs_x=2, studs_y=4)
    second = block(client, name="Red cap", color="red", category="cap")
    assert first["name"] == "Blue 2x4"
    assert len(client.get("/api/blocks").json()) == 2
    for query in ["search=BLUE", "color=blue", "category=custom%20prototype"]:
        assert [b["id"] for b in client.get(f"/api/blocks?{query}").json()] == [first["id"]]
    assert client.get("/api/blocks?search=%25").json() == []
    changed = client.put(
        f"/api/blocks/{first['id']}",
        json={
            "name": "Renamed",
            "color": "green",
            "default_quantity": 4,
        },
    )
    assert changed.status_code == 200
    assert changed.json()["id"] == first["id"]
    assert changed.json()["created_at"] == first["created_at"]
    assert changed.json()["updated_at"] >= first["updated_at"]
    assert client.get(f"/api/blocks/{first['id']}").json()["default_quantity"] == 4
    assert client.delete(f"/api/blocks/{first['id']}").status_code == 204
    assert client.get(f"/api/blocks/{first['id']}").status_code == 404
    assert client.get(f"/api/blocks/{second['id']}").status_code == 200


def test_selected_step_photo_drives_context_and_actual_image_payload(client, settings, image_bytes):
    p = project(client)
    s = step(client, p["id"])
    endpoint = f"/api/projects/{p['id']}/steps/{s['id']}"
    first = upload(client, f"{endpoint}/images", image_bytes, filename="first.png")
    second = upload(client, f"{endpoint}/images", image_bytes, filename="second.png")
    response = client.put(f"{endpoint}/reference-image", json={"image_id": second["id"]})
    assert response.status_code == 200
    assert [image["id"] for image in response.json()["reference_images"]] == [
        second["id"], first["id"]
    ]
    context = client.get(f"{endpoint}/context").json()
    assert context["step_reference_image"] == second["url"]
    with Session(client.app.state.engine) as session:
        request = build_multimodal_request(
            session, settings, p["id"], s["id"], process_image(image_bytes(), settings)
        )
    assert request.images[1].reference_id == second["id"]
    assert request.images[1].role == "assembled_step_reference"
    assert client.get(first["url"]).status_code == 200


def test_reference_selection_rejects_other_steps_projects_blocks_and_missing(client, image_bytes):
    p, other = project(client), project(client, "Other")
    s, sibling = step(client, p["id"]), step(client, p["id"])
    foreign = step(client, other["id"])
    b = block(client)
    photos = [
        upload(client, f"/api/projects/{p['id']}/steps/{sibling['id']}/images", image_bytes),
        upload(client, f"/api/projects/{other['id']}/steps/{foreign['id']}/images", image_bytes),
        upload(client, f"/api/blocks/{b['id']}/images", image_bytes),
    ]
    endpoint = f"/api/projects/{p['id']}/steps/{s['id']}/reference-image"
    for image_id in [*(photo["id"] for photo in photos), "missing"]:
        assert client.put(endpoint, json={"image_id": image_id}).status_code == 404
    assert client.put(endpoint, json={"image_id": ""}).status_code == 422
    assert client.put(endpoint, json={}).status_code == 422
    assert client.put(
        f"/api/projects/{other['id']}/steps/{s['id']}/reference-image",
        json={"image_id": photos[0]["id"]},
    ).status_code == 404


def test_reference_selection_survives_restart_and_deleted_choice_falls_back(settings, image_bytes):
    with TestClient(create_app(settings)) as client:
        p = project(client)
        s = step(client, p["id"])
        endpoint = f"/api/projects/{p['id']}/steps/{s['id']}"
        first = upload(client, f"{endpoint}/images", image_bytes)
        second = upload(client, f"{endpoint}/images", image_bytes)
        assert client.put(
            f"{endpoint}/reference-image", json={"image_id": second["id"]}
        ).status_code == 200
    with TestClient(create_app(settings)) as client:
        assert client.get(f"{endpoint}/context").json()["step_reference_image"] == second["url"]
        assert client.delete(second["url"]).status_code == 204
        assert client.get(f"{endpoint}/context").json()["step_reference_image"] == first["url"]
        assert client.delete(f"/api/projects/{p['id']}").status_code == 204
        assert client.get(first["url"]).status_code == 404


@pytest.mark.parametrize(
    "fields",
    [
        {"name": ""},
        {"name": "   "},
        {"studs_x": -1},
        {"studs_y": -2},
        {"height_mm": -0.1},
        {"default_quantity": 0},
        {"default_quantity": -1},
        {"default_quantity": 1.5},
        {"id": "client-supplied-id"},
    ],
)
def test_invalid_blocks(client, fields):
    response = client.post("/api/blocks", json={"name": "Block", **fields})
    assert response.status_code == 422
    assert client.get("/api/blocks").json() == []


def test_zero_dimensions_and_unknown_category_are_valid(client):
    result = block(client, studs_x=0, studs_y=0, height_mm=0, category="one-off handmade piece")
    assert result["studs_x"] == 0


def test_project_crud(client):
    p = project(client)
    assert client.get("/api/projects").json()[0]["id"] == p["id"]
    assert client.put(f"/api/projects/{p['id']}", json={"name": "Tower"}).status_code == 200
    assert client.get(f"/api/projects/{p['id']}").json()["name"] == "Tower"
    assert client.post("/api/projects", json={"name": "  "}).status_code == 422
    assert client.delete(f"/api/projects/{p['id']}").status_code == 204
    assert client.get(f"/api/projects/{p['id']}").status_code == 404


def test_steps_order_update_delete_and_assignments(client):
    p, b = project(client), block(client)
    url = f"/api/projects/{p['id']}/steps"
    a = step(
        client,
        p["id"],
        title="First",
        required_blocks=[{"block_id": b["id"], "required_quantity": 2}],
    )
    c = step(client, p["id"], title="Third")
    mid = step(client, p["id"], title="Second", position=2)
    assert [s["title"] for s in client.get(url).json()] == ["First", "Second", "Third"]
    assert client.get(f"/api/projects/{p['id']}").json()["step_count"] == 3
    assert client.get(url).json()[0]["required_blocks"][0]["block"]["id"] == b["id"]
    assert client.delete(f"/api/blocks/{b['id']}").status_code == 409
    response = client.put(f"{url}/order", json={"step_ids": [c["id"], a["id"], mid["id"]]})
    assert response.status_code == 200
    assert [s["id"] for s in response.json()] == [c["id"], a["id"], mid["id"]]
    changed = client.put(
        f"{url}/{a['id']}",
        json={
            "title": "Moved first",
            "instruction": "Place two bricks.",
            "position": 1,
            "required_blocks": [{"block_id": b["id"], "required_quantity": 3}],
        },
    )
    assert changed.status_code == 200
    assert changed.json()["required_blocks"][0]["required_quantity"] == 3
    assert client.delete(f"{url}/{mid['id']}").status_code == 204
    remaining = client.get(url).json()
    assert [s["position"] for s in remaining] == [1, 2]
    assert [s["id"] for s in remaining] == [a["id"], c["id"]]
    assert client.delete(f"{url}/{a['id']}").status_code == 204
    assert client.delete(f"/api/blocks/{b['id']}").status_code == 204


@pytest.mark.parametrize("quantity", [0, -1, 1.5])
def test_invalid_quantities(client, quantity):
    p, b = project(client), block(client)
    response = client.post(
        f"/api/projects/{p['id']}/steps",
        json={
            "title": "Base",
            "instruction": "Place brick.",
            "required_blocks": [{"block_id": b["id"], "required_quantity": quantity}],
        },
    )
    assert response.status_code == 422


def test_invalid_and_duplicate_references_roll_back(client):
    p, b = project(client), block(client)
    url = f"/api/projects/{p['id']}/steps"
    payload = {
        "title": "Base",
        "instruction": "Place brick.",
        "required_blocks": [
            {"block_id": b["id"], "required_quantity": 1},
            {"block_id": b["id"], "required_quantity": 2},
        ],
    }
    assert client.post(url, json=payload).status_code == 422
    payload["required_blocks"] = [{"block_id": "missing", "required_quantity": 1}]
    assert client.post(url, json=payload).status_code == 404
    assert client.get(url).json() == []
    original = step(
        client, p["id"], required_blocks=[{"block_id": b["id"], "required_quantity": 1}]
    )
    assert client.put(f"{url}/{original['id']}", json=payload).status_code == 404
    assert client.get(url).json()[0] == original


def test_invalid_orders_and_cross_project_steps(client):
    p, other = project(client), project(client, "Other")
    first = step(client, p["id"])
    second = step(client, p["id"])
    alien = step(client, other["id"])
    url = f"/api/projects/{p['id']}/steps"
    for ids in [[], [first["id"]], [first["id"], first["id"]], [first["id"], alien["id"]]]:
        assert client.put(f"{url}/order", json={"step_ids": ids}).status_code == 409
    assert [s["id"] for s in client.get(url).json()] == [first["id"], second["id"]]
    assert client.delete(f"{url}/{alien['id']}").status_code == 404
    assert client.get(f"{url}/{alien['id']}/context").status_code == 404
    assert (
        client.post(url, json={"title": "X", "instruction": "X", "position": 9}).status_code == 422
    )


def test_concurrent_order_updates_remain_contiguous(client):
    p = project(client)
    ids = [step(client, p["id"])["id"] for _ in range(3)]
    url = f"/api/projects/{p['id']}/steps"
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda order: client.put(f"{url}/order", json={"step_ids": order}),
                [ids, list(reversed(ids))],
            )
        )
    assert all(response.status_code == 200 for response in responses)
    result = client.get(url).json()
    assert [s["position"] for s in result] == [1, 2, 3]
    assert {s["id"] for s in result} == set(ids)


@pytest.mark.parametrize("format", ["JPEG", "PNG", "WEBP"])
def test_reference_upload_and_retrieval(client, image_bytes, settings, format):
    b = block(client)
    url = f"/api/blocks/{b['id']}/images"
    first = upload(client, url, image_bytes, format=format, filename="../../private/reference.png")
    second = upload(client, url, image_bytes, filename="../../private/reference.png")
    assert first["id"] != second["id"]
    assert first["original_filename"] == "reference.png"
    assert "storage_path" not in first
    assert first["owner_id"] == b["id"]
    response = client.get(first["url"])
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert response.content.startswith(b"\xff\xd8")
    assert len(list(settings.upload_path.iterdir())) == 2
    assert len(client.get(f"/api/blocks/{b['id']}").json()["reference_images"]) == 2
    assert client.delete(first["url"]).status_code == 204
    assert client.get(first["url"]).status_code == 404
    assert client.get(second["url"]).status_code == 200


def test_bad_uploads_do_not_leave_files(client, settings, image_bytes):
    b = block(client)
    url = f"/api/blocks/{b['id']}/images"
    for data, expected in [(b"bad", 422), (image_bytes("GIF"), 415)]:
        assert client.post(url, files={"image": ("fake.jpg", data)}).status_code == expected
    settings.max_upload_bytes = 10
    assert client.post(url, files={"image": ("big.png", image_bytes("PNG"))}).status_code == 413
    assert client.get(f"/api/blocks/{b['id']}").json()["reference_images"] == []
    assert list(settings.upload_path.iterdir()) == []


def test_image_upload_transaction_failure_removes_file(client, settings, image_bytes, monkeypatch):
    b = block(client)

    def fail_commit(self):
        raise IntegrityError("simulated commit", {}, Exception("constraint"))

    with monkeypatch.context() as patch:
        patch.setattr(Session, "commit", fail_commit)
        response = client.post(
            f"/api/blocks/{b['id']}/images", files={"image": ("image.png", image_bytes("PNG"))}
        )
        assert response.status_code == 409
    assert list(settings.upload_path.iterdir()) == []
    assert client.get(f"/api/blocks/{b['id']}").json()["reference_images"] == []


def test_project_deletion_cleans_only_owned_data(client, settings, image_bytes):
    b = block(client)
    p, other = project(client), project(client, "Keep")
    a = step(client, p["id"], required_blocks=[{"block_id": b["id"], "required_quantity": 1}])
    kept = step(
        client, other["id"], required_blocks=[{"block_id": b["id"], "required_quantity": 2}]
    )
    block_image = upload(client, f"/api/blocks/{b['id']}/images", image_bytes)
    step_image = upload(client, f"/api/projects/{p['id']}/steps/{a['id']}/images", image_bytes)
    kept_image = upload(
        client, f"/api/projects/{other['id']}/steps/{kept['id']}/images", image_bytes
    )
    assert client.delete(f"/api/projects/{p['id']}").status_code == 204
    assert client.get(step_image["url"]).status_code == 404
    assert client.get(block_image["url"]).status_code == 200
    assert client.get(kept_image["url"]).status_code == 200
    assert len(list(settings.upload_path.iterdir())) == 2
    with Session(client.app.state.engine) as session:
        assert session.get(AssemblyStep, a["id"]) is None
        assert (
            session.exec(
                select(AssemblyStepBlock).where(AssemblyStepBlock.step_id == a["id"])
            ).all()
            == []
        )
    assert client.delete(f"/api/blocks/{b['id']}").status_code == 409
    assert client.delete(f"/api/projects/{other['id']}").status_code == 204
    assert client.delete(f"/api/blocks/{b['id']}").status_code == 204
    assert list(settings.upload_path.iterdir()) == []


def test_step_deletion_removes_photo_and_reindexes(client, image_bytes, settings):
    p = project(client)
    first, second = step(client, p["id"]), step(client, p["id"])
    photo = upload(client, f"/api/projects/{p['id']}/steps/{first['id']}/images", image_bytes)
    assert client.delete(f"/api/projects/{p['id']}/steps/{first['id']}").status_code == 204
    assert client.get(photo["url"]).status_code == 404
    assert client.get(f"/api/projects/{p['id']}/steps").json()[0]["id"] == second["id"]
    assert client.get(f"/api/projects/{p['id']}/steps").json()[0]["position"] == 1
    assert list(settings.upload_path.iterdir()) == []


def test_foreign_keys_and_image_ownership_enforced(client):
    b = block(client)
    with Session(client.app.state.engine) as session:
        assert session.exec(text("PRAGMA foreign_keys")).scalar() == 1
        session.add(AssemblyStep(project_id="missing", position=1, title="X", instruction="X"))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        session.add(
            ReferenceImage(storage_path="x.jpg", original_filename="x", width=100, height=100)
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        p = project(client)
        s = step(client, p["id"])
        session.add(
            ReferenceImage(
                block_id=b["id"],
                step_id=s["id"],
                storage_path="x.jpg",
                original_filename="x",
                width=100,
                height=100,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_media_rejects_unknown_traversal_and_symlinks(client, image_bytes, settings, tmp_path):
    assert client.get("/api/media/missing").status_code == 404
    assert client.get("/api/media/%2e%2e%2fREADME.md").status_code == 404
    b = block(client)
    photo = upload(client, f"/api/blocks/{b['id']}/images", image_bytes)
    with Session(client.app.state.engine) as session:
        record = session.get(ReferenceImage, photo["id"])
        file = settings.upload_path / record.storage_path
        file.unlink()
        outside = tmp_path / "private.jpg"
        outside.write_bytes(b"private")
        file.symlink_to(outside)
        assert client.get(photo["url"]).status_code == 404
        assert client.delete(photo["url"]).status_code == 404
        assert outside.read_bytes() == b"private"
        file.unlink()
        record.storage_path = "../private.jpg"
        session.add(record)
        session.commit()
    assert client.get(photo["url"]).status_code == 404


def test_inspection_context_is_scoped_and_accepts_transient_frame(client, image_bytes, settings):
    p = project(client)
    used, unused = block(client, name="Used"), block(client, name="Unrelated")
    s = step(client, p["id"], required_blocks=[{"block_id": used["id"], "required_quantity": 3}])
    block_photo = upload(client, f"/api/blocks/{used['id']}/images", image_bytes)
    step_photo = upload(client, f"/api/projects/{p['id']}/steps/{s['id']}/images", image_bytes)
    result = client.get(f"/api/projects/{p['id']}/steps/{s['id']}/context")
    assert result.status_code == 200
    context = result.json()
    assert [b["id"] for b in context["expected_blocks"]] == [used["id"]]
    assert unused["id"] not in result.text
    assert context["expected_blocks"][0]["required_quantity"] == 3
    assert context["expected_blocks"][0]["reference_images"][0]["url"] == block_photo["url"]
    assert context["step_reference_image"] == step_photo["url"]
    assert context["snapshot"] is None
    assert "storage_path" not in result.text and str(settings.upload_path) not in result.text
    files = list(settings.upload_path.iterdir())
    with Session(client.app.state.engine) as session:
        frame = process_image(image_bytes(), settings)
        full = build_inspection_context(
            session,
            p["id"],
            s["id"],
            frame,
            PreviousInspection(step_id=s["id"], notes="Human note"),
        )
    assert base64.b64decode(full.snapshot.jpeg_base64) == frame.jpeg_bytes
    assert full.previous_context.notes == "Human note"
    assert list(settings.upload_path.iterdir()) == files


def test_persistence_after_app_restart(settings, image_bytes):
    with TestClient(create_app(settings)) as first:
        b = block(first)
        p = project(first)
        s = step(first, p["id"], required_blocks=[{"block_id": b["id"], "required_quantity": 2}])
        photo = upload(first, f"/api/blocks/{b['id']}/images", image_bytes)
    with TestClient(create_app(settings)) as second:
        assert second.get(f"/api/blocks/{b['id']}").status_code == 200
        assert second.get(f"/api/projects/{p['id']}").json()["steps"][0]["id"] == s["id"]
        assert second.get(photo["url"]).status_code == 200


def test_paths_independent_of_cwd(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    settings = Settings(_env_file=None, database_url=f"sqlite:///{tmp_path / 'paths.db'}")
    assert settings.upload_path == BACKEND_ROOT / "data/uploads"
    engine = database_engine(settings)
    assert engine.url.database == str(tmp_path / "paths.db")
    engine.dispose()


def test_database_level_block_reference_restriction(client):
    p, b = project(client), block(client)
    step(client, p["id"], required_blocks=[{"block_id": b["id"], "required_quantity": 1}])
    with Session(client.app.state.engine) as session:
        session.delete(session.get(BuildingBlock, b["id"]))
        with pytest.raises(IntegrityError):
            session.commit()
