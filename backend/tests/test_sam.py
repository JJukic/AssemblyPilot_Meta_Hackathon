"""Synthetic protocol fixtures only. Every SAM HTTP request uses MockTransport."""

import asyncio
import base64
import hashlib
import json
from dataclasses import replace
from io import BytesIO

import httpx
import pytest
from PIL import Image
from pydantic import SecretStr, ValidationError
from test_meta_client import inspection_case as base_inspection_case

from app.models.diagnosis import BoundingBox, InspectionResult
from app.models.segmentation import MaskPNG, SegmentationResult
from app.services.image_processor import process_image
from app.services.inspection_errors import InspectionError
from app.services.sam_client import MAX_STREAM_BYTES, SamClient, snapshot_identity
from app.services.segmentation_service import localize_issues, select_instance


@pytest.fixture
def inspection_case(client, settings, image_bytes):
    return base_inspection_case.__wrapped__(client, settings, image_bytes)


# Official SAM protocol's 5x5 conformance vector, used only as a parser fixture.
TOKEN = "0<|box;x1=10;y1=20;x2=14;y2=24;w=100;h=80|><|mask;x=0;y=0;data=5,5,!!!!!(QO(0lu8?|>"


def events(text="<0f>" + TOKEN):
    return [
        {
            "type": "response.output_text.done",
            "item_id": "message",
            "output_index": 0,
            "content_index": 0,
            "text": text,
        },
        {"type": "response.completed", "response": {"status": "completed"}},
    ]


def response(text="<0f>" + TOKEN, *, stream=None):
    payload = stream if stream is not None else events(text)
    return httpx.Response(
        200,
        headers={"Content-Type": "text/event-stream"},
        content="".join("data: " + json.dumps(event) + "\n\n" for event in payload),
    )


@pytest.fixture
def sam_case(settings, image_bytes):
    settings.sam_enabled = True
    settings.model_api_key = SecretStr("sam-test-key")
    return settings, process_image(image_bytes(), settings)


def run(sam_case, handler, concept="green building block", **kwargs):
    settings, image = sam_case
    return asyncio.run(
        SamClient(settings, transport=httpx.MockTransport(handler)).segment(
            image, concept, **kwargs
        )
    )


def test_documented_request_real_parser_and_exact_jpeg(sam_case):
    settings, image = sam_case

    def handler(request):
        assert str(request.url) == "https://api.meta.ai/v1/responses"
        assert request.headers["authorization"] == "Bearer sam-test-key"
        payload = json.loads(request.content)
        assert payload["model"] == "sam-3.1" and payload["stream"] is True
        message = payload["input"][0]
        assert message["type"] == "message" and message["role"] == "user"
        assert message["content"][0] == {"type": "input_text", "text": "green building block"}
        assert (
            base64.b64decode(message["content"][1]["image_url"].split(",")[1]) == image.jpeg_bytes
        )
        return response()

    result = run(sam_case, handler)
    assert result.snapshot_id == hashlib.sha256(image.jpeg_bytes).hexdigest()
    instance = result.instances[0]
    assert (instance.instance_id, instance.left, instance.top) == ("0", 10, 20)
    assert (instance.mask.width, instance.mask.height) == (5, 5)
    with Image.open(BytesIO(base64.b64decode(instance.mask.data_url.split(",")[1]))) as mask:
        assert mask.mode == "RGBA"
        assert set(mask.getchannel("A").tobytes()) <= {0, 90, 230}
        assert 230 in mask.getchannel("A").tobytes()


def test_box_prompt_uses_official_half_open_builder(sam_case):
    def handler(request):
        text = json.loads(request.content)["input"][0]["content"][0]["text"]
        assert text == "<0f>1<|box;x1=10;y1=20;x2=14;y2=24;w=100;h=80|>"
        return response()

    run(sam_case, handler, None, box=BoundingBox(x=0.1, y=0.25, width=0.05, height=0.0625))


@pytest.mark.parametrize(
    "concept",
    [
        "",
        "thing",
        "the incorrect thing",
        "red brick, green brick",
        "find green building block",
        "red and green bricks",
        "x\nbrick",
        "a" * 90,
    ],
)
def test_prompt_rejected_before_transport(sam_case, concept):
    with pytest.raises(InspectionError, match="concept|description"):
        run(sam_case, lambda _: pytest.fail("No request"), concept)


