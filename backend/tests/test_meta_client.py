"""Synthetic images and responses only: no test sends traffic to an inference service."""

import asyncio
import base64
import json
from dataclasses import replace
from io import BytesIO

import httpx
import pytest
from PIL import Image
from pydantic import SecretStr
from sqlmodel import Session

from app.api.inspection import get_meta_client
from app.services.image_processor import process_image
from app.services.inspection_errors import InspectionError
from app.services.inspection_request import build_multimodal_request
from app.services.meta_client import MAX_RESPONSE_BYTES, MetaClient, retry_after_seconds


@pytest.fixture
def inspection_case(client, settings, image_bytes):
    settings.model_api_key = SecretStr("test-only-not-a-real-key")
    block = client.post("/api/blocks", json={"name": "Blue brick", "color": "blue"}).json()
    project = client.post("/api/projects", json={"name": "Test build"}).json()
    step = client.post(
        f"/api/projects/{project['id']}/steps",
        json={
            "title": "Base",
            "instruction": "Place a brick.",
            "required_blocks": [{"block_id": block["id"], "required_quantity": 1}],
        },
    ).json()
    with Session(client.app.state.engine) as session:
        request = build_multimodal_request(
            session, settings, project["id"], step["id"], process_image(image_bytes(), settings)
        )
    result = {
        "step_id": step["id"],
        "status": "uncertain",
        "confidence": None,
        "visible_blocks": [
            {"block_id": block["id"], "description": "Blue brick", "estimated_count": 1}
        ],
        "issues": [],
        "explanation": "The connection is obscured.",
        "next_action": "Capture the top view.",
        "active_vision": {
            "reason": "The connection is obscured.",
            "requested_view": "top_down",
            "instruction": "Move above the base to show the connection.",
        },
    }
    return request, result


def completion(result):
    return {
        "choices": [
            {
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": json.dumps(result)},
            }
        ]
    }


def run_meta(settings, request, handler):
    return asyncio.run(
        MetaClient(settings, transport=httpx.MockTransport(handler)).inspect(request)
    )


def test_documented_multimodal_wire_format(settings, inspection_case):
    request, result = inspection_case

    def handler(http_request):
        assert str(http_request.url) == "https://api.meta.ai/v1/chat/completions"
        assert http_request.headers["authorization"] == "Bearer test-only-not-a-real-key"
        body = json.loads(http_request.content)
        assert body["model"] == "muse-spark-1.3"
        assert body["messages"][0]["role"] == "developer"
        content = body["messages"][1]["content"]
        assert body["messages"][1]["role"] == "user"
        assert json.loads(content[0]["text"])["step_id"] == request.context.step_id
        assert content[1]["text"] == "Image 0: current_snapshot"
        assert (
            base64.b64decode(content[2]["image_url"]["url"].split(",")[1])
            == request.images[0].image.jpeg_bytes
        )
        schema = body["response_format"]["json_schema"]
        assert schema["strict"] is True
        assert schema["schema"]["additionalProperties"] is False
        assert body["max_completion_tokens"] == 8192
        return httpx.Response(200, json=completion(result))

    parsed = run_meta(settings, request, handler)
    assert parsed.model_dump() == result
    assert parsed.confidence is None


@pytest.mark.parametrize(
    "base",
    [
        "https://api.openai.com/v1",
        "http://api.meta.ai/v1",
        "https://api.meta.ai.evil.test/v1",
        "https://user:pass@api.meta.ai/v1",
        "https://api.meta.ai/v1?key=x",
        "https://api.meta.ai/v1#x",
        "https://api.meta.ai:8080/v1",
    ],
)
def test_only_meta_https_can_receive_key(settings, inspection_case, base):
    settings.meta_api_base_url = base
    with pytest.raises(InspectionError) as error:
        run_meta(settings, inspection_case[0], lambda _: pytest.fail("Must not call transport"))
    assert error.value.code == "meta_configuration"


@pytest.fixture
def retry_delays(monkeypatch):
    delays = []

    async def sleep(delay):
        delays.append(delay)

    monkeypatch.setattr("app.services.meta_client.asyncio.sleep", sleep)
    monkeypatch.setattr("app.services.meta_client.random.uniform", lambda *_: 0)
    return delays


