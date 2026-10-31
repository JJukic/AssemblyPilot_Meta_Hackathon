"""Synthetic-only print observations through the real Meta adapter and workflow."""

import base64
import hashlib
import json
from types import SimpleNamespace as NS

import pytest
import test_verification
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlmodel import Session
from test_verification import photo

from app.main import create_app
from app.models.diagnosis import BoundingBox
from app.models.workflow import WorkflowInspectionResponse
from app.services.geometric_verification import _snapshot
from app.services.image_processor import process_image
from app.services.inspection_request import build_multimodal_request
from app.services.print_crop import add_print_crop
from app.services.print_recognition import supported_surface

flow = test_verification.flow


def configure(flow, direction="not_required", mode="meta_auto", **config):
    payload = dict(
        label="front",
        name="Involve Me side",
        width_mm=32,
        height_mm=24,
        print_rule=dict(
            expected_text="Involve Me",
            alternative_texts=["insights"],
            recognition_mode=mode,
            **config,
        ),
    )
    root = f"/api/blocks/{flow.block['id']}/faces"
    response = flow.client.post(root, json=payload)
    assert response.status_code == 201, response.text
    face = response.json()
    data = dict(
        flow.step_data,
        face_constraint=dict(
            target_block_id=flow.block["id"],
            required_face_id=face["id"],
            facing_direction=direction,
        ),
    )
    response = flow.client.put(
        f"/api/projects/{flow.project['id']}/steps/{flow.step['id']}", json=data
    )
    assert response.status_code == 200, response.text
    flow.base.update(
        status="correct",
        issues=[],
        print_observation=dict(
            target_block_id=flow.block["id"],
            target_identified=True,
            observed_text="Involve Me",
            observed_logo=None,
            observed_registered_side_id=None,
            evidence_quality="clear",
            logo_comparison=None,
            bounding_box=None,
            description="Synthetic visible text.",
            suggested_action="Capture a clearer close side view.",
        ),
    )
    return face, root, payload


@pytest.mark.parametrize(
    "text,quality,status,gate",
    [
        ("Involve Me", "clear", "match", "pass"),
        ("  INVOLVE   me ", "clear", "match", "pass"),
        ("insights", "clear", "mismatch", "fail"),
        ("lnvolve Me", "clear", "mismatch", "fail"),
        ("Involve", "partial", "uncertain", "uncertain"),
        (None, "unreadable", "uncertain", "uncertain"),
        ("Involve Me", "ambiguous", "uncertain", "uncertain"),
    ],
)
def test_zero_shot_no_reference_single_request(flow, text, quality, status, gate):
    face, _, _ = configure(flow)
    flow.base["print_observation"].update(observed_text=text, evidence_quality=quality)
    response = flow.start()
    assert response.status_code == 200, response.text
    data = response.json()
    result = data["print_recognition"]
    assert result["recognition_status"] == status and result["gate_status"] == gate
    assert result["snapshot_id"] == data["snapshot_id"]
    assert result["recognition_method"] == "meta_zero_shot"
    assert result["known_alternative"] == (text == "insights")
    assert result["reference_image_id"] is None and result["observed_print"] == text
    assert result["observed_registered_side_id"] == (face["id"] if status == "match" else None)
    assert (
        data["state"]
        == {"pass": "correct", "fail": "correction_required", "uncertain": "uncertain"}[gate]
    )
    assert data["muse_call_count"] == 1 and len(flow.calls) == 1
    content = flow.calls[0]["messages"][1]["content"]
    assert len([item for item in content if item["type"] == "image_url"]) == 1
    assert "Involve Me" in content[0]["text"]
    assert (
        "print_observation" in flow.calls[0]["response_format"]["json_schema"]["schema"]["required"]
    )


@pytest.mark.parametrize(
    "change",
    [
        {"target_block_id": "invented"},
        {"observed_registered_side_id": "invented"},
        {"bounding_box": {"x": 0.9, "y": 0.2, "width": 0.5, "height": 0.2}},
        {"target_identified": False},
    ],
)
def test_invalid_model_ids_and_regions_rejected(flow, change):
    configure(flow)
    flow.base["print_observation"].update(change)
    assert flow.start().status_code == 502
    assert flow.progress()["status"] != "verified"


def test_missing_required_output_rejected_but_legacy_optional(flow):
    assert flow.start().json()["print_recognition"]["recognition_status"] == "not_applicable"
    configure(flow)
    del flow.base["print_observation"]
    assert flow.start(photo("white")).status_code == 502