def test_missing_key_disabled_and_bad_origin_never_send(sam_case):
    settings, _ = sam_case
    for attr, value, code in [
        ("model_api_key", None, "sam_not_configured"),
        ("sam_enabled", False, "sam_disabled"),
        ("meta_api_base_url", "https://other.test/v1", "meta_configuration"),
    ]:
        old = getattr(settings, attr)
        setattr(settings, attr, value)
        with pytest.raises(InspectionError) as error:
            run(sam_case, lambda _: pytest.fail("No request"))
        assert error.value.code == code
        setattr(settings, attr, old)


@pytest.mark.parametrize("change", [{"width": 200}, {"jpeg_bytes": b"invalid"}, {"width": 100000}])
def test_invalid_image(sam_case, change):
    settings, image = sam_case
    with pytest.raises(InspectionError, match="JPEG"):
        run((settings, replace(image, **change)), lambda _: pytest.fail("No request"))


@pytest.mark.parametrize(
    "text",
    [
        "<0f>" + TOKEN.replace("5,5,!!!!!", "5,5,broken"),
        "<0f>" + TOKEN.replace("x2=14", "x2=15"),
        "<0f>"
        + TOKEN.replace("x1=10", "x1=110").replace("x2=14", "x2=114").replace("w=100", "w=200"),
        "<0f>" + TOKEN.replace("5,5,", "500000000,500000000,"),
        "unsupported prose",
        "<0f>",
        "<7f>" + TOKEN,
    ],
)
def test_invalid_protocol_geometry_and_allocation_are_safe(sam_case, text):
    with pytest.raises(InspectionError) as error:
        run(sam_case, lambda _: response(text))
    assert error.value.code == "sam_invalid_response"


def test_empty_complete_is_distinct_from_failure(sam_case):
    result = run(sam_case, lambda _: response(""))
    assert result.instances == []
    with pytest.raises(InspectionError):
        run(sam_case, lambda _: response(stream=events("")[:-1]))


def test_content_part_finalizer_and_incremental_sse(sam_case):
    text = "<0f>" + TOKEN
    identity = {"item_id": "message", "output_index": 0, "content_index": 0}
    stream = [
        {"type": "response.output_text.delta", **identity, "delta": text[:30]},
        {"type": "response.output_text.delta", **identity, "delta": text[30:]},
        {
            "type": "response.content_part.done",
            **identity,
            "part": {"type": "output_text", "text": text},
        },
        events()[1],
    ]
    assert len(run(sam_case, lambda _: response(stream=stream)).instances) == 1


@pytest.mark.parametrize(
    "stream",
    [
        [{"type": "error", "message": "private"}],
        [{"type": "response.refusal.done", "refusal": "private"}],
        [events()[0], {"type": "response.incomplete", "response": {"status": "incomplete"}}],
        [events()[0], {**events()[0], "item_id": "other"}, events()[1]],
    ],
)
def test_failed_refused_incomplete_interleaved_streams(sam_case, stream):
    with pytest.raises(InspectionError):
        run(sam_case, lambda _: response(stream=stream))


@pytest.mark.parametrize(
    "status,attempts",
    [(401, 1), (403, 1), (402, 1), (400, 1), (429, 3), (503, 3), (504, 1), (307, 1)],
)
def test_errors_bounded_retries_no_private_output(sam_case, monkeypatch, status, attempts):
    calls = []

    async def sleep(_):
        pass

    monkeypatch.setattr("app.services.sam_client.asyncio.sleep", sleep)

    def handler(request):
        calls.append(request)
        return httpx.Response(
            status, text="private sam-test-key", headers={"Location": "https://other.test"}
        )

    with pytest.raises(InspectionError) as error:
        run(sam_case, handler)
    assert len(calls) == attempts
    assert "private" not in str(error.value) and "sam-test-key" not in str(error.value)


def test_rate_limit_respects_long_retry_after(sam_case):
    calls = []

    def handler(_):
        calls.append(1)
        return httpx.Response(429, headers={"Retry-After": "60"})

    with pytest.raises(InspectionError) as error:
        run(sam_case, handler)
    assert len(calls) == 1 and error.value.retry_after == 60


def test_total_deadline_and_cancellation(sam_case):
    settings, _ = sam_case
    settings.sam_request_timeout = 0.01

    async def slow(_):
        await asyncio.sleep(2)
        pytest.fail("Deadline did not cancel")

    with pytest.raises(InspectionError) as error:
        run(sam_case, slow)
    assert error.value.code == "sam_timeout"

    async def cancelled(_):
        raise asyncio.CancelledError

    with pytest.raises(asyncio.CancelledError):
        run(sam_case, cancelled)


def test_response_size_limit_and_nonstream_rejected(sam_case):
    for reply in [
        httpx.Response(200, json={"output": []}),
        httpx.Response(
            200,
            headers={"Content-Type": "text/event-stream"},
            content=b"x" * (MAX_STREAM_BYTES + 1),
        ),
    ]:
        with pytest.raises(InspectionError):
            run(sam_case, lambda _: reply)