@pytest.mark.parametrize(
    "status,expected,attempts",
    [
        (401, "meta_authentication", 1),
        (403, "meta_authentication", 1),
        (402, "meta_billing", 1),
        (400, "meta_request_rejected", 1),
        (404, "meta_request_rejected", 1),
        (413, "meta_payload_too_large", 1),
        (429, "meta_rate_limited", 3),
        (500, "meta_unavailable", 3),
        (503, "meta_unavailable", 3),
        (504, "meta_timeout", 1),
        (307, "meta_unavailable", 1),
    ],
)
def test_upstream_errors_are_safe_and_retries_bounded(
    settings, inspection_case, retry_delays, status, expected, attempts
):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(
            status,
            text="private provider data test-only-not-a-real-key",
            headers={"Location": "https://other.test"},
        )

    with pytest.raises(InspectionError) as error:
        run_meta(settings, inspection_case[0], handler)
    assert error.value.code == expected
    assert "private" not in str(error.value)
    assert "test-only" not in str(error.value)
    assert len(calls) == attempts
    assert retry_delays == ([0.5, 1] if attempts == 3 else [])


def test_rate_limit_respects_long_retry_after(settings, inspection_case, retry_delays):
    with pytest.raises(InspectionError) as error:
        run_meta(
            settings,
            inspection_case[0],
            lambda _: httpx.Response(429, headers={"Retry-After": "60"}),
        )
    assert error.value.status_code == 429
    assert error.value.retry_after == 60
    assert retry_delays == []


def test_short_retry_then_success(settings, inspection_case, retry_delays):
    request, result = inspection_case
    calls = []

    def handler(_):
        calls.append(1)
        return (
            httpx.Response(503, headers={"Retry-After": "2"})
            if len(calls) == 1
            else httpx.Response(200, json=completion(result))
        )

    assert run_meta(settings, request, handler).status == "uncertain"
    assert retry_delays == [2]
    assert len(calls) == 2


@pytest.mark.parametrize(
    "exception,code",
    [(httpx.ReadTimeout, "meta_timeout"), (httpx.ConnectError, "meta_unavailable")],
)
def test_transport_failures(settings, inspection_case, retry_delays, exception, code):
    def handler(_):
        raise exception("private detail")

    with pytest.raises(InspectionError) as error:
        run_meta(settings, inspection_case[0], handler)
    assert error.value.code == code
    assert retry_delays == [0.5, 1]


def test_whole_operation_deadline(settings, inspection_case):
    settings.meta_request_timeout = 0.01

    async def handler(_):
        await asyncio.sleep(1)
        pytest.fail("Deadline must cancel this request")

    with pytest.raises(InspectionError) as error:
        run_meta(settings, inspection_case[0], handler)
    assert error.value.status_code == 504


@pytest.mark.parametrize(
    "change",
    [
        {"status": "maybe"},
        {"confidence": 1.1},
        {"confidence": "0.5"},
        {"step_id": "another-step"},
        {
            "visible_blocks": [
                {"block_id": "invented", "description": "A brick", "estimated_count": 1}
            ]
        },
        {"status": "incorrect", "issues": []},
        {
            "status": "incorrect",
            "issues": [
                {
                    "type": "misplaced_part",
                    "block_id": None,
                    "description": "Offset",
                    "expected": "Aligned edges",
                    "observed": "Offset edges",
                    "suggested_fix": "Align",
                    "bounding_box": {"x": 0.8, "y": 0, "width": 0.4, "height": 0.2},
                }
            ],
        },
    ],
)
def test_bad_diagnoses_are_rejected(settings, inspection_case, change):
    request, result = inspection_case
    with pytest.raises(InspectionError) as error:
        run_meta(
            settings, request, lambda _: httpx.Response(200, json=completion({**result, **change}))
        )
    assert error.value.code == "meta_invalid_response"


@pytest.mark.parametrize(
    "body",
    [
        b"not json",
        b"null",
        b"{}",
        b'{"choices": []}',
        b'{"choices":[{"finish_reason":"length"}]}',
        b'{"choices":[{"finish_reason":"stop","message":null}]}',
        b'{"choices":[{"finish_reason":"stop","message":{"refusal":"no","content":"{}"}}]}',
        b"x" * (MAX_RESPONSE_BYTES + 1),
    ],
)
def test_malformed_or_refused_output(settings, inspection_case, body):
    with pytest.raises(InspectionError) as error:
        run_meta(settings, inspection_case[0], lambda _: httpx.Response(200, content=body))
    assert error.value.code == "meta_invalid_response"


def test_request_size_guard(settings, inspection_case):
    settings.meta_max_request_bytes = 10
    with pytest.raises(InspectionError) as error:
        run_meta(settings, inspection_case[0], lambda _: pytest.fail("No oversized request"))
    assert error.value.status_code == 413


def test_all_images_have_explicit_roles(settings, inspection_case):
    request, _ = inspection_case
    reference = replace(
        request.images[0], role="assembled_step_reference", reference_id="reference"
    )
    request = replace(request, images=(*request.images, reference))
    content = json.loads(MetaClient(settings).request_body(request))["messages"][1]["content"]
    assert content[3]["text"] == "Image 1: assembled_step_reference"
    assert content[4]["type"] == "image_url"


