"""Closed-loop tests use only synthetic photographs and injected Meta HTTP transport."""

import asyncio
import base64
import json
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from threading import Event
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import SecretStr
from sqlalchemy import inspect as inspect_database
from sqlmodel import Session

from app.api.inspection import get_meta_client
from app.db.tables import StepProgress
from app.main import create_app
from app.models.workflow import VerificationEvidence, transition
from app.services.assembly_orchestrator import AssemblyOrchestrator
from app.services.image_processor import process_image
from app.services.meta_client import MetaClient


def photo(color="green"):
    buffer = BytesIO()
    Image.new("RGB", (100, 80), color).save(buffer, format="JPEG")
    return buffer.getvalue()


def completion(result):
    return {"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(result)}}]}


@pytest.fixture
def flow(client, settings):
    settings.model_api_key = SecretStr("test-only-key")
    block = client.post("/api/blocks", json={"name": "Blue block", "color": "blue"}).json()
    project = client.post("/api/projects", json={"name": "Test tower"}).json()
    step_data = {
        "title": "Top",
        "instruction": "Attach the blue block aligned with the base.",
        "required_blocks": [{"block_id": block["id"], "required_quantity": 1}],
    }
    step = client.post(f"/api/projects/{project['id']}/steps", json=step_data).json()
    issue = {
        "type": "misplaced_part",
        "block_id": block["id"],
        "description": "Visible offset",
        "expected": "Aligned edges",
        "observed": "Offset edges",
        "suggested_fix": "Align the visible edges.",
        "bounding_box": {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4},
    }
    base = {
        "step_id": step["id"],
        "status": "incorrect",
        "confidence": None,
        "visible_blocks": [
            {"block_id": block["id"], "description": "Blue block", "estimated_count": 1}
        ],
        "issues": [issue],
        "explanation": "A visible offset differs from the reference.",
        "next_action": "Align the block and take another photo.",
        "active_vision": None,
    }
    state = {"status": "correct", "http_status": 200, "mutate": None, "before_reply": None}
    calls = []

    async def handler(request):
        payload = json.loads(request.content)
        calls.append(payload)
        if payload["response_format"]["json_schema"]["name"] == "assembly_inspection":
            return httpx.Response(200, json=completion(base))
        if state["before_reply"]:
            await asyncio.to_thread(state["before_reply"])
        if state["http_status"] != 200:
            return httpx.Response(
                state["http_status"], text="private provider error", headers={"Retry-After": "60"}
            )
        previous = json.loads(payload["messages"][1]["content"][0]["text"])["previous_findings"]
        result = {
            **base,
            "status": state["status"],
            "issues": [] if state["status"] != "incorrect" else [dict(issue)],
            "active_vision": {
                "reason": "Rear edge is hidden",
                "requested_view": "back",
                "instruction": "Move behind the base at block height.",
            }
            if state["status"] == "uncertain"
            else None,
            "explanation": "Synthetic new visual evidence",
            "issue_assessments": [
                {
                    "previous_issue_id": item["previous_issue_id"],
                    "resolution": {
                        "correct": "resolved",
                        "incorrect": "unresolved",
                        "uncertain": "uncertain",
                    }[state["status"]],
                    "explanation": "Synthetic assessment of the new view",
                    "current_issue_index": 0 if state["status"] == "incorrect" else None,
                }
                for item in previous
            ],
        }
        if state["mutate"]:
            state["mutate"](result)
        return httpx.Response(200, json=completion(result))

    meta = MetaClient(settings, transport=httpx.MockTransport(handler))
    client.app.dependency_overrides[get_meta_client] = lambda: meta
    ids = {"project_id": project["id"], "step_id": step["id"]}

    def start(image=None):
        return client.post(
            "/api/inspect", data=ids, files={"image": ("before.jpg", image or photo("blue"))}
        )

    def verify(previous, image=None, **overrides):
        return client.post(
            "/api/verify",
            data={**ids, "previous_inspection_id": previous, **overrides},
            files={"image": ("after.jpg", image if image is not None else photo())},
        )

    def progress():
        return client.get(f"/api/projects/{project['id']}/progress").json()[0]

    return SimpleNamespace(
        client=client,
        settings=settings,
        block=block,
        project=project,
        step=step,
        step_data=step_data,
        base=base,
        issue=issue,
        state=state,
        calls=calls,
        start=start,
        verify=verify,
        progress=progress,
        meta=meta,
        ids=ids,
    )


def test_initial_diagnosis_plans_without_extra_calls_and_never_verifies(flow):
    assert flow.progress()["status"] == "not_started"
    response = flow.start()
    assert response.status_code == 200
    result = response.json()
    assert result["state"] == "correction_required" and result["muse_call_count"] == 1
    assert result["correction_plan"][0]["instruction"] == flow.issue["suggested_fix"]
    track = result["tracked_issues"][0]
    assert track["original"] == flow.issue and track["resolution"] == "open"
    assert track["original_snapshot_id"] == result["snapshot_id"]
    assert len(flow.calls) == 1 and flow.progress()["status"] == "in_progress"
    flow.base.update(status="correct", issues=[])
    assert flow.start().json()["state"] == "correct"
    assert flow.progress()["status"] == "in_progress"


@pytest.mark.parametrize(
    "status,expected",
    [("correct", "verified"), ("incorrect", "still_incorrect"), ("uncertain", "uncertain")],
)
def test_fresh_verification_and_stable_finding_ids(flow, status, expected):
    before = flow.start().json()
    flow.state["status"] = status
    response = flow.verify(before["inspection_id"])
    assert response.status_code == 200
    after = response.json()
    assert (
        after["status"] == expected and after["previous_inspection_id"] == before["inspection_id"]
    )
    result = after["inspection"]
    assert (
        result["inspection_id"] != before["inspection_id"]
        and result["snapshot_id"] != before["snapshot_id"]
    )
    assert result["tracked_issues"][0]["issue_id"] == before["tracked_issues"][0]["issue_id"]
    assert result["tracked_issues"][0]["original_snapshot_id"] == before["snapshot_id"]
    assert result["model_latency_ms"] >= 0 and len(flow.calls) == 2
    assert flow.progress()["status"] == ("verified" if status == "correct" else "in_progress")
    if status == "uncertain":
        assert result["active_vision"]["requested_view"] == "back"
        assert result["correction_plan"][0]["kind"] == "capture"
    assert "data:image" not in repr(flow.client.app.state.inspection_sessions.entries)


def test_wire_format_one_meta_call_new_image_trusted_spec_and_prior_hints(flow):
    flow.client.post(
        f"/api/projects/{flow.project['id']}/steps/{flow.step['id']}/images",
        files={"image": ("reference.jpg", photo("white"))},
    )
    before = flow.start().json()
    assert (
        flow.verify(
            before["inspection_id"], expected_parts="untrusted", filesystem_path="/etc/passwd"
        ).status_code
        == 200
    )
    payload = flow.calls[-1]
    assert payload["model"] == "muse-spark-1.3"
    assert payload["response_format"]["json_schema"]["strict"] is True
    content = payload["messages"][1]["content"]
    assert (
        json.loads(content[0]["text"])["previous_findings"][0]["previous_issue_id"]
        == before["tracked_issues"][0]["issue_id"]
    )
    task = json.loads(content[1]["text"])
    assert task["expected_blocks"][0]["color"] == "blue"
    assert "untrusted" not in content[1]["text"] and "/etc/passwd" not in json.dumps(payload)
    image_urls = [item["image_url"]["url"] for item in content if item["type"] == "image_url"]
    assert len(image_urls) == 2 and image_urls[0] != before["analyzed_snapshot"]["data_url"]
    assert (
        base64.b64decode(image_urls[0].split(",")[1])
        == process_image(photo(), flow.settings).jpeg_bytes
    )
    assert "Previous findings are fallible" in payload["messages"][0]["content"]


def test_resolved_prior_error_does_not_hide_new_error(flow):
    before = flow.start().json()
    flow.state["status"] = "incorrect"

    def change(result):
        result["issues"][0]["type"] = "wrong_orientation"
        result["issue_assessments"][0].update(resolution="resolved", current_issue_index=None)

    flow.state["mutate"] = change
    result = flow.verify(before["inspection_id"]).json()
    assert result["status"] == "still_incorrect"
    tracks = result["inspection"]["tracked_issues"]
    assert (
        len(tracks) == 2
        and tracks[0]["resolution"] == "resolved"
        and tracks[1]["resolution"] == "open"
    )
    assert tracks[0]["issue_id"] != tracks[1]["issue_id"]
    assert flow.progress()["status"] == "in_progress"


@pytest.mark.parametrize(
    "change",
    [
        lambda result: result.update(issue_assessments=[]),
        lambda result: result["issue_assessments"][0].update(previous_issue_id="invented"),
        lambda result: result["issue_assessments"].append(dict(result["issue_assessments"][0])),
        lambda result: result["issue_assessments"][0].update(resolution="uncertain"),
        lambda result: result["issue_assessments"][0].update(explanation=""),
        lambda result: result["issue_assessments"][0].update(current_issue_index=999),
        lambda result: result.update(confidence=1.5),
        lambda result: result.update(step_id="another-step"),
    ],
)
def test_invalid_or_missing_evidence_never_marks_verified(flow, change):
    before = flow.start().json()
    flow.state["mutate"] = change
    response = flow.verify(before["inspection_id"])
    assert response.status_code == 502
    assert "inspection" not in response.json() and flow.progress()["status"] == "in_progress"


def test_mismatched_issue_association_rejected(flow):
    before = flow.start().json()
    flow.state["status"] = "incorrect"
    flow.state["mutate"] = lambda result: result["issues"][0].update(type="wrong_color")
    assert flow.verify(before["inspection_id"]).status_code == 502


def test_duplicate_and_superseded_snapshots_rejected_before_meta(flow):
    before = flow.start().json()
    assert flow.verify(before["inspection_id"], photo("blue")).status_code == 409
    assert len(flow.calls) == 1
    after = flow.verify(before["inspection_id"]).json()["inspection"]
    assert flow.verify(before["inspection_id"], photo("red")).status_code == 409
    assert flow.verify(after["inspection_id"], photo("blue")).status_code == 409
    assert len(flow.calls) == 2
    flow.start(photo("yellow"))
    assert flow.verify(after["inspection_id"], photo("white")).status_code == 409


@pytest.mark.parametrize(
    "overrides,code",
    [
        ({"previous_inspection_id": "unknown"}, 404),
        ({"project_id": "other"}, 409),
        ({"step_id": "other"}, 409),
    ],
)
def test_unknown_or_cross_context_session_rejected(flow, overrides, code):
    before = flow.start().json()
    params = {"previous": before["inspection_id"], **overrides}
    assert flow.verify(**params).status_code == code and len(flow.calls) == 1


def test_missing_previous_field_and_invalid_images(flow):
    before = flow.start().json()
    response = flow.client.post(
        "/api/verify", data=flow.ids, files={"image": ("after.jpg", photo())}
    )
    assert response.status_code == 422
    assert flow.verify(before["inspection_id"], b"bad image").status_code == 422
    buffer = BytesIO()
    Image.new("RGB", (100, 80)).save(buffer, format="GIF")
    assert flow.verify(before["inspection_id"], buffer.getvalue()).status_code == 415
    assert len(flow.calls) == 1


@pytest.mark.parametrize("status,expected", [(401, 502), (403, 502), (429, 429), (504, 504)])
def test_provider_failures_preserve_retryable_session_and_never_verify(flow, status, expected):
    before = flow.start().json()
    flow.state["http_status"] = status
    response = flow.verify(before["inspection_id"])
    assert response.status_code == expected
    assert "AI verification is temporarily unavailable" in response.text
    assert "private" not in response.text and flow.progress()["status"] == "in_progress"
    record = flow.client.app.state.inspection_sessions.entries[before["inspection_id"]]
    assert record.state == "error" and not record.busy and not record.consumed
    if status == 429:
        assert response.headers["retry-after"] == "60"
    flow.state["http_status"] = 200
    assert flow.verify(before["inspection_id"]).json()["status"] == "verified"


def test_missing_credentials_do_not_create_success(flow):
    before = flow.start().json()
    flow.settings.model_api_key = None
    assert flow.verify(before["inspection_id"]).status_code == 503
    assert flow.progress()["status"] == "in_progress"
    assert len(flow.calls) == 1


def test_expiry_capacity_and_restart_do_not_store_images(flow):
    before = flow.start().json()
    store = flow.client.app.state.inspection_sessions
    store.entries[before["inspection_id"]].expires_at = 0
    assert flow.verify(before["inspection_id"]).status_code == 410
    store.capacity = 1
    first = flow.start().json()
    flow.start(photo("red"))
    assert len(store.entries) == 1 and flow.verify(first["inspection_id"]).status_code == 404
    current = next(iter(store.entries))
    with TestClient(create_app(flow.settings)) as restarted:
        assert (
            restarted.post(
                "/api/verify",
                data={**flow.ids, "previous_inspection_id": current},
                files={"image": ("new.jpg", photo())},
            ).status_code
            == 404
        )
        assert restarted.get(f"/api/projects/{flow.project['id']}").status_code == 200


def test_progress_persists_without_diagnostics_or_camera_photos(flow):
    before = flow.start().json()
    assert flow.verify(before["inspection_id"]).json()["status"] == "verified"
    columns = {
        item["name"]
        for item in inspect_database(flow.client.app.state.engine).get_columns("step_progress")
    }
    assert columns == {
        "step_id",
        "specification_id",
        "status",
        "revision",
        "inspection_id",
        "verified_at",
    }
    with TestClient(create_app(flow.settings)) as restarted:
        result = restarted.get(f"/api/projects/{flow.project['id']}/progress").json()[0]
        assert result["status"] == "verified" and result["verified_at"]
        assert len(restarted.get("/api/blocks").json()) == 1
    assert not list(flow.settings.upload_path.glob("*.jpg"))


@pytest.mark.parametrize(
    "edit",
    [
        "instruction",
        "quantity",
        "block",
        "reference_add",
        "reference_delete",
        "reference_select",
        "reorder",
    ],
)
def test_specification_edits_invalidate_persisted_verification_and_old_session(flow, edit):
    endpoint = f"/api/projects/{flow.project['id']}/steps"
    images = [
        flow.client.post(
            f"{endpoint}/{flow.step['id']}/images", files={"image": ("reference.jpg", photo(color))}
        ).json()
        for color in ("white", "gray")
    ]
    other_step = flow.client.post(
        endpoint, json={"title": "Later", "instruction": "Inspect later"}
    ).json()
    before = flow.start().json()
    verified = flow.verify(before["inspection_id"]).json()["inspection"]
    assert flow.progress()["status"] == "verified"
    if edit in {"instruction", "quantity"}:
        data = {**flow.step_data}
        if edit == "instruction":
            data["instruction"] = "A different expected arrangement"
        else:
            data["required_blocks"] = [{"block_id": flow.block["id"], "required_quantity": 2}]
        response = flow.client.put(f"{endpoint}/{flow.step['id']}", json=data)
    elif edit == "block":
        response = flow.client.put(
            f"/api/blocks/{flow.block['id']}", json={"name": "Updated", "color": "red"}
        )
    elif edit == "reference_add":
        response = flow.client.post(
            f"{endpoint}/{flow.step['id']}/images", files={"image": ("another.jpg", photo("pink"))}
        )
    elif edit == "reference_delete":
        response = flow.client.delete(f"/api/media/{images[0]['id']}")
    elif edit == "reference_select":
        response = flow.client.put(
            f"{endpoint}/{flow.step['id']}/reference-image", json={"image_id": images[1]["id"]}
        )
    else:
        response = flow.client.put(
            f"{endpoint}/order", json={"step_ids": [other_step["id"], flow.step["id"]]}
        )
    assert response.is_success
    progress = flow.client.get(f"/api/projects/{flow.project['id']}/progress").json()
    assert (
        next(item for item in progress if item["step_id"] == flow.step["id"])["status"]
        == "not_started"
    )
    assert flow.verify(verified["inspection_id"], photo("red")).status_code == 409
    if edit == "instruction":
        flow.client.put(f"{endpoint}/{flow.step['id']}", json=flow.step_data)
        assert flow.progress()["status"] == "not_started"


@pytest.mark.parametrize("interference", ["duplicate", "edit", "new_inspection"])
def test_concurrent_operations_cannot_commit_stale_verification(flow, interference):
    before = flow.start().json()
    entered, release = Event(), Event()

    def block():
        entered.set()
        assert release.wait(5)

    flow.state["before_reply"] = block
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(flow.verify, before["inspection_id"])
        assert entered.wait(5)
        try:
            if interference == "duplicate":
                assert flow.verify(before["inspection_id"], photo("red")).status_code == 409
            elif interference == "edit":
                flow.client.put(
                    f"/api/blocks/{flow.block['id']}", json={"name": "Changed", "color": "yellow"}
                )
            else:
                assert flow.start(photo("white")).status_code == 200
        finally:
            release.set()
        assert pending.result().status_code == (200 if interference == "duplicate" else 409)
    assert flow.progress()["status"] == (
        "verified"
        if interference == "duplicate"
        else "not_started"
        if interference == "edit"
        else "in_progress"
    )


def test_timeout_and_cancellation_release_claim_without_verification(flow):
    before = flow.start().json()

    async def slow(_):
        await asyncio.sleep(10)
        pytest.fail("Deadline must cancel inference")

    flow.settings.meta_request_timeout = 0.01
    meta = MetaClient(flow.settings, transport=httpx.MockTransport(slow))
    flow.client.app.dependency_overrides[get_meta_client] = lambda: meta
    assert flow.verify(before["inspection_id"]).status_code == 504

    async def cancel(_):
        raise asyncio.CancelledError

    orchestrator = AssemblyOrchestrator(
        flow.client.app.state.engine,
        flow.settings,
        flow.client.app.state.inspection_sessions,
        MetaClient(flow.settings, transport=httpx.MockTransport(cancel)),
    )
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(
            orchestrator.observe(
                **flow.ids,
                image=process_image(photo(), flow.settings),
                previous_inspection_id=before["inspection_id"],
            )
        )
    with Session(flow.client.app.state.engine) as session:
        assert session.get(StepProgress, flow.step["id"]).status == "in_progress"
    assert not flow.client.app.state.inspection_sessions.entries[before["inspection_id"]].busy


@pytest.mark.parametrize(
    "current,target",
    [
        ("idle", "verified"),
        ("inspecting", "verified"),
        ("error", "verified"),
        ("awaiting_rescan", "verified"),
    ],
)
def test_state_machine_rejects_unearned_verification(current, target):
    with pytest.raises(ValueError):
        transition(current, target)


def test_state_machine_and_model_schema_are_explicit():
    state = "idle"
    for target in [
        "inspecting",
        "correction_required",
        "awaiting_rescan",
        "verifying",
        "uncertain",
        "awaiting_rescan",
        "verifying",
        "verified",
    ]:
        state = transition(state, target)
    schema = VerificationEvidence.model_json_schema()
    for model in [schema, *schema["$defs"].values()]:
        assert model["additionalProperties"] is False
        assert set(model["required"]) == set(model["properties"])


def test_smoke_replay_requires_explicit_opt_in(monkeypatch, capsys):
    from smoke_verification import main

    monkeypatch.setattr("sys.argv", ["smoke_verification.py"])
    assert main() == 77
    assert "No requests sent" in capsys.readouterr().out


def test_transient_retries_are_observable_not_extra_planner_calls(flow, monkeypatch):
    before = flow.start().json()
    attempts = []
    real_transport = flow.meta.transport

    async def transport(request):
        attempts.append(1)
        if len(attempts) < 3:
            return httpx.Response(503)
        return await real_transport.handle_async_request(request)

    async def no_wait(_):
        pass

    monkeypatch.setattr("app.services.meta_client.asyncio.sleep", no_wait)
    meta = MetaClient(flow.settings, transport=httpx.MockTransport(transport))
    flow.client.app.dependency_overrides[get_meta_client] = lambda: meta
    response = flow.verify(before["inspection_id"])
    assert response.status_code == 200
    assert response.json()["inspection"]["muse_call_count"] == 1
    assert response.json()["inspection"]["meta_attempt_count"] == 3
    assert len(attempts) == 3


def test_additive_startup_preserves_existing_project_and_reference_data(flow):
    endpoint = f"/api/projects/{flow.project['id']}/steps/{flow.step['id']}/images"
    reference = flow.client.post(
        endpoint, files={"image": ("synthetic-reference.jpg", photo("white"))}
    ).json()
    original_bytes = flow.client.get(reference["url"]).content
    # Only this test's disposable SQLite file: simulate the pre-Phase-4 schema.
    StepProgress.__table__.drop(flow.client.app.state.engine)
    with TestClient(create_app(flow.settings)) as restarted:
        project = restarted.get(f"/api/projects/{flow.project['id']}").json()
        assert project["steps"][0]["reference_images"][0]["id"] == reference["id"]
        assert restarted.get(reference["url"]).content == original_bytes
        assert (
            restarted.get(f"/api/projects/{flow.project['id']}/progress").json()[0]["status"]
            == "not_started"
        )
        assert "step_progress" in inspect_database(restarted.app.state.engine).get_table_names()


def test_session_expiring_during_model_call_cannot_commit_verified(flow):
    before = flow.start().json()
    record = flow.client.app.state.inspection_sessions.entries[before["inspection_id"]]
    flow.state["before_reply"] = lambda: setattr(record, "expires_at", 0)
    assert flow.verify(before["inspection_id"]).status_code == 410
    assert flow.progress()["status"] == "in_progress"


def test_smoke_replay_validates_both_real_api_contracts_with_mocked_meta(
    flow, monkeypatch, tmp_path, capsys
):
    import smoke_verification

    before, after = tmp_path / "synthetic-before.jpg", tmp_path / "synthetic-after.jpg"
    before.write_bytes(photo("blue"))
    after.write_bytes(photo("green"))

    class LocalAPI:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, *args, **kwargs):
            return flow.client.post(*args, **kwargs)

    monkeypatch.setattr(smoke_verification.httpx, "Client", lambda **kwargs: LocalAPI())
    monkeypatch.setattr(
        "sys.argv",
        [
            "smoke_verification.py",
            "--run-live",
            "--project-id",
            flow.project["id"],
            "--step-id",
            flow.step["id"],
            "--before",
            str(before),
            "--after",
            str(after),
        ],
    )
    assert smoke_verification.main() == 0
    assert '"status": "verified"' in capsys.readouterr().out
    assert len(flow.calls) == 2
