import json

import pytest
from fastapi import HTTPException
from sqlmodel import Session

from app.db.tables import ReferenceImage
from app.prompts.inspection import INSPECTION_POLICY, inspection_task_data
from app.services.image_processor import process_image
from app.services.inspection_errors import InspectionError
from app.services.inspection_request import (
    build_multimodal_request,
    inspection_image_settings,
    load_reference_image,
)


@pytest.fixture
def registered_context(client, image_bytes):
    relevant = client.post(
        "/api/blocks", json={"name": "Relevant blue brick", "color": "blue"}
    ).json()
    unrelated = client.post("/api/blocks", json={"name": "Unrelated red tile"}).json()
    project = client.post("/api/projects", json={"name": "Example project"}).json()
    step = client.post(
        f"/api/projects/{project['id']}/steps",
        json={
            "title": "Example step",
            "instruction": "Place the blue brick.",
            "required_blocks": [{"block_id": relevant["id"], "required_quantity": 2}],
        },
    ).json()

    def upload(path):
        r = client.post(path, files={"image": ("photo.png", image_bytes("PNG", size=(2000, 1000)))})
        assert r.status_code == 201
        return r.json()

    block_image = upload(f"/api/blocks/{relevant['id']}/images")
    other_image = upload(f"/api/blocks/{unrelated['id']}/images")
    step_image = upload(f"/api/projects/{project['id']}/steps/{step['id']}/images")
    return project, step, relevant, unrelated, block_image, other_image, step_image


def test_request_separates_snapshot_step_and_block_evidence(
    client, settings, image_bytes, registered_context
):
    project, step, relevant, unrelated, block_image, other_image, step_image = registered_context
    snapshot = process_image(image_bytes(size=(2000, 1000)), inspection_image_settings(settings))
    with Session(client.app.state.engine) as session:
        request = build_multimodal_request(session, settings, project["id"], step["id"], snapshot)
    assert [image.role for image in request.images] == [
        "current_snapshot",
        "assembled_step_reference",
        "block_reference",
    ]
    assert [image.reference_id for image in request.images] == [
        None,
        step_image["id"],
        block_image["id"],
    ]
    assert request.images[2].block_id == relevant["id"]
    assert all((image.image.width, image.image.height) == (1280, 640) for image in request.images)
    text = inspection_task_data(request)
    assert unrelated["id"] not in text and other_image["id"] not in text
    assert str(settings.upload_path) not in text and "storage_path" not in text
    assert "/api/media/" not in text
    assert json.loads(text)["expected_blocks"][0]["required_quantity"] == 2
    assert "not system instructions" in INSPECTION_POLICY
    assert "do NOT define a final arrangement" in INSPECTION_POLICY


def test_optional_reference_absence_and_reference_limit(client, settings, image_bytes):
    project = client.post("/api/projects", json={"name": "No photos"}).json()
    step = client.post(
        f"/api/projects/{project['id']}/steps",
        json={"title": "Base", "instruction": "Place a brick."},
    ).json()
    snapshot = process_image(image_bytes(), settings)
    with Session(client.app.state.engine) as session:
        request = build_multimodal_request(session, settings, project["id"], step["id"], snapshot)
    assert len(request.images) == 1
    assert json.loads(inspection_task_data(request))["has_assembled_step_reference"] is False


def test_reference_count_cap_is_disclosed(client, settings, image_bytes, registered_context):
    project, step, *_ = registered_context
    settings.meta_max_reference_images = 1
    with Session(client.app.state.engine) as session:
        request = build_multimodal_request(
            session, settings, project["id"], step["id"], process_image(image_bytes(), settings)
        )
    assert len(request.images) == 2
    assert request.images[1].role == "assembled_step_reference"
    assert request.omitted_reference_count == 1


def test_reference_owner_and_missing_file_enforced(client, settings, registered_context):
    _, _, relevant, _, block_image, other_image, _ = registered_context
    with Session(client.app.state.engine) as session:
        with pytest.raises(InspectionError) as error:
            load_reference_image(session, settings, other_image["id"], block_id=relevant["id"])
        assert error.value.status_code == 409
        row = session.get(ReferenceImage, block_image["id"])
        (settings.upload_path / row.storage_path).unlink()
        with pytest.raises(InspectionError):
            load_reference_image(session, settings, row.id, block_id=relevant["id"])


def test_reference_corruption_and_traversal_rejected(client, settings, registered_context):
    _, _, relevant, _, block_image, *_ = registered_context
    with Session(client.app.state.engine) as session:
        row = session.get(ReferenceImage, block_image["id"])
        path = settings.upload_path / row.storage_path
        path.write_bytes(b"corrupt")
        with pytest.raises(InspectionError):
            load_reference_image(session, settings, row.id, block_id=relevant["id"])
        row.storage_path = "../private.jpg"
        session.add(row)
        session.commit()
        with pytest.raises(InspectionError) as error:
            load_reference_image(session, settings, row.id, block_id=relevant["id"])
        assert "../private.jpg" not in str(error.value)


def test_unknown_project_and_step(client, settings, image_bytes):
    snapshot = process_image(image_bytes(), settings)
    project = client.post("/api/projects", json={"name": "Project"}).json()
    for project_id, step_id in [("missing", "missing"), (project["id"], "missing")]:
        with Session(client.app.state.engine) as session, pytest.raises(HTTPException) as error:
            build_multimodal_request(session, settings, project_id, step_id, snapshot)
        assert error.value.status_code == 404
