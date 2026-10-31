from io import BytesIO

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import create_app
from app.models.geometry import GeometryFormContext
from app.services.face_inspection import inspect_faces, match_face
from app.services.image_processor import process_image


def artwork(seed=1):
    rng = np.random.default_rng(seed)
    image = np.full((240, 360), 220, np.uint8)
    for _ in range(90):
        x, y = rng.integers([15, 15], [340, 220])
        cv2.circle(image, (int(x), int(y)), int(rng.integers(2, 8)), 30, -1)
    return image


def photo(image):
    output = BytesIO()
    Image.fromarray(image).convert("RGB").save(output, "PNG")
    return output.getvalue()


def setup(client):
    block = client.post("/api/blocks", json={"name": "Printed block"}).json()
    base = f"/api/blocks/{block['id']}/faces"
    faces = []
    for label in ["front", "back"]:
        response = client.post(
            base,
            json={
                "label": label,
                "name": label,
                "width_mm": 32,
                "height_mm": 24,
                "description": "Registered artwork",
            },
        )
        assert response.status_code == 201, response.text
        faces.append(response.json())
    project = client.post("/api/projects", json={"name": "Face project"}).json()
    payload = {
        "title": "Face step",
        "instruction": "Required face toward board -Y",
        "required_blocks": [{"block_id": block["id"], "required_quantity": 1}],
        "face_constraint": {
            "target_block_id": block["id"],
            "required_face_id": faces[0]["id"],
            "facing_direction": "board_negative_y",
        },
    }
    response = client.post(f"/api/projects/{project['id']}/steps", json=payload)
    assert response.status_code == 201, response.text
    return block, faces, project, response.json(), payload


def test_face_crud_ownership_persistence_and_progress(settings):
    with TestClient(create_app(settings)) as client:
        block, faces, project, step, payload = setup(client)
        root = f"/api/blocks/{block['id']}/faces"
        upload = client.post(
            f"{root}/{faces[0]['id']}/images",
            files={"image": ("face.png", photo(artwork()), "image/png")},
        )
        assert upload.status_code == 201
        image = upload.json()["references"][0]
        assert client.get(image["url"]).status_code == 200
        progress = client.get(f"/api/projects/{project['id']}/progress").json()[0]
        changed = {
            key: faces[0][key] for key in ["label", "name", "description", "width_mm", "height_mm"]
        }
        changed["description"] = "Changed print description"
        assert client.put(f"{root}/{faces[0]['id']}", json=changed).status_code == 200
        assert (
            client.get(f"/api/projects/{project['id']}/progress").json()[0]["specification_id"]
            != progress["specification_id"]
        )
        assert client.delete(f"{root}/{faces[0]['id']}").status_code == 409
        other = client.post("/api/blocks", json={"name": "Other"}).json()
        assert (
            client.post(
                f"/api/blocks/{other['id']}/faces/{faces[0]['id']}/images",
                files={"image": ("bad.png", photo(artwork()), "image/png")},
            ).status_code
            == 404
        )
        payload["face_constraint"]["required_face_id"] = "invented"
        assert (
            client.put(
                f"/api/projects/{project['id']}/steps/{step['id']}", json=payload
            ).status_code
            == 422
        )
    with TestClient(create_app(settings)) as client:
        assert len(client.get(root).json()) == 2
        assert client.get(image["url"]).status_code == 200


@pytest.mark.parametrize("angle", [0, 10, 180])
def test_matching_planar_artwork_with_rotation(angle):
    reference = artwork()
    scene = np.full((600, 700), 240, np.uint8)
    matrix = cv2.getRotationMatrix2D((180, 120), angle, 1)
    matrix[:, 2] += [150, 150]
    scene = cv2.warpAffine(reference, matrix, (700, 600), borderValue=240)
    assert match_face(reference, scene) is not None


def test_wrong_logo_low_texture_occlusion_and_darkness():
    reference = artwork()
    assert match_face(reference, artwork(99)) is None
    assert match_face(np.full_like(reference, 128), reference) is None
    assert match_face(reference, np.zeros_like(reference)) is None
    occluded = reference.copy()
    occluded[:, :250] = 128
    assert match_face(reference, occluded) is None