@pytest.mark.parametrize("count", [None, 0, 2])
def test_ambiguous_target_count_never_passes(flow, count):
    configure(flow)
    flow.base["visible_blocks"][0]["estimated_count"] = count
    data = flow.start().json()
    assert data["state"] == "uncertain"
    assert data["print_recognition"]["evidence_quality"] == "ambiguous"


def test_unidentified_target_stays_uncertain(flow):
    configure(flow)
    flow.base["print_observation"].update(target_identified=False, target_block_id=None)
    assert flow.start().json()["state"] == "uncertain"


@pytest.mark.parametrize("text", ["Involve Me", "insights"])
def test_print_identity_does_not_prove_direction(flow, text):
    configure(flow, direction="board_negative_y")
    flow.base["print_observation"]["observed_text"] = text
    data = flow.start().json()
    assert data["state"] == "uncertain"
    assert data["print_recognition"]["recognition_status"] == (
        "match" if text == "Involve Me" else "mismatch"
    )
    assert data["print_recognition"]["gate_status"] == "uncertain"
    assert not data["print_recognition"]["direction_supported"]


def test_fresh_verification_print_correction_and_stale_contract(flow):
    configure(flow)
    flow.base["print_observation"]["observed_text"] = "insights"
    before = flow.start().json()
    assert before["state"] == "correction_required"
    assert before["correction_plan"][0]["kind"] == "print_adjust"
    assert flow.verify(before["inspection_id"], photo("blue")).status_code == 409
    flow.base["print_observation"]["observed_text"] = "Involve Me"
    response = flow.verify(before["inspection_id"])
    assert response.status_code == 200, response.text
    after = response.json()["inspection"]
    assert after["state"] == "verified" and len(flow.calls) == 2
    assert flow.progress()["status"] == "verified"
    after["print_recognition"]["snapshot_id"] = before["snapshot_id"]
    with pytest.raises(ValidationError, match="snapshot"):
        WorkflowInspectionResponse.model_validate_json(json.dumps(after))


@pytest.mark.parametrize("http_status,expected", [(401, 502), (429, 429), (504, 504)])
def test_provider_failure_is_not_print_mismatch(flow, http_status, expected):
    configure(flow)
    before = flow.start().json()
    flow.state["http_status"] = http_status
    response = flow.verify(before["inspection_id"])
    assert response.status_code == expected
    assert "print_recognition" not in response.json()
    assert flow.progress()["status"] != "verified"


def test_references_reused_and_required_mode_without_photo_uncertain(flow):
    face, root, _ = configure(flow, mode="meta_references")
    assert flow.start().json()["state"] == "uncertain"
    uploaded = flow.client.post(
        f"{root}/{face['id']}/images", files={"image": ("ref.jpg", photo("white"))}
    )
    assert uploaded.status_code == 201
    ref = uploaded.json()["references"][0]
    first = flow.start(photo("red")).json()
    assert first["print_recognition"]["recognition_method"] == "meta_reference"
    assert first["print_recognition"]["reference_image_id"] == ref["id"]
    assert first["state"] == "correct"
    after = flow.verify(first["inspection_id"]).json()["inspection"]
    assert after["print_recognition"]["reference_image_id"] == ref["id"]
    assert len(flow.calls) == 3
    assert (
        len([i for i in flow.calls[-1]["messages"][1]["content"] if i["type"] == "image_url"]) == 2
    )


def test_registry_additive_compatibility_and_fingerprint(flow):
    face, root, payload = configure(flow)
    before = flow.start().json()
    legacy = {k: v for k, v in payload.items() if k != "print_rule"}
    assert (
        flow.client.put(f"{root}/{face['id']}", json=legacy).json()["print_rule"]["expected_text"]
        == "Involve Me"
    )
    payload["print_rule"]["expected_text"] = "Changed"
    assert flow.client.put(f"{root}/{face['id']}", json=payload).status_code == 200
    assert flow.verify(before["inspection_id"]).status_code == 409
    with TestClient(create_app(flow.settings)) as restarted:
        assert restarted.get(root).json()[0]["print_rule"]["expected_text"] == "Changed"
    # Simulate an existing Phase 4.1C database, without the new empty table.
    with flow.client.app.state.engine.begin() as conn:
        conn.exec_driver_sql("DROP TABLE printed_side_rules")
    with TestClient(create_app(flow.settings)) as restarted:
        assert restarted.get(root).json()[0]["name"] == face["name"]
        assert restarted.get(root).json()[0].get("print_rule") is None


@pytest.mark.parametrize(
    "rule",
    [
        {"expected_text": ""},
        {"expected_text": "x", "recognition_mode": "external_ocr"},
        {"expected_text": "x", "alternative_texts": [""]},
    ],
)
def test_invalid_registry_rules(flow, rule):
    _, root, payload = configure(flow)
    payload["label"], payload["print_rule"] = "back", rule
    assert flow.client.post(root, json=payload).status_code == 422


