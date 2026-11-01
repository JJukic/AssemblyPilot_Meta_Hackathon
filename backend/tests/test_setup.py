"""Real atomic persistence and mocked Meta HTTP; never paid inference."""

import json
from uuid import uuid4

import httpx
import pytest
import test_verification
from fastapi import HTTPException
from pydantic import SecretStr
from sqlmodel import Session

from app.api.setup import get_planner
from app.services.setup_planner import SetupPlanner

flow = test_verification.flow
photo = test_verification.photo


def description():
    return dict(
        name="Jury build",
        description="Place yellow on blue; yellow says Involve Me.",
        step_instructions="",
        finished_photo=None,
        blocks=[dict(key="yellow", name="Yellow block", color="yellow", quantity=1)],
    )


def plan():
    return {
        "steps": [
            dict(
                title="Place yellow",
                instruction="Place the yellow block on a flat surface.",
                parts=[dict(block_key="yellow", quantity=1)],
                print_check=None,
                reference_suggestion="Take a close side view.",
                limitations=[],
            )
        ]
    }


def commit_data():
    return dict(
        **description(),
        request_id=str(uuid4()),
        confirmed=True,
        source="manual",
        mode="simple",
        plan=plan(),
        step_photos={},
    )


def post(client, data, photos=None, endpoint="projects"):
    return client.post(
        f"/api/setup/{endpoint}",
        data={"payload": json.dumps(data)},
        files=[("photos", (key, value, "image/jpeg")) for key, value in (photos or {}).items()],
    )


def test_empty_library_manual_atomic_create_and_retry(client):
    data = commit_data()
    response = post(client, data)
    assert response.status_code == 201, response.text
    saved = response.json()
    assert len(saved["steps"]) == 1
    assert saved["steps"][0]["spatial_constraint"] is None
    assert saved["steps"][0]["face_constraint"] is None
    assert "simple_print" not in saved["steps"][0]
    assert post(client, data).json()["id"] == saved["id"]
    assert len(client.get("/api/projects").json()) == len(client.get("/api/blocks").json()) == 1
    data["name"] = "Changed after save"
    assert post(client, data).status_code == 409


@pytest.mark.parametrize("confirmed", [False, None, "true"])
def test_confirmation_required_before_any_writes(client, confirmed):
    data = commit_data()
    data["confirmed"] = confirmed
    assert post(client, data).status_code == 422
    assert client.get("/api/projects").json() == client.get("/api/blocks").json() == []


def test_existing_block_is_reused_without_overwriting_metadata(client):
    block = client.post(
        "/api/blocks", json={"name": "Own block", "color": "orange", "height_mm": 17.0}
    ).json()
    data = commit_data()
    data["blocks"][0]["existing_id"] = block["id"]
    saved = post(client, data).json()
    actual = saved["steps"][0]["required_blocks"][0]["block"]
    assert actual["id"] == block["id"] and actual["color"] == "orange" and actual["height_mm"] == 17
    assert len(client.get("/api/blocks").json()) == 1


def test_multistep_photos_reference_finished_only_on_final_step(client, image_bytes):
    data = commit_data()
    data["finished_photo"] = "finished"
    data["blocks"][0]["photo"] = "block"
    data["plan"]["steps"] *= 2
    saved = post(client, data, {"finished": image_bytes(), "block": image_bytes()}).json()
    assert saved["steps"][0]["reference_images"] == []
    assert len(saved["steps"][1]["reference_images"]) == 1
    assert len(saved["steps"][0]["required_blocks"][0]["block"]["reference_images"]) == 1
    data = commit_data()
    data["plan"]["steps"] *= 2
    data["step_photos"] = {"0": "one"}
    saved = post(client, data, {"one": image_bytes()}).json()
    assert len(saved["steps"][0]["reference_images"]) == 1
    assert not saved["steps"][1]["reference_images"]