def test_multiple_instances_require_unambiguous_spatial_evidence(sam_case):
    second = TOKEN.replace("0<|", "2<|").replace("x1=10", "x1=50").replace("x2=14", "x2=54")
    result = run(sam_case, lambda _: response("<0f>" + TOKEN + "," + second))
    assert len(result.instances) == 2
    assert select_instance(result, None) is None
    hint = BoundingBox(x=0.5, y=0.25, width=0.05, height=0.0625)
    assert select_instance(result, hint) == "2"
    assert select_instance(result, BoundingBox(x=0, y=0, width=1, height=1)) is None


def incorrect(case, kind="misplaced_part", box=None):
    request, original = case
    block_id = request.context.expected_blocks[0].id
    return InspectionResult.model_validate(
        {
            **original,
            "status": "incorrect",
            "active_vision": None,
            "issues": [
                {
                    "type": kind,
                    "block_id": block_id,
                    "description": "Observed discrepancy",
                    "expected": "Aligned blue block",
                    "observed": "Offset visible block",
                    "suggested_fix": "Align it",
                    "bounding_box": box,
                }
            ],
        }
    )


def test_orchestrator_routing_exact_identity_and_limit(settings, inspection_case):
    request, original = inspection_case
    settings.sam_enabled = True
    calls = []

    def handler(upstream):
        calls.append(json.loads(upstream.content))
        return response()

    client = SamClient(settings, transport=httpx.MockTransport(handler))

    def localize(result):
        return asyncio.run(localize_issues(client, request, result))

    assert localize(InspectionResult.model_validate(original)) == []
    assert (
        localize(
            InspectionResult.model_validate(
                {**original, "status": "correct", "active_vision": None}
            )
        )
        == []
    )
    missing = localize(incorrect(inspection_case, "missing_part"))
    assert missing[0].status == "skipped" and not calls
    result = localize(incorrect(inspection_case))
    assert result[0].status == "matched"
    assert result[0].concept == "blue building block"
    assert result[0].result.snapshot_id == snapshot_identity(request.images[0].image)
    assert result[0].latency_ms >= 0
    diagnosis = incorrect(inspection_case)
    diagnosis.issues *= 3
    calls.clear()
    entries = localize(diagnosis)
    assert len(calls) == 2 and entries[2].status == "skipped"
    settings.sam_enabled = False
    calls.clear()
    assert localize(diagnosis)[0].status == "disabled" and not calls


def test_wrong_color_uses_observed_box_not_expected_color(settings, inspection_case):
    settings.sam_enabled = True
    request, _ = inspection_case
    calls = []

    def handler(upstream):
        calls.append(json.loads(upstream.content))
        return response()

    client = SamClient(settings, transport=httpx.MockTransport(handler))
    diagnosis = incorrect(
        inspection_case, "wrong_color", {"x": 0.1, "y": 0.25, "width": 0.05, "height": 0.0625}
    )
    entry = asyncio.run(localize_issues(client, request, diagnosis))[0]
    assert entry.prompt_kind == "box" and entry.concept is None and entry.status == "matched"
    assert "blue" not in calls[0]["input"][0]["content"][0]["text"]


@pytest.mark.parametrize(
    "reply,expected",
    [
        (response(""), "no_match"),
        (httpx.Response(401), "unavailable"),
        (response("broken"), "unavailable"),
    ],
)
def test_orchestrator_fallback_never_changes_diagnosis(settings, inspection_case, reply, expected):
    settings.sam_enabled = True
    request, _ = inspection_case
    diagnosis = incorrect(inspection_case)
    before = diagnosis.model_dump()
    entry = asyncio.run(
        localize_issues(
            SamClient(settings, transport=httpx.MockTransport(lambda _: reply)), request, diagnosis
        )
    )[0]
    assert entry.status == expected and entry.selected_instance_id is None
    assert diagnosis.model_dump() == before


def test_orchestrator_rejects_stale_snapshot(settings, inspection_case):
    settings.sam_enabled = True
    request, _ = inspection_case

    class StaleSam(SamClient):
        async def segment(self, *args, **kwargs):
            return SegmentationResult(snapshot_id="a" * 64, width=100, height=80, instances=[])

    entry = asyncio.run(localize_issues(StaleSam(settings), request, incorrect(inspection_case)))[0]
    assert entry.status == "unavailable" and entry.result is None