def test_supported_crop_and_plane_region_are_snapshot_bound(flow):
    configure(flow)
    image = process_image(photo(), flow.settings)
    digest, snapshot = _snapshot(image)
    with Session(flow.client.app.state.engine) as session:
        request = build_multimodal_request(
            session, flow.settings, flow.project["id"], flow.step["id"], image
        )
    face = NS(
        method="orb_ransac_canny",
        analyzed_snapshot=snapshot,
        snapshot_id=digest,
        quadrilateral=[[10, 10], [90, 10], [85, 70], [15, 70]],
        directional_evidence=True,
    )
    crop_request = add_print_crop(request, face)
    crop = crop_request.images[-1]
    assert len(crop_request.images) == 2 and crop.role == "current_print_crop"
    assert crop.source_snapshot_id == hashlib.sha256(image.jpeg_bytes).hexdigest()
    assert crop.source_quad[0] == [0.1, 0.125]
    assert crop.image.width == 80 and crop.image.height == 60
    assert crop_request.images[0] is request.images[0]
    assert supported_surface(BoundingBox(x=0.3, y=0.3, width=0.2, height=0.2), face)
    assert not supported_surface(BoundingBox(x=0.01, y=0.01, width=0.2, height=0.2), face)
    face.directional_evidence = False
    assert not supported_surface(BoundingBox(x=0.3, y=0.3, width=0.2, height=0.2), face)
    original_quad = face.quadrilateral
    face.quadrilateral = [[10, 10], [90, 70], [90, 10], [10, 70]]
    assert add_print_crop(request, face) is request  # Crossing edges are not a plane.
    face.quadrilateral = original_quad
    face.snapshot_id = "0" * 64
    assert add_print_crop(request, face) is request
    face.method = "none"
    assert add_print_crop(request, face) is request
    assert base64.b64decode(snapshot.data_url.split(",")[1]) == image.jpeg_bytes


def test_print_only_rule_cannot_be_disabled_while_required(flow):
    face, root, payload = configure(flow)
    response = flow.client.put(f"{root}/{face['id']}", json={**payload, "print_rule": None})
    assert response.status_code == 409
    assert flow.client.get(root).json()[0]["print_rule"]["expected_text"] == "Involve Me"


@pytest.mark.parametrize("mode,conflict", [("contour", False), ("hybrid", False), ("hybrid", True)])
def test_deterministic_identity_and_hybrid_disagreement(flow, monkeypatch, mode, conflict):
    from app.models.faces import FaceResult

    expected, root, payload = configure(flow, mode=mode)
    other = flow.client.post(
        root,
        json={
            **payload,
            "label": "back",
            "name": "Other side",
            "print_rule": {"expected_text": "insights"},
        },
    ).json()
    selected = other if conflict else expected
    uploaded = flow.client.post(
        f"{root}/{selected['id']}/images", files={"image": ("ref.jpg", photo("white"))}
    ).json()
    digest, snapshot = _snapshot(process_image(photo("blue"), flow.settings))
    candidate = FaceResult(
        status="not_measured",
        observed_face_id=selected["id"],
        target_block_id=flow.block["id"],
        matched_reference_image_id=uploaded["references"][0]["id"],
        matching_score=0.9,
        method="orb_ransac_canny",
        snapshot_id=digest,
        analyzed_snapshot=snapshot,
        quadrilateral=[[10, 10], [90, 10], [90, 70], [10, 70]],
        guidance="Synthetic accepted plane",
    )
    monkeypatch.setattr("app.services.assembly_orchestrator.inspect_faces", lambda *args: candidate)
    if mode == "contour":
        flow.base["print_observation"] = None
    response = flow.start()
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["state"] == ("uncertain" if conflict else "correct")
    print_result = data["print_recognition"]
    assert print_result["recognition_status"] == ("uncertain" if conflict else "match")
    assert print_result["recognition_method"] == ("contour_matching" if mode == "contour" else mode)
    if mode == "contour":
        assert print_result["observed_print"] is None  # Matching never invents an OCR reading.
    else:
        # A supported crop is another image in the same request, not another inference.
        assert (
            len([i for i in flow.calls[0]["messages"][1]["content"] if i["type"] == "image_url"])
            == 3
        )
        assert "current_print_crop" in flow.calls[0]["messages"][1]["content"][0]["text"]
    assert len(flow.calls) == 1