@pytest.mark.parametrize(
    "fault",
    [
        "unknown_id",
        "quantity",
        "measurement",
        "no_parts",
        "print_target",
        "photo",
        "bad_photo",
        "empty_blocks",
    ],
)
def test_invalid_setup_never_persists(client, image_bytes, fault):
    data = commit_data()
    photos = {}
    step = data["plan"]["steps"][0]
    if fault == "unknown_id":
        step["parts"][0]["block_key"] = "invented"
    if fault == "quantity":
        step["parts"][0]["quantity"] = 2
    if fault == "measurement":
        step["height_mm"] = 9.6
    if fault == "no_parts":
        step["parts"] = []
    if fault == "print_target":
        step["print_check"] = dict(block_key="unknown", expected_text="Hi")
    if fault == "photo":
        data["finished_photo"] = "missing"
    if fault == "bad_photo":
        data["finished_photo"] = "bad"
        photos["bad"] = b"bad"
    if fault == "empty_blocks":
        data["blocks"] = []
    assert post(client, data, photos).status_code == 422
    assert not client.get("/api/projects").json() and not client.get("/api/blocks").json()


def test_failed_media_write_rolls_back_everything_and_retry_succeeds(
    client, settings, image_bytes, monkeypatch
):
    from app.api import setup

    real_store = setup.store_image
    data = commit_data()
    data["blocks"][0]["photo"] = "block"
    data["finished_photo"] = "finished"
    calls = []

    def fail_after_file(*args, **kwargs):
        result = real_store(*args, **kwargs)
        calls.append(result)
        if len(calls) == 2:
            raise HTTPException(503, "Synthetic failure after file creation")
        return result

    monkeypatch.setattr(setup, "store_image", fail_after_file)
    photos = {"block": image_bytes(), "finished": image_bytes()}
    assert post(client, data, photos).status_code == 503
    assert not client.get("/api/projects").json() and not client.get("/api/blocks").json()
    assert not list(settings.upload_path.glob("*.jpg"))
    monkeypatch.setattr(setup, "store_image", real_store)
    assert post(client, data, photos).status_code == 201
    assert len(list(settings.upload_path.glob("*.jpg"))) == 2


@pytest.fixture
def planner(client, settings):
    settings.model_api_key = SecretStr("synthetic-test-key")
    state = dict(answer=plan(), calls=[], status=200, finish="stop")

    def handler(request):
        assert request.url.host == "api.meta.ai"
        state["calls"].append(json.loads(request.content))
        return httpx.Response(
            state["status"],
            json={
                "choices": [
                    {
                        "finish_reason": state["finish"],
                        "message": {"content": json.dumps(state["answer"])},
                    }
                ]
            },
        )

    client.app.dependency_overrides[get_planner] = lambda: SetupPlanner(
        settings, transport=httpx.MockTransport(handler)
    )
    return state


def test_meta_draft_readonly_with_photo_and_strict_schema(client, planner, image_bytes):
    data = description()
    data["finished_photo"] = "finished"
    response = post(client, data, {"finished": image_bytes()}, "draft")
    assert response.status_code == 200, response.text
    assert response.json()["requires_confirmation"] is True
    call = planner["calls"][0]
    assert call["model"] == "muse-spark-1.3"
    schema = call["response_format"]["json_schema"]
    assert schema["strict"] and schema["schema"]["additionalProperties"] is False
    assert "image_url" in str(call["messages"][1]["content"])
    assert not client.get("/api/projects").json() and not client.get("/api/blocks").json()


@pytest.mark.parametrize(
    "fault", ["ids", "quantity", "measurements", "direction", "text", "truncated", "unavailable"]
)
def test_invalid_ai_drafts_are_not_saved_and_manual_fallback_works(client, planner, fault):
    step = planner["answer"]["steps"][0]
    if fault == "ids":
        step["parts"][0]["block_key"] = "invented"
    if fault == "quantity":
        step["parts"][0]["quantity"] = 2
    if fault == "measurements":
        step["expected_stud_offset"] = 3
    if fault == "direction":
        step["facing_direction"] = "board_positive_x"
    if fault == "text":
        step["print_check"] = dict(block_key="yellow", expected_text="Fabricated")
    if fault == "truncated":
        planner["finish"] = "length"
    if fault == "unavailable":
        planner["status"] = 503
    response = post(client, description(), endpoint="draft")
    assert response.status_code == 502, response.text
    assert len(planner["calls"]) == 1 and not client.get("/api/projects").json()
    assert post(client, commit_data()).status_code == 201


def test_no_meta_key_keeps_manual_path_available(client):
    assert post(client, description(), endpoint="draft").status_code == 503
    assert post(client, commit_data()).status_code == 201