@pytest.mark.parametrize(
    "header,expected",
    [
        (None, None),
        ("invalid", None),
        ("NaN", None),
        ("1.1", 2),
        ("-2", 0),
        ("Wed, 21 Oct 2015 07:28:00 GMT", 0),
    ],
)
def test_retry_after_parsing(header, expected):
    assert retry_after_seconds(header) == expected


def api_post(client, image_bytes, request):
    return client.post(
        "/api/inspect",
        data={"project_id": request.context.project_id, "step_id": request.context.step_id},
        files={"image": ("frame.jpg", image_bytes(), "image/jpeg")},
    )


def test_inspection_api_success_with_mock_transport(client, settings, image_bytes, inspection_case):
    request, result = inspection_case
    client.app.dependency_overrides[get_meta_client] = lambda: MetaClient(
        settings,
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=completion(result))),
    )
    response = api_post(client, image_bytes, request)
    assert response.status_code == 200
    assert {key: response.json()[key] for key in result} == result
    assert response.json()["model_latency_ms"] >= 0
    assert response.json()["inspected_at"].endswith("Z")


def test_missing_key_preserves_health_and_registry(client, settings, image_bytes, inspection_case):
    settings.model_api_key = None
    response = api_post(client, image_bytes, inspection_case[0])
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "meta_not_configured"
    assert client.get("/health").status_code == 200
    assert client.get("/api/blocks").status_code == 200


@pytest.mark.parametrize("invalid_field", ["project_id", "step_id"])
def test_inspection_api_missing_context(client, image_bytes, inspection_case, invalid_field):
    request, _ = inspection_case
    ids = {"project_id": request.context.project_id, "step_id": request.context.step_id}
    ids[invalid_field] = "missing"
    response = client.post("/api/inspect", data=ids, files={"image": ("frame.jpg", image_bytes())})
    assert response.status_code == 404
    del ids[invalid_field]
    response = client.post("/api/inspect", data=ids, files={"image": ("frame.jpg", image_bytes())})
    assert response.status_code == 422


@pytest.mark.parametrize("kind", ["auth", "rate", "unknown_status", "invalid_box"])
def test_inspection_api_failure_never_returns_diagnosis(
    client, settings, image_bytes, inspection_case, kind
):
    request, result = inspection_case
    if kind == "auth":
        response = httpx.Response(401, text="secret provider body")
    elif kind == "rate":
        response = httpx.Response(429, headers={"Retry-After": "60"})
    else:
        if kind == "unknown_status":
            result["status"] = "maybe"
        else:
            result.update(
                status="incorrect",
                issues=[
                    {
                        "type": "unknown",
                        "block_id": None,
                        "description": "Unknown",
                        "expected": "Aligned edges",
                        "observed": "Offset edges",
                        "suggested_fix": "Look closer",
                        "bounding_box": {"x": 2, "y": 0, "width": 0.1, "height": 0.1},
                    }
                ],
            )
        response = httpx.Response(200, json=completion(result))
    client.app.dependency_overrides[get_meta_client] = lambda: MetaClient(
        settings, transport=httpx.MockTransport(lambda _: response)
    )
    actual = api_post(client, image_bytes, request)
    assert actual.status_code == (429 if kind == "rate" else 502)
    assert "status" not in actual.json()
    assert "secret provider body" not in actual.text
    if kind == "rate":
        assert actual.headers["retry-after"] == "60"


def test_full_inspection_rejects_corrupt_image_before_inference(client, settings, inspection_case):
    request, _ = inspection_case
    client.app.dependency_overrides[get_meta_client] = lambda: MetaClient(
        settings,
        transport=httpx.MockTransport(lambda _: pytest.fail("Invalid image must never be sent")),
    )
    response = client.post(
        "/api/inspect",
        data={"project_id": request.context.project_id, "step_id": request.context.step_id},
        files={"image": ("frame.jpg", b"corrupt")},
    )
    assert response.status_code == 422