def test_perspective_matching_and_direction_in_board_frame():
    from types import SimpleNamespace

    from app.services.face_inspection import direction_supported

    reference = artwork()
    source = np.float32([[0, 0], [359, 0], [359, 239], [0, 239]])
    target = np.float32([[130, 100], [510, 130], [480, 400], [110, 370]])
    h = cv2.getPerspectiveTransform(source, target)
    scene = cv2.warpPerspective(reference, h, (700, 600), borderValue=240)
    assert match_face(reference, scene) is not None
    k = np.array([[800.0, 0, 350], [0, 800.0, 300], [0, 0, 1]])
    face = SimpleNamespace(width_mm=32.0, height_mm=24.0)
    obj = np.float64([[0, 0, 0], [32, 0, 0], [32, 24, 0], [0, 24, 0]])
    r, t = np.array([0.1, 0.2, 0]), np.array([-16.0, -12.0, 200.0])
    pixels = cv2.projectPoints(obj, r, t, k, np.zeros(5))[0].reshape(-1, 2)
    profile = SimpleNamespace(camera_matrix=k, distortion=np.zeros(5))
    pose = SimpleNamespace(rvec=r)
    assert direction_supported(face, pixels, profile, pose, np.array([0, 0, -1]))
    assert not direction_supported(face, pixels, profile, pose, np.array([1, 0, 0]))


def test_identification_without_calibration_never_passes(client, settings):
    block, faces, project, step, _ = setup(client)
    client.post(
        f"/api/blocks/{block['id']}/faces/{faces[0]['id']}/images",
        files={"image": ("face.png", photo(artwork()), "image/png")},
    )
    scene = np.full((600, 700), 240, np.uint8)
    scene[150:390, 150:510] = artwork()
    result = inspect_faces(
        client.app.state.engine,
        settings,
        project["id"],
        step["id"],
        process_image(photo(scene), settings),
        GeometryFormContext(),
    )
    assert result.status == "uncertain"
    assert result.observed_face_id == faces[0]["id"]
    assert not result.directional_evidence
    # Same artwork on another face is ambiguous, regardless of the desired face.
    client.post(
        f"/api/blocks/{block['id']}/faces/{faces[1]['id']}/images",
        files={"image": ("face.png", photo(artwork()), "image/png")},
    )
    ambiguous = inspect_faces(
        client.app.state.engine,
        settings,
        project["id"],
        step["id"],
        process_image(photo(scene), settings),
        GeometryFormContext(),
    )
    assert ambiguous.status == "uncertain" and ambiguous.observed_face_id is None


@pytest.mark.parametrize("visible", [0, 1])
def test_registered_identity_controls_decision_with_board_evidence(
    client, settings, monkeypatch, visible
):
    """Real ORB pipeline; only physical calibration acquisition is mocked here."""
    from types import SimpleNamespace
    from uuid import uuid4

    from app.models.calibration import CameraConfiguration

    block, faces, project, step, payload = setup(client)
    for index, face in enumerate(faces):
        assert (
            client.post(
                f"/api/blocks/{block['id']}/faces/{face['id']}/images",
                files={"image": ("face.png", photo(artwork(index + 1)), "image/png")},
            ).status_code
            == 201
        )
    scene = np.full((600, 700), 240, np.uint8)
    scene[150:390, 150:510] = artwork(visible + 1)
    image = process_image(photo(scene), settings)
    camera = CameraConfiguration(
        device_label="test",
        lens="test",
        configuration="fixed",
        width=image.width,
        height=image.height,
    )
    context = GeometryFormContext(profile_id=uuid4(), camera=camera, configuration_confirmed=True)
    profile = SimpleNamespace(id=context.profile_id, camera=camera, board=None)
    monkeypatch.setattr("app.services.face_inspection.CalibrationStore.load", lambda *args: profile)
    monkeypatch.setattr("app.services.face_inspection.detect", lambda *args: None)
    monkeypatch.setattr("app.services.face_inspection.estimate_pose", lambda *args: None)
    monkeypatch.setattr("app.services.face_inspection.direction_supported", lambda *args: True)
    result = inspect_faces(
        client.app.state.engine, settings, project["id"], step["id"], image, context
    )
    assert result.status == ("correct" if visible == 0 else "incorrect")
    assert result.observed_face_id == faces[visible]["id"]
    assert result.calibration_profile_id == str(context.profile_id)
    # Camera direction is never a substitute for a physically anchored operator direction.
    payload["face_constraint"]["facing_direction"] = "operator_front"
    client.put(f"/api/projects/{project['id']}/steps/{step['id']}", json=payload)
    result = inspect_faces(
        client.app.state.engine, settings, project["id"], step["id"], image, context
    )
    assert result.status == "uncertain" and not result.directional_evidence