def test_simple_print_is_dimension_free_editable_and_invalidates_progress(client):
    from app.services.progress_service import specification_id

    data = commit_data()
    data["plan"]["steps"][0]["print_check"] = dict(block_key="yellow", expected_text="Involve Me")
    saved = post(client, data).json()
    step = saved["steps"][0]
    assert step["simple_print"]["expected_text"] == "Involve Me"
    block_id = step["required_blocks"][0]["block_id"]
    assert client.get(f"/api/blocks/{block_id}/faces").json() == []
    with Session(client.app.state.engine) as session:
        before = specification_id(session, saved["id"], step["id"])
    legacy = dict(
        title=step["title"],
        instruction=step["instruction"],
        required_blocks=[dict(block_id=block_id, required_quantity=1)],
    )
    route = f"/api/projects/{saved['id']}/steps/{step['id']}"
    assert client.put(route, json=legacy).json()["simple_print"] == step["simple_print"]
    updated = {**legacy, "simple_print": {"target_block_id": block_id, "expected_text": "insights"}}
    assert client.put(route, json=updated).status_code == 200
    with Session(client.app.state.engine) as session:
        assert before != specification_id(session, saved["id"], step["id"])
    assert client.put(route, json={**legacy, "required_blocks": []}).status_code == 422
    assert "simple_print" not in client.put(route, json={**legacy, "simple_print": None}).json()


# Uses the existing mocked real Meta adapter/correction workflow, not a fake verdict.


@pytest.mark.parametrize(
    "text,quality,expected",
    [
        ("Involve Me", "clear", "correct"),
        ("insights", "clear", "correction_required"),
        (None, "unreadable", "uncertain"),
    ],
)
def test_dimension_free_print_runs_real_inspection_and_fresh_verification(
    flow, text, quality, expected
):
    payload = {
        **flow.step_data,
        "simple_print": {"target_block_id": flow.block["id"], "expected_text": "Involve Me"},
    }
    assert (
        flow.client.put(
            f"/api/projects/{flow.project['id']}/steps/{flow.step['id']}", json=payload
        ).status_code
        == 200
    )
    flow.base.update(
        status="correct",
        issues=[],
        print_observation=dict(
            target_block_id=flow.block["id"],
            target_identified=True,
            observed_text=text,
            observed_logo=None,
            observed_registered_side_id=None,
            evidence_quality=quality,
            logo_comparison=None,
            bounding_box=None,
            description="Synthetic printed evidence",
            suggested_action="Show the printed side clearly.",
        ),
    )
    response = flow.start()
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["state"] == expected
    assert data["face"]["status"] == data["geometry"]["geometry_status"] == "not_measured"
    assert not data["print_recognition"]["direction_required"]
    assert len(flow.calls) == 1
    flow.base["print_observation"].update(observed_text="Involve Me", evidence_quality="clear")
    verified = flow.verify(data["inspection_id"], photo("green"))
    assert verified.status_code == 200, verified.text
    assert verified.json()["inspection"]["state"] == "verified"
    schema = flow.calls[-1]["response_format"]["json_schema"]["schema"]
    assert schema["properties"]["print_observation"] == {"$ref": "#/$defs/PrintObservation"}


def test_planner_reuses_real_library_reference_without_mutating_it(client, planner, image_bytes):
    block = client.post("/api/blocks", json={"name": "Library block", "color": "yellow"}).json()
    image = client.post(
        f"/api/blocks/{block['id']}/images", files={"image": ("own.jpg", image_bytes())}
    ).json()
    data = description()
    data["blocks"][0]["existing_id"] = block["id"]
    assert post(client, data, endpoint="draft").status_code == 200
    content = planner["calls"][0]["messages"][1]["content"]
    assert len([item for item in content if item["type"] == "image_url"]) == 1
    assert "Library reference for key yellow" in str(content)
    assert not client.get("/api/projects").json()
    assert client.get(f"/api/media/{image['id']}").status_code == 200


def test_malformed_provider_envelope_is_a_safe_retryable_draft_error(client, settings):
    settings.model_api_key = SecretStr("synthetic-test-key")
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200,
            json={
                "choices": [{"finish_reason": "stop", "message": None}],
            },
        )
    )
    client.app.dependency_overrides[get_planner] = lambda: SetupPlanner(
        settings, transport=transport
    )
    response = post(client, description(), endpoint="draft")
    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "plan_invalid"
    assert not client.get("/api/projects").json()
