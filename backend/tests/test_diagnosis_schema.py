import pytest
from pydantic import ValidationError

from app.models.diagnosis import BoundingBox, InspectionResult


@pytest.fixture
def diagnosis_json():
    # Deliberately synthetic test output. Never used by application runtime code.
    return {
        "step_id": "step-test",
        "status": "uncertain",
        "confidence": None,
        "visible_blocks": [
            {"block_id": None, "description": "Partly occluded block", "estimated_count": None}
        ],
        "issues": [],
        "explanation": "The base is obscured.",
        "next_action": "Capture a top-down view.",
        "active_vision": {
            "reason": "The base is obscured.",
            "requested_view": "top_down",
            "instruction": "Move the camera above the base to expose its edges.",
        },
    }


def test_uncertain_with_null_estimates_is_preserved(diagnosis_json):
    result = InspectionResult.model_validate(diagnosis_json)
    assert result.confidence is None
    assert result.visible_blocks[0].estimated_count is None
    assert result.status == "uncertain"


@pytest.mark.parametrize(
    "changes",
    [
        {"status": "verified"},
        {"confidence": -0.1},
        {"confidence": 1.1},
        {"confidence": "0.9"},
        {"confidence": float("nan")},
        {"confidence": float("inf")},
        {"explanation": ""},
        {"step_id": ""},
        {"extra_field": "unsupported"},
        {"status": "incorrect", "issues": []},
    ],
)
def test_invalid_diagnostic_output_rejected(diagnosis_json, changes):
    with pytest.raises(ValidationError):
        InspectionResult.model_validate({**diagnosis_json, **changes})


@pytest.mark.parametrize(
    "box",
    [
        {"x": -0.1, "y": 0, "width": 0.1, "height": 0.1},
        {"x": 0, "y": 0, "width": 0, "height": 0.1},
        {"x": 0, "y": 0, "width": 0.1, "height": -0.1},
        {"x": 0.9, "y": 0, "width": 0.2, "height": 0.1},
        {"x": 0, "y": 0.9, "width": 0.1, "height": 0.2},
        {"x": 0, "y": 0, "width": 2, "height": 2},
        {"x": "0.1", "y": 0, "width": 0.1, "height": 0.1},
        {"x": float("nan"), "y": 0, "width": 0.1, "height": 0.1},
    ],
)
def test_invalid_boxes(box):
    with pytest.raises(ValidationError):
        BoundingBox.model_validate(box)


def test_valid_camera_box_and_consistent_status(diagnosis_json):
    issue = {
        "type": "misplaced_part",
        "block_id": None,
        "description": "Visible offset",
        "expected": "Aligned edges",
        "observed": "Offset edges",
        "suggested_fix": "Align the visible edges.",
        "bounding_box": {"x": 0.1, "y": 0.2, "width": 0.4, "height": 0.3},
    }
    result = InspectionResult.model_validate(
        {**diagnosis_json, "status": "incorrect", "active_vision": None, "issues": [issue]}
    )
    assert result.issues[0].bounding_box.width == 0.4
    with pytest.raises(ValidationError):
        InspectionResult.model_validate(
            {**diagnosis_json, "status": "correct", "active_vision": None, "issues": [issue]}
        )


def test_output_schema_requires_fields_and_forbids_extras():
    schema = InspectionResult.model_json_schema()
    assert set(schema["required"]) == set(schema["properties"])
    assert schema["additionalProperties"] is False
    for nested in schema["$defs"].values():
        assert nested["additionalProperties"] is False
        assert set(nested["required"]) == set(nested["properties"])


@pytest.mark.parametrize(
    "issue_type",
    ["missing_part", "misplaced_part", "wrong_color", "wrong_orientation", "unexpected_part"],
)
def test_supported_discrepancies_preserve_expected_and_observed(diagnosis_json, issue_type):
    issue = {
        "type": issue_type,
        "block_id": None,
        "description": "Visible discrepancy",
        "expected": "Registered specification",
        "observed": "Camera evidence",
        "suggested_fix": "Check the visible discrepancy",
        "bounding_box": None,
    }
    parsed = InspectionResult.model_validate(
        {**diagnosis_json, "status": "incorrect", "active_vision": None, "issues": [issue]}
    )
    assert parsed.issues[0].model_dump() == issue
    if issue_type == "missing_part":
        issue["bounding_box"] = {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4}
        with pytest.raises(ValidationError, match="Missing parts"):
            InspectionResult.model_validate(
                {**diagnosis_json, "status": "incorrect", "active_vision": None, "issues": [issue]}
            )


@pytest.mark.parametrize(
    "vision",
    [
        None,
        {"reason": "Occluded", "requested_view": "automatic_scan", "instruction": "Move"},
        {"reason": "Occluded", "requested_view": "top_down", "instruction": ""},
    ],
)
def test_uncertain_requires_specific_valid_camera_request(diagnosis_json, vision):
    with pytest.raises(ValidationError):
        InspectionResult.model_validate({**diagnosis_json, "active_vision": vision})


def test_correct_status_cannot_also_request_more_evidence(diagnosis_json):
    with pytest.raises(ValidationError, match="Active Vision"):
        InspectionResult.model_validate({**diagnosis_json, "status": "correct"})


def test_box_can_touch_image_boundaries():
    assert BoundingBox(x=0, y=0, width=1, height=1).width == 1