def test_no_contour_evidence_is_uncertain_not_wrong_print(flow):
    configure(flow, mode="contour")
    flow.base["print_observation"] = None
    result = flow.start().json()["print_recognition"]
    assert result["recognition_status"] == "uncertain"
    assert result["observed_print"] is None and result["gate_status"] == "uncertain"


def test_logo_requires_actual_expected_reference(flow):
    face, root, payload = configure(flow, mode="meta_references")
    payload["print_rule"].update(expected_text="", logo_description="Registered flower emblem")
    assert flow.client.put(f"{root}/{face['id']}", json=payload).status_code == 200
    flow.base["print_observation"].update(
        observed_text=None, observed_logo="A flower-like emblem", logo_comparison="match"
    )
    assert flow.start().json()["state"] == "uncertain"
    flow.client.post(f"{root}/{face['id']}/images", files={"image": ("ref.jpg", photo("white"))})
    result = flow.start(photo("red")).json()["print_recognition"]
    assert result["recognition_status"] == "match"
    assert result["observed_print"] is None and result["observed_logo"] == "A flower-like emblem"


def test_sam_contradiction_blocks_print_and_contour_identity(flow):
    from io import BytesIO

    from PIL import Image

    from app.models.diagnosis import InspectionResult
    from app.services.print_recognition import recognize_print

    expected, _, _ = configure(flow)
    output = BytesIO()
    Image.new("RGBA", (100, 80), (0, 0, 0, 0)).save(output, "PNG")
    mask = NS(
        width=100,
        height=80,
        data_url="data:image/png;base64," + base64.b64encode(output.getvalue()).decode(),
    )
    segment = NS(
        status="matched",
        issue_index=0,
        selected_instance_id="mask",
        result=NS(instances=[NS(instance_id="mask", left=0, top=0, mask=mask)]),
    )
    flow.base.update(status="incorrect", issues=[flow.issue])
    flow.base["print_observation"]["bounding_box"] = dict(x=0.2, y=0.2, width=0.2, height=0.2)
    diagnosis = InspectionResult.model_validate(flow.base)
    image = process_image(photo(), flow.settings)
    with Session(flow.client.app.state.engine) as session:
        request = build_multimodal_request(
            session, flow.settings, flow.project["id"], flow.step["id"], image
        )
    face = NS(
        method="orb_ransac_canny",
        target_block_id=flow.block["id"],
        observed_face_id=expected["id"],
        matched_reference_image_id="fixture-reference",
        analyzed_snapshot=image,
        quadrilateral=[[10, 10], [90, 10], [90, 70], [10, 70]],
    )
    result = recognize_print(request, diagnosis, face, [segment])
    assert result.gate_status == "uncertain" and result.evidence_quality == "ambiguous"
    request.context.faces[0].print_rule.recognition_mode = "contour"
    assert recognize_print(request, diagnosis, face, [segment]).gate_status == "uncertain"


@pytest.mark.parametrize("inside", [True, False])
def test_mismatch_requires_text_on_independently_posed_surface(flow, monkeypatch, inside):
    from app.models.faces import FaceResult

    expected, root, _ = configure(flow, direction="board_negative_y")
    uploaded = flow.client.post(
        f"{root}/{expected['id']}/images", files={"image": ("ref.jpg", photo("white"))}
    ).json()
    digest, snapshot = _snapshot(process_image(photo("blue"), flow.settings))
    candidate = FaceResult(
        status="correct",
        expected_face_id=expected["id"],
        observed_face_id=expected["id"],
        target_block_id=flow.block["id"],
        matched_reference_image_id=uploaded["references"][0]["id"],
        matching_score=0.9,
        method="orb_ransac_canny",
        snapshot_id=digest,
        analyzed_snapshot=snapshot,
        quadrilateral=[[10, 10], [90, 10], [90, 70], [10, 70]],
        directional_evidence=True,
        guidance="Synthetic calibrated facing evidence",
    )
    monkeypatch.setattr("app.services.assembly_orchestrator.inspect_faces", lambda *args: candidate)
    flow.base["print_observation"].update(
        observed_text="insights",
        bounding_box=dict(x=0.2 if inside else 0.01, y=0.3, width=0.2, height=0.2),
    )
    response = flow.start()
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["print_recognition"]["recognition_status"] == "mismatch"
    assert data["print_recognition"]["gate_status"] == ("fail" if inside else "uncertain")
    assert data["state"] == ("correction_required" if inside else "uncertain")


def test_legacy_faces_keep_their_serialized_fingerprint_shape(flow):
    from app.models.faces import FaceRead

    face, _, _ = configure(flow)
    face.pop("print_rule")
    assert FaceRead.model_validate(face).model_dump() == face