def test_required_face_missing_reference_and_legacy_step(client, settings):
    block, faces, project, step, payload = setup(client)
    image = process_image(photo(artwork()), settings)
    result = inspect_faces(
        client.app.state.engine, settings, project["id"], step["id"], image, GeometryFormContext()
    )
    assert result.status == "uncertain" and result.observed_face_id is None
    payload["face_constraint"] = None
    client.put(f"/api/projects/{project['id']}/steps/{step['id']}", json=payload)
    result = inspect_faces(
        client.app.state.engine, settings, project["id"], step["id"], image, GeometryFormContext()
    )
    assert result.status == "not_measured"


def test_face_contract_rejects_unsupported_success_and_stale_overlay(settings):
    from pydantic import ValidationError

    from app.models.faces import FaceResult
    from app.services.geometric_verification import _snapshot

    digest, snapshot = _snapshot(process_image(photo(artwork()), settings))
    data = dict(
        status="correct",
        expected_face_id="front",
        observed_face_id="front",
        matched_reference_image_id="photo",
        method="orb_ransac_canny",
        matching_score=0.9,
        snapshot_id=digest,
        analyzed_snapshot=snapshot,
        directional_evidence=True,
        quadrilateral=[[1, 1], [300, 1], [300, 200], [1, 200]],
        guidance="Test evidence",
    )
    FaceResult(**data)
    for change in [
        {"snapshot_id": "0" * 64},
        {"directional_evidence": False},
        {"observed_face_id": "back"},
        {"matching_score": float("nan")},
        {"quadrilateral": [[-1, 1]] * 4},
        {"quadrilateral": []},
        {"status": "not_measured"},
    ]:
        with pytest.raises(ValidationError):
            FaceResult(**(data | change))


def test_sam_disagreement_rejects_face_association():
    import base64
    from types import SimpleNamespace as NS

    from app.services.face_inspection import sam_consistent

    output = BytesIO()
    Image.new("RGBA", (10, 10), (0, 0, 0, 0)).save(output, "PNG")
    mask = NS(
        width=10,
        height=10,
        data_url="data:image/png;base64," + base64.b64encode(output.getvalue()).decode(),
    )
    face = NS(
        target_block_id="target",
        quadrilateral=[[2, 2], [8, 2], [8, 8], [2, 8]],
        analyzed_snapshot=NS(width=10, height=10),
    )
    diagnosis = NS(issues=[NS(block_id="target")])
    segment = NS(
        status="matched",
        issue_index=0,
        selected_instance_id="mask",
        result=NS(instances=[NS(instance_id="mask", left=0, top=0, mask=mask)]),
    )
    assert sam_consistent(face, [], diagnosis, face.analyzed_snapshot)
    assert not sam_consistent(face, [segment], diagnosis, face.analyzed_snapshot)


def test_additive_startup_preserves_pre_face_database(settings):
    with TestClient(create_app(settings)) as client:
        block = client.post("/api/blocks", json={"name": "Legacy block"}).json()
        reference = client.post(
            f"/api/blocks/{block['id']}/images",
            files={"image": ("legacy.png", photo(artwork()), "image/png")},
        ).json()
        engine = client.app.state.engine
    # Recreate the actual prior schema: only the new, empty tables are absent.
    with engine.begin() as connection:
        for table in ["step_face_constraints", "face_references", "block_faces"]:
            connection.exec_driver_sql(f"DROP TABLE {table}")
    with TestClient(create_app(settings)) as client:
        restored = client.get(f"/api/blocks/{block['id']}").json()
        assert restored["name"] == "Legacy block"
        assert len(restored["reference_images"]) == 1
        assert client.get(reference["url"]).status_code == 200
        assert client.get(f"/api/blocks/{block['id']}/faces").json() == []
