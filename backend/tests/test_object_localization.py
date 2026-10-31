"""Explicit object localization uses synthetic masks; no paid API calls."""

import hashlib
from io import BytesIO

import pytest
from PIL import Image
from test_contours import mask_entry

from app.api.inspection import get_sam_client
from app.models.segmentation import SegmentationResult
from app.services.inspection_errors import InspectionError


def jpeg():
    output = BytesIO()
    Image.new("RGB", (400, 200), "white").save(output, "JPEG")
    return output.getvalue()


@pytest.fixture
def localizer(client):
    data = jpeg()
    state = {"calls": [], "result": mask_entry().result, "error": None, "stale": False}

    class Sam:
        async def segment(self, image, concept):
            state["calls"].append((image, concept))
            if state["error"]:
                raise state["error"]
            return state["result"].model_copy(
                update={
                    "snapshot_id": "0" * 64
                    if state["stale"]
                    else hashlib.sha256(image.jpeg_bytes).hexdigest()
                }
            )

    client.app.dependency_overrides[get_sam_client] = Sam

    def send(payload=data, digest=None, concept="building block"):
        return client.post(
            "/api/vision/objects",
            data={
                "snapshot_id": digest or hashlib.sha256(payload).hexdigest(),
                "concept": concept,
            },
            files={"image": ("snapshot.jpg", payload, "image/jpeg")},
        )

    return state, send, data


def test_objects_need_no_diagnosis_and_preserve_exact_jpeg(localizer):
    state, send, data = localizer
    response = send()
    assert response.status_code == 200, response.text
    value = response.json()
    assert len(state["calls"]) == 1
    assert state["calls"][0][0].jpeg_bytes == data
    assert state["calls"][0][1] == "building block"
    assert value["result"]["snapshot_id"] == hashlib.sha256(data).hexdigest()
    assert value["outlines"][0]["instance_id"] == "part"
    outline = value["outlines"][0]["outline"]
    assert outline["status"] == "available"
    assert outline["snapshot_id"] == value["result"]["snapshot_id"]
    assert min(p[0] for path in outline["paths"] for p in path["points"]) == 110
    assert "issues" not in value and "state" not in value and "selected_instance_id" not in value


def test_multiple_masks_do_not_invent_a_selected_target(localizer):
    state, send, _ = localizer
    first = state["result"].instances[0]
    state["result"] = state["result"].model_copy(
        update={
            "instances": [first, first.model_copy(update={"instance_id": "other", "left": 200})]
        }
    )
    value = send().json()
    assert len(value["result"]["instances"]) == len(value["outlines"]) == 2
    assert [item["instance_id"] for item in value["outlines"]] == ["part", "other"]


def test_empty_masks_are_not_fabricated(localizer):
    state, send, _ = localizer
    state["result"] = SegmentationResult(snapshot_id="0" * 64, width=400, height=200, instances=[])
    value = send().json()
    assert value["result"]["instances"] == value["outlines"] == []


@pytest.mark.parametrize(
    "case", ["hash", "bad_image", "blank_concept", "large_concept", "non_jpeg"]
)
def test_invalid_input_never_calls_sam(localizer, case):
    state, send, _ = localizer
    output = BytesIO()
    Image.new("RGB", (400, 200), "white").save(output, "PNG")
    args = {
        "hash": {"digest": "0" * 64},
        "bad_image": {"payload": b"bad"},
        "blank_concept": {"concept": " "},
        "large_concept": {"concept": "x" * 81},
        "non_jpeg": {"payload": output.getvalue()},
    }[case]
    assert send(**args).status_code in {409, 422}
    assert not state["calls"]


def test_stale_sam_output_is_rejected(localizer):
    state, send, _ = localizer
    state["stale"] = True
    assert send().status_code == 502


def test_sam_failure_is_an_error_not_a_verdict(localizer):
    state, send, _ = localizer
    state["error"] = InspectionError("sam_timeout", "SAM timed out.", 504)
    response = send()
    assert response.status_code == 504
    assert response.json() == {"detail": {"code": "sam_timeout", "message": "SAM timed out."}}


def test_disabled_and_unconfigured_sam_have_actionable_errors(client, settings):
    data = jpeg()

    def send():
        return client.post(
            "/api/vision/objects",
            data={
                "snapshot_id": hashlib.sha256(data).hexdigest(),
                "concept": "building block",
            },
            files={"image": ("snapshot.jpg", data)},
        )

    assert send().json()["detail"]["code"] == "sam_disabled"
    settings.sam_enabled = True
    assert send().json()["detail"]["code"] == "sam_not_configured"
