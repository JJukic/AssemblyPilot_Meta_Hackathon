from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import cv2
import numpy as np
import pytest

from app.models.calibration import DEFAULT_BOARD, CalibrationProfile, CameraConfiguration
from app.services.assembly_orchestrator import fused_state
from app.services.calibration_store import CalibrationStore
from app.services.geometric_verification import (
    compare_offset,
    detect_stud_centers,
    fit_2x4_grid,
    fit_partial_reference_grid,
    validate_feature_mask,
)


def create_block(client, name, color):
    response = client.post(
        "/api/blocks",
        json={
            "name": name,
            "color": color,
            "shape": "rectangular",
            "studs_x": 2,
            "studs_y": 4,
            "height_mm": 9.6,
        },
    )
    assert response.status_code == 201
    return response.json()


def constrained_step(client, *, same_color=False):
    project = client.post("/api/projects", json={"name": "Tower"}).json()
    reference = create_block(client, "Yellow 2x4", "yellow")
    target = create_block(client, "Blue 2x4", "yellow" if same_color else "blue")
    payload = {
        "title": "Offset layer",
        "instruction": "Place blue two studs in board +X.",
        "required_blocks": [
            {"block_id": reference["id"], "required_quantity": 1},
            {"block_id": target["id"], "required_quantity": 1},
        ],
        "spatial_constraint": {
            "target_block_id": target["id"],
            "reference_block_id": reference["id"],
            "constraint_type": "relative_stud_offset",
            "axis": "longitudinal",
            "positive_direction": "board_positive_x",
            "expected_stud_offset": 2,
            "tolerance_studs": 0.15,
            "reference_surface_height_mm": 9.6,
            "target_surface_height_mm": 19.2,
        },
    }
    response = client.post(f"/api/projects/{project['id']}/steps", json=payload)
    return project, reference, target, payload, response


def grid(center=(50.0, 50.0), angle_degrees=0.0):
    points = np.array(
        [[x, y] for x in (-12.0, -4.0, 4.0, 12.0) for y in (-4.0, 4.0)]
    )
    angle = np.deg2rad(angle_degrees)
    rotation = np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])
    return points @ rotation.T + np.asarray(center)


def test_spatial_constraint_persists_and_old_steps_remain_unmeasured(client, image_bytes):
    project, _, _, payload, response = constrained_step(client)
    assert response.status_code == 201, response.text
    saved = response.json()
    assert saved["spatial_constraint"]["expected_stud_offset"] == 2
    assert client.get(f"/api/projects/{project['id']}").json()["steps"][0][
        "spatial_constraint"
    ]["id"] == saved["spatial_constraint"]["id"]

    plain = client.post(
        f"/api/projects/{project['id']}/steps",
        json={"title": "Plain", "instruction": "No precision check."},
    ).json()
    response = client.post(
        "/api/geometry/verify",
        data={"project_id": project["id"], "step_id": plain["id"]},
        files={"image": ("frame.jpg", image_bytes(), "image/jpeg")},
    )
    assert response.status_code == 200
    assert response.json()["geometry_status"] == "not_measured"
    assert response.json()["constraint_id"] is None

    payload["spatial_constraint"] = None
    updated = client.put(
        f"/api/projects/{project['id']}/steps/{saved['id']}", json=payload
    )
    assert updated.status_code == 200
    assert updated.json()["spatial_constraint"] is None


def test_constraint_rejects_contradictions_unsupported_association_and_heights(client):
    _, _, target, payload, response = constrained_step(client, same_color=True)
    assert response.status_code == 422
    payload["spatial_constraint"]["reference_block_id"] = target["id"]
    assert payload["spatial_constraint"]["target_block_id"] == target["id"]
    project = client.post("/api/projects", json={"name": "Other"}).json()
    same = client.post(f"/api/projects/{project['id']}/steps", json=payload)
    assert same.status_code == 422
    payload["spatial_constraint"]["reference_block_id"] = payload["required_blocks"][0][
        "block_id"
    ]
    payload["spatial_constraint"]["target_surface_height_mm"] = 30
    wrong_height = client.post(f"/api/projects/{project['id']}/steps", json=payload)
    assert wrong_height.status_code == 422


def test_grid_fit_rotation_partial_visibility_and_ambiguous_shape():
    for angle in (0, 17, 63, 89):
        fitted = fit_2x4_grid(grid(angle_degrees=angle), "board_positive_x")
        assert fitted.pitch_mm == pytest.approx(8, abs=1e-8)
        assert fitted.residual_mm == pytest.approx(0, abs=1e-8)
        assert fitted.long_axis[0] >= 0
    with pytest.raises(ValueError, match="complete"):
        fit_2x4_grid(grid()[:-1], "board_positive_x")
    with pytest.raises(ValueError, match="ambiguous"):
        fit_2x4_grid(
            np.array(
                [
                    [20 * np.cos(angle), 20 * np.sin(angle)]
                    for angle in np.linspace(0, 2 * np.pi, 8, endpoint=False)
                ]
            ),
            "board_positive_x",
        )
    target = fit_2x4_grid(grid(center=(66, 50)), "board_positive_x")
    reference = grid(center=(50, 50))
    partial = reference[np.argsort(reference[:, 0])[:4]]
    reconstructed = fit_partial_reference_grid(partial, target)
    np.testing.assert_allclose(reconstructed.center, [50, 50], atol=1e-8)
    with pytest.raises(ValueError, match="complete visible"):
        fit_partial_reference_grid(partial[:-1], target)