def test_returned_snapshot_is_exactly_the_model_input(
    client, settings, image_bytes, inspection_case
):
    request, result = inspection_case
    seen = {}

    def handler(upstream):
        payload = json.loads(upstream.content)
        seen["url"] = payload["messages"][1]["content"][2]["image_url"]["url"]
        assert (
            "model_latency_ms"
            not in payload["response_format"]["json_schema"]["schema"]["properties"]
        )
        return httpx.Response(200, json=completion(result))

    client.app.dependency_overrides[get_meta_client] = lambda: MetaClient(
        settings, transport=httpx.MockTransport(handler)
    )
    # Portrait JPEG with EXIF rotation: assert coordinates bind to the oriented, resized bytes.
    exif = Image.Exif()
    exif[274] = 6
    response = client.post(
        "/api/inspect",
        data={"project_id": request.context.project_id, "step_id": request.context.step_id},
        files={"image": ("frame.jpg", image_bytes(size=(1600, 800), exif=exif))},
    )
    assert response.status_code == 200
    snapshot = response.json()["analyzed_snapshot"]
    assert snapshot["data_url"] == seen["url"]
    assert (snapshot["width"], snapshot["height"]) == (640, 1280)
    with Image.open(BytesIO(base64.b64decode(snapshot["data_url"].split(",")[1]))) as image:
        assert image.size == (640, 1280)
        assert not image.getexif()


def test_meta_uncertain_without_active_vision_is_not_fabricated(settings, inspection_case):
    request, result = inspection_case
    result["active_vision"] = None
    with pytest.raises(InspectionError) as error:
        run_meta(settings, request, lambda _: httpx.Response(200, json=completion(result)))
    assert error.value.code == "meta_invalid_response"


def test_observed_face_must_be_registered_in_selected_step(inspection_case):
    from app.models.faces import FaceRead

    request, result = inspection_case
    request.context.faces = [
        FaceRead(
            id="registered",
            block_id=request.context.expected_blocks[0].id,
            label="front",
            name="Front",
            width_mm=32,
            height_mm=24,
            references=[],
        )
    ]
    result["observed_face_id"] = "invented"
    with pytest.raises(InspectionError):
        MetaClient.parse_response(json.dumps(completion(result)).encode(), request)
    result["observed_face_id"] = "registered"
    assert (
        MetaClient.parse_response(json.dumps(completion(result)).encode(), request).observed_face_id
        == "registered"
    )


@pytest.mark.parametrize(
    "change,reason,field",
    [
        ({"step_id": "wrong-step"}, "step_id_mismatch", None),
        ({"observed_face_id": "unknown-side"}, "unknown_face_id", None),
        (
            {
                "visible_blocks": [
                    {"block_id": "unknown-block", "description": "Test", "estimated_count": 1}
                ]
            },
            "unknown_block_id",
            None,
        ),
        (
            {"status": "incorrect", "issues": [], "active_vision": None},
            "diagnosis_schema",
            "diagnosis_consistency",
        ),
        ({"confidence": "not-a-number"}, "diagnosis_schema", "confidence"),
    ],
)
def test_rejection_reason_identifies_contract_failure_without_blame(
    settings, inspection_case, caplog, change, reason, field
):
    request, result = inspection_case
    with pytest.raises(InspectionError) as caught:
        run_meta(
            settings, request, lambda _: httpx.Response(200, json=completion({**result, **change}))
        )
    assert caught.value.code == "meta_invalid_response"
    assert f"[{reason}]" in str(caught.value)
    assert f"reason={reason}" in caplog.text
    assert "Capture a clearer view" not in str(caught.value)
    if field:
        assert field in str(caught.value) and field in caplog.text


def test_truncated_response_has_its_own_reason(settings, inspection_case, caplog):
    response = {
        "choices": [
            {"finish_reason": "length", "message": {"content": "private incomplete answer"}}
        ]
    }
    with pytest.raises(InspectionError) as caught:
        run_meta(settings, inspection_case[0], lambda _: httpx.Response(200, json=response))
    assert "[output_limit]" in str(caught.value)
    assert "token limit" in str(caught.value)
    assert "private incomplete answer" not in str(caught.value) + caplog.text


def test_schema_diagnostics_never_echo_values_extra_keys_or_provider_content(
    settings, inspection_case, caplog
):
    request, result = inspection_case
    private = "private-provider-input-must-not-leak"
    body = completion({**result, private: private, "confidence": private})
    with pytest.raises(InspectionError) as caught:
        run_meta(settings, request, lambda _: httpx.Response(200, json=body))
    assert "confidence" in str(caught.value)
    assert "unknown_field" in caplog.text
    assert private not in str(caught.value) + caplog.text
    assert "test-only-not-a-real-key" not in caplog.text


def test_non_json_diagnosis_is_not_reported_as_poor_image_quality(settings, inspection_case):
    response = completion({})
    response['choices'][0]['message']['content'] = 'not diagnostic JSON'
    with pytest.raises(InspectionError) as caught:
        run_meta(settings, inspection_case[0], lambda _: httpx.Response(200, json=response))
    assert '[diagnosis_json]' in str(caught.value)
    assert 'diagnosis_consistency' not in str(caught.value)