def test_png_dimensions_and_snapshot_bounds_validated(sam_case):
    result = run(sam_case, lambda _: response())
    mask = result.instances[0].mask.model_dump()
    with pytest.raises(ValidationError):
        MaskPNG.model_validate({**mask, "width": 6})
    payload = result.model_dump()
    payload["instances"][0]["left"] = 99
    with pytest.raises(ValidationError):
        SegmentationResult.model_validate(payload)


def test_full_api_muse_and_sam_share_snapshot(client, settings, image_bytes, inspection_case):
    from test_meta_client import api_post, completion

    from app.api.inspection import get_meta_client, get_sam_client
    from app.services.meta_client import MetaClient

    settings.sam_enabled = True
    request, _ = inspection_case
    diagnosis = incorrect(inspection_case)
    seen = {}

    def muse(upstream):
        seen["muse"] = json.loads(upstream.content)["messages"][1]["content"][2]["image_url"]["url"]
        return httpx.Response(200, json=completion(diagnosis.model_dump()))

    def sam(upstream):
        seen["sam"] = json.loads(upstream.content)["input"][0]["content"][1]["image_url"]
        return response()

    client.app.dependency_overrides[get_meta_client] = lambda: MetaClient(
        settings, transport=httpx.MockTransport(muse)
    )
    client.app.dependency_overrides[get_sam_client] = lambda: SamClient(
        settings, transport=httpx.MockTransport(sam)
    )
    actual = api_post(client, image_bytes, request)
    assert actual.status_code == 200
    payload = actual.json()
    assert payload["analyzed_snapshot"]["data_url"] == seen["muse"] == seen["sam"]
    assert payload["segmentations"][0]["status"] == "matched"
    assert payload["model_latency_ms"] >= 0 and payload["inspection_id"]
    assert payload["status"] == "incorrect"

    from app.models.diagnosis import InspectionResponse

    payload["segmentations"][0]["result"]["snapshot_id"] = "a" * 64
    with pytest.raises(ValidationError, match="different snapshot"):
        InspectionResponse.model_validate_json(json.dumps(payload))


def test_smoke_missing_key_is_explicit_and_never_calls_meta(monkeypatch, tmp_path):
    from argparse import Namespace

    import smoke_segmentation
    from app.core.config import Settings

    monkeypatch.setattr(
        smoke_segmentation, "Settings", lambda: Settings(_env_file=None, model_api_key=None)
    )
    args = Namespace(image=tmp_path / "not-a-photo.jpg", output=tmp_path / "annotated.png")
    assert asyncio.run(smoke_segmentation.run(args)) == 77
    assert not args.output.exists()


def test_subpixel_spatial_prompt_fails_safely_before_http(sam_case):
    with pytest.raises(InspectionError) as error:
        run(
            sam_case,
            lambda _: pytest.fail("No invalid prompt request"),
            None,
            box=BoundingBox(x=0, y=0, width=1e-15, height=1e-15),
        )
    assert error.value.code == "sam_invalid_prompt"


def test_parser_worker_is_killed_on_cancellation(sam_case, monkeypatch):
    from app.services.sam_client import decode_events

    class Worker:
        returncode = None
        killed = False
        waited = False

        async def communicate(self, _):
            raise asyncio.CancelledError

        def kill(self):
            self.killed = True
            self.returncode = -9

        async def wait(self):
            self.waited = True

    worker = Worker()

    async def spawn(*args, **kwargs):
        assert "MODEL_API_KEY" not in kwargs["env"]
        return worker

    monkeypatch.setattr("app.services.sam_client.asyncio.create_subprocess_exec", spawn)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(decode_events(events(), sam_case[1]))
    assert worker.killed and worker.waited


def test_existing_benchmark_remains_muse_only(settings, inspection_case, monkeypatch):
    from test_meta_client import completion

    from app.services.meta_client import MetaClient
    from benchmark_inspection import BenchmarkCase, evaluate

    settings.sam_enabled = True
    request, _ = inspection_case
    diagnosis = incorrect(inspection_case)

    async def unexpected_sam(*args, **kwargs):
        pytest.fail("The Muse benchmark must not add billable SAM operations")

    monkeypatch.setattr(SamClient, "segment", unexpected_sam)
    case = BenchmarkCase(
        id="synthetic",
        project_id=request.context.project_id,
        step_id=request.context.step_id,
        image="not-opened.jpg",
        expected_status="incorrect",
        expected_issue_types=["misplaced_part"],
    )
    meta = MetaClient(
        settings,
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json=completion(diagnosis.model_dump()))
        ),
    )
    report = asyncio.run(evaluate([(case, request)], meta))
    assert report["results"][0]["diagnosis"]["segmentations"][0]["status"] == "disabled"
    assert "data:image" not in json.dumps(report)