def test_offset_acceptance_rejection_and_uncertainty_overlap():
    reference = fit_2x4_grid(grid(), "board_positive_x")
    correct = fit_2x4_grid(grid(center=(66, 50)), "board_positive_x")
    too_short = fit_2x4_grid(grid(center=(58, 50)), "board_positive_x")
    boundary = fit_2x4_grid(grid(center=(67.28, 50)), "board_positive_x")
    assert compare_offset(reference, correct, 2, 0.15, 0.1)[3] == "correct"
    observed, deviation, _, status = compare_offset(reference, too_short, 2, 0.15, 0.1)
    assert observed == pytest.approx(1)
    assert deviation == pytest.approx(-1)
    assert status == "incorrect"
    result = compare_offset(reference, boundary, 2, 0.15, 0.1)
    assert result[3] == "uncertain"


def test_synthetic_stud_detection_and_invalid_masks():
    image = np.full((260, 420, 3), 240, np.uint8)
    mask = np.zeros(image.shape[:2], np.uint8)
    cv2.rectangle(image, (60, 70), (360, 190), (25, 85, 210), -1)
    cv2.rectangle(mask, (60, 70), (360, 190), 255, -1)
    for x in (105, 175, 245, 315):
        for y in (105, 155):
            cv2.circle(image, (x, y), 15, (70, 130, 250), -1)
            cv2.circle(image, (x, y), 15, (10, 50, 150), 2)
    centers = detect_stud_centers(image, mask)
    assert centers.shape == (8, 2)
    with pytest.raises(ValueError, match="matching"):
        validate_feature_mask(np.ones((10, 10, 3), np.uint8), image.shape[:2])
    with pytest.raises(ValueError, match="insufficient"):
        validate_feature_mask(np.zeros(image.shape[:2], np.uint8), image.shape[:2])


def test_missing_calibration_is_uncertain_without_numeric_claims(client, image_bytes):
    project, _, _, _, step = constrained_step(client)
    response = client.post(
        "/api/geometry/verify",
        data={"project_id": project["id"], "step_id": step.json()["id"]},
        files={"image": ("frame.jpg", image_bytes(), "image/jpeg")},
    )
    result = response.json()
    assert result["measurement_status"] == "not_measured"
    assert result["geometry_status"] == "uncertain"
    assert result["observed_studs"] is None
    assert result["analyzed_snapshot"] is None


def test_camera_profile_mismatch_returns_no_measurement(client, settings, image_bytes):
    project, _, _, _, step = constrained_step(client)
    camera = CameraConfiguration(
        device_label="Controlled camera",
        lens="Fixed lens",
        configuration="No crop or zoom",
        width=1280,
        height=960,
    )
    profile = CalibrationProfile(
        id=uuid4(),
        created_at=datetime.now(UTC),
        opencv_version=cv2.__version__,
        board=DEFAULT_BOARD,
        board_id=DEFAULT_BOARD.board_id,
        camera=camera,
        measured_width_mm=140,
        measured_height_mm=100,
        camera_matrix=[[1000.0, 0, 640], [0, 1000.0, 480], [0, 0, 1]],
        distortion=[0.0] * 5,
        reprojection_rms_px=0.1,
        per_view_rms_px=[0.1] * 12,
        accepted_views=12,
        coverage_fraction=0.4,
        normal_spread_degrees=40,
    )
    CalibrationStore(settings.calibration_path).save(profile)
    response = client.post(
        "/api/geometry/verify",
        data={
            "project_id": project["id"],
            "step_id": step.json()["id"],
            "profile_id": str(profile.id),
            "camera": camera.model_dump_json(),
            "configuration_confirmed": "true",
        },
        files={"image": ("frame.jpg", image_bytes(), "image/jpeg")},
    )
    result = response.json()
    assert result["geometry_status"] == "uncertain"
    assert result["measurement_status"] == "not_measured"
    assert "resolution" in result["guidance"]


def test_semantic_correct_cannot_override_geometric_incorrect():
    incorrect = SimpleNamespace(constraint_id="constraint", geometry_status="incorrect")
    uncertain = SimpleNamespace(constraint_id="constraint", geometry_status="uncertain")
    correct = SimpleNamespace(constraint_id="constraint", geometry_status="correct")
    assert fused_state("correct", incorrect, False) == "correction_required"
    assert fused_state("correct", incorrect, True) == "still_incorrect"
    assert fused_state("correct", uncertain, False) == "uncertain"
    assert fused_state("correct", correct, True) == "verified"
    assert fused_state("incorrect", correct, False) == "correction_required"
