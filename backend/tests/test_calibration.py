"""Synthetic optics, never user photographs or evidence of physical measurement accuracy."""

import base64
import hashlib
import json
import subprocess
import sys
from dataclasses import replace
from datetime import UTC, datetime
from io import BytesIO
from uuid import uuid4

import cv2
import numpy as np
import pytest
from PIL import Image
from pydantic import ValidationError

from app.models.calibration import DEFAULT_BOARD, BoardSpec, CalibrationProfile, CameraConfiguration
from app.services.calibration_store import CalibrationStore
from app.services.charuco_vision import (
    assess,
    board_image,
    calibrate,
    detect,
    estimate_pose,
    image_to_board_plane,
    image_to_board_surface,
    make_board,
)
from app.services.image_processor import ProcessedImage, process_image

CAMERA = CameraConfiguration(
    device_label="Synthetic camera",
    lens="Synthetic fixed lens",
    configuration="Fixed focus, no crop/zoom",
    width=1280,
    height=960,
)
K = np.array([[1000.0, 0, 640], [0, 1000.0, 480], [0, 0, 1]])


def jpeg(gray):
    output = BytesIO()
    Image.fromarray(gray).convert("RGB").save(output, "JPEG", quality=95)
    data = output.getvalue()
    return ProcessedImage(data, gray.shape[1], gray.shape[0], gray.shape[1], gray.shape[0])


def synthetic_view(index=0, rvec=None):
    """Render the actual OpenCV ChArUco print through a known pinhole camera."""
    board = np.asarray(board_image(dpi=254))
    rvec = np.array(
        rvec
        if rvec is not None
        else [-0.4 + 0.25 * (index % 4), -0.35 + 0.35 * (index // 4), 0.03 * index],
        dtype=np.float64,
    )
    rotation = cv2.Rodrigues(rvec)[0]
    # Board center moves across the sensor and distance varies.
    center = np.array([-42 + 28 * (index % 4), -32 + 32 * (index // 4), 270 + 8 * (index % 3)])
    tvec = center - rotation @ np.array([70.0, 50.0, 0.0])
    obj = np.array([[0.0, 0, 0], [140, 0, 0], [140, 100, 0], [0, 100, 0]])
    dst = cv2.projectPoints(obj, rvec, tvec, K, np.zeros(5))[0].reshape(4, 2).astype(np.float32)
    src = np.array(
        [[0, 0], [board.shape[1], 0], [board.shape[1], board.shape[0]], [0, board.shape[0]]],
        dtype=np.float32,
    )
    warped = cv2.warpPerspective(
        board, cv2.getPerspectiveTransform(src, dst), (1280, 960), borderValue=255
    )
    return jpeg(warped), rvec, tvec


@pytest.fixture(scope="module")
def views():
    return [detect(synthetic_view(i)[0]) for i in range(12)]


@pytest.fixture(scope="module")
def calibrated(views):
    return calibrate(views, CAMERA, 140, 100)


def known_profile(**changes):
    values = dict(
        id=uuid4(),
        created_at=datetime.now(UTC),
        opencv_version=cv2.__version__,
        board=DEFAULT_BOARD,
        board_id=DEFAULT_BOARD.board_id,
        camera=CAMERA,
        measured_width_mm=140,
        measured_height_mm=100,
        camera_matrix=K.tolist(),
        distortion=[0.0] * 5,
        reprojection_rms_px=0.1,
        per_view_rms_px=[0.1] * 12,
        accepted_views=12,
        coverage_fraction=0.4,
        normal_spread_degrees=40,
    )
    return CalibrationProfile(**(values | changes))


@pytest.mark.parametrize(
    "values",
    [
        {"squares_x": 2},
        {"marker_mm": 20},
        {"square_mm": -1},
        {"dictionary": "not-a-dictionary"},
        {"squares_x": 20, "squares_y": 20},
    ],
)
def test_invalid_board(values):
    with pytest.raises(ValidationError):
        BoardSpec(**values)


def test_board_generation_cli_and_metadata(tmp_path):
    target = tmp_path / "board.png"
    args = [sys.executable, "scripts/generate_charuco_board.py", "--output", str(target)]
    run = subprocess.run(args, capture_output=True, text=True)
    assert run.returncode == 0, run.stderr
    metadata = json.loads(target.with_suffix(".json").read_text())
    assert metadata["board_id"] == DEFAULT_BOARD.board_id
    assert (metadata["pattern_width_mm"], metadata["pattern_height_mm"]) == (140, 100)
    with Image.open(target) as image:
        assert abs(image.width / image.info["dpi"][0] * 25.4 - 140) < 0.01
        assert abs(image.height / image.info["dpi"][1] * 25.4 - 100) < 0.01
    assert subprocess.run(args, capture_output=True).returncode != 0
    pdf = tmp_path / "printable.pdf"
    assert subprocess.run(args[:-1] + [str(pdf)], capture_output=True).returncode == 0
    assert pdf.read_bytes().startswith(b"%PDF")
    assert BoardSpec(marker_mm=14).board_id != DEFAULT_BOARD.board_id
    for dictionary in ("DICT_5X5_100", "DICT_6X6_250"):
        assert board_image(BoardSpec(dictionary=dictionary)).width > 0


def test_actual_marker_detection_and_missing_calibration(views):
    d = views[0]
    assert len(d.ids) == 24 and d.markers == 17 and not d.ambiguous
    result = assess(d, CAMERA, None, False)
    assert result.sample_acceptable and result.pose is None
    assert result.calibration_status == "missing"
    assert not result.geometry.calibration_valid
    assert result.geometry.measurement_status == "not_measured"
    assert result.geometry.measurements == []


def test_no_board_blur_and_partial_board():
    blank = detect(jpeg(np.full((960, 1280), 255, dtype=np.uint8)))
    assert not blank.markers and blank.sharpness == 0
    result = assess(blank, CAMERA, None, False)
    assert not result.sample_acceptable and result.board_status == "not_detected"
    assert any("blurry" in message for message in result.guidance)
    full, _, _ = synthetic_view()
    with Image.open(BytesIO(full.jpeg_bytes)) as img:
        array = np.asarray(img.convert("L")).copy()
    array[:, :580] = 255
    partial = detect(jpeg(array))
    assert 0 < len(partial.ids) < 24
    assert assess(partial, CAMERA, None, False).board_visibility < 1
    blurred = detect(
        jpeg(
            cv2.GaussianBlur(
                np.asarray(Image.open(BytesIO(full.jpeg_bytes)).convert("L")), (41, 41), 8
            )
        )
    )
    assert not assess(blurred, CAMERA, None, False).sample_acceptable


def test_ambiguous_duplicate_and_foreign_board_ids(views):
    d = replace(views[0], ambiguous=True)
    result = assess(d, CAMERA, known_profile(), True)
    assert result.board_status == "ambiguous" and not result.corners and result.pose is None
    # A real image containing a second copy: duplicate marker IDs must be rejected.
    print_array = np.asarray(board_image(dpi=100))
    canvas = np.full((600, 1300), 255, np.uint8)
    h, w = print_array.shape
    canvas[50 : 50 + h, 20 : 20 + w] = print_array
    canvas[50 : 50 + h, 700 : 700 + w] = print_array
    assert detect(jpeg(canvas)).ambiguous
    # Valid same-dictionary marker, but outside the configured board's ID set.
    marker = cv2.aruco.generateImageMarker(make_board().getDictionary(), 40, 150)
    canvas = np.full((500, 500), 255, np.uint8)
    canvas[100:250, 100:250] = marker
    assert detect(jpeg(canvas)).ambiguous


def test_calibration_recovers_known_geometry(calibrated):
    assert calibrated.accepted_views == 12
    assert calibrated.reprojection_rms_px < 0.5
    np.testing.assert_allclose(
        np.array(calibrated.camera_matrix)[:2, :2], K[:2, :2], rtol=0.025, atol=1
    )
    np.testing.assert_allclose(np.array(calibrated.camera_matrix)[:2, 2], K[:2, 2], atol=10)
    assert calibrated.normal_spread_degrees > 20


@pytest.mark.parametrize(
    "kind",
    ["few", "duplicate", "near_duplicate", "resolution", "blur", "tiny", "print", "frontoparallel"],
)
def test_reject_bad_calibration(views, kind):
    samples, camera, width = list(views), CAMERA, 140
    if kind == "few":
        samples = samples[:11]
    elif kind == "duplicate":
        samples[1] = samples[0]
    elif kind == "near_duplicate":
        samples[1] = replace(samples[1], points=samples[0].points + 1, ids=samples[0].ids)
    elif kind == "resolution":
        camera = CAMERA.model_copy(update={"width": 1920})
    elif kind == "blur":
        samples[0] = replace(samples[0], sharpness=1)
    elif kind == "tiny":
        samples = [replace(d, points=d.points * 0.1, coverage=0.01) for d in samples]
    elif kind == "print":
        width = 130
    elif kind == "frontoparallel":
        samples = [detect(synthetic_view(i, [0.0, 0.0, 0.05 * i])[0]) for i in range(12)]
    with pytest.raises(ValueError):
        calibrate(samples, camera, width, 100)


def test_pose_and_guidance(views, calibrated):
    image, actual_r, actual_t = synthetic_view(5)
    detected = detect(image)
    pose = estimate_pose(detected, known_profile())
    np.testing.assert_allclose(pose.translation_mm, actual_t, atol=1)
    np.testing.assert_allclose(pose.rvec, actual_r, atol=0.025)
    suitable = assess(detected, CAMERA, calibrated, True)
    assert suitable.pose is not None and suitable.suitable_for_top_down_capture
    tilted = assess(views[0], CAMERA, calibrated, True)
    assert not tilted.suitable_for_top_down_capture
    assert any("Tilt" in message for message in tilted.guidance)


@pytest.mark.parametrize(
    "kind", ["resolution", "lens", "device_label", "configuration", "confirmation"]
)
def test_mismatch_never_yields_pose(views, kind):
    camera = (
        CAMERA.model_copy(update={kind: 1920 if kind == "width" else "changed"})
        if (kind in {"lens", "device_label", "configuration"})
        else CAMERA.model_copy(update={"width": 1920})
        if kind == "resolution"
        else CAMERA
    )
    result = assess(views[0], camera, known_profile(), kind != "confirmation")
    assert result.calibration_status == "mismatch" and result.pose is None
    assert not result.geometry.calibration_valid


def test_board_plane_transform_distortion_units_and_elevated_limit():
    from app.models.calibration import BoardPose

    profile = known_profile(distortion=[-0.1, 0.04, 0.001, -0.001, 0])
    rvec, translation = np.array([0.2, -0.3, 0.1]), np.array([-60.0, -50, 300])
    pose = BoardPose(
        calibration_id=profile.id,
        board_id=profile.board_id,
        rvec=rvec.tolist(),
        translation_mm=translation.tolist(),
        viewing_angle_degrees=20,
        reprojection_rms_px=0.1,
    )
    actual_mm = np.array([[20.0, 20, 0], [100, 70, 0]])
    pixels = cv2.projectPoints(actual_mm, rvec, translation, K, np.array(profile.distortion))[
        0
    ].reshape(-1, 2)
    converted = image_to_board_plane(pixels.tolist(), profile, pose)
    np.testing.assert_allclose(converted, actual_mm[:, :2], atol=0.0001)
    elevated_mm = np.array([[30.0, 25, 19.2], [90, 60, 19.2]])
    elevated_pixels = cv2.projectPoints(
        elevated_mm, rvec, translation, K, np.array(profile.distortion)
    )[0].reshape(-1, 2)
    elevated = image_to_board_surface(
        elevated_pixels.tolist(), profile, pose, surface_z_mm=19.2
    )
    np.testing.assert_allclose(elevated, elevated_mm[:, :2], atol=0.0001)
    with pytest.raises(ValueError, match="Elevated"):
        image_to_board_plane(pixels.tolist(), profile, pose, plane_z_mm=9.6)
    with pytest.raises(ValueError):
        image_to_board_plane([[-1, 4]], profile, pose)
    with pytest.raises(ValueError, match="footprint"):
        image_to_board_plane([[0, 0]], profile, pose)


def test_profile_storage_validation_and_corruption(tmp_path, calibrated):
    store = CalibrationStore(tmp_path)
    store.save(calibrated)
    assert store.load(calibrated.id) == calibrated
    assert not list(tmp_path.glob("*.tmp"))
    path = tmp_path / f"{calibrated.id}.json"
    values = json.loads(path.read_text())
    values["camera_matrix"][0][0] = -5
    path.write_text(json.dumps(values))
    with pytest.raises(ValueError):
        store.load(calibrated.id)
    assert store.list() == ([], 1)
    for change in (
        {"board_id": "wrong"},
        {"camera_matrix": [[1]]},
        {"per_view_rms_px": [5] * 12},
        {"distortion": [float("nan")] * 5},
    ):
        with pytest.raises(ValueError):
            known_profile(**change)


def form(camera=CAMERA, **extra):
    return {"camera": camera.model_dump_json(), **extra}


def test_detect_api_exact_snapshot_and_native_resolution(client, settings):
    image, _, _ = synthetic_view(5)
    response = client.post(
        "/api/calibration/detect",
        data=form(),
        files={"image": ("sample.jpg", image.jpeg_bytes, "image/jpeg")},
    )
    assert response.status_code == 200, response.text
    result = response.json()
    data = base64.b64decode(result["analyzed_snapshot"].split(",")[1])
    assert result["snapshot_sha256"] == hashlib.sha256(data).hexdigest()
    with Image.open(BytesIO(data)) as actual:
        assert actual.size == (1280, 960)
    settings.resize_max_dimension = 64  # Generic AI/media resizing must not affect calibration.
    assert (
        client.post(
            "/api/calibration/detect",
            data=form(),
            files={"image": ("sample.jpg", image.jpeg_bytes)},
        ).json()["width"]
        == 1280
    )
    assert not settings.calibration_path.exists()
    assert b"%PDF" in client.get("/api/calibration/board.pdf").content


def test_calibrate_api_persist_reload_validate_capture(client, settings, views):
    files = [
        ("images", (f"view{i}.jpg", d.image.jpeg_bytes, "image/jpeg")) for i, d in enumerate(views)
    ]
    response = client.post(
        "/api/calibration/calibrate",
        files=files,
        data=form(
            measured_width_mm="140", measured_height_mm="100", configuration_confirmed="true"
        ),
    )
    assert response.status_code == 201, response.text
    profile = response.json()
    assert len(list(settings.calibration_path.iterdir())) == 1
    assert client.get("/api/calibration/status").json()["profiles"][0]["id"] == profile["id"]
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app(settings)) as restarted:
        assert restarted.get("/api/calibration/status").json()["profiles"][0]["id"] == profile["id"]
    result = client.post(
        "/api/calibration/validate-capture",
        data=form(profile_id=profile["id"], configuration_confirmed="true"),
        files={"image": ("sample.jpg", views[5].image.jpeg_bytes)},
    ).json()
    assert result["pose"] and result["geometry"]["measurement_status"] == "not_measured"
    assert result["calibration_status"] == "compatible"


def test_api_errors_and_no_file_paths(client, settings, image_bytes, views):
    valid = {"image": ("img.jpg", views[0].image.jpeg_bytes)}
    for data, files, expected in [
        (form(), {"image": ("x", b"bad")}, 422),
        (form(), {"image": ("x.gif", image_bytes(format="GIF"))}, 415),
        (form(CAMERA.model_copy(update={"width": 1920})), valid, 409),
        ({"camera": "{}"}, valid, 422),
        (form(profile_id="../../data/secrets"), valid, 422),
        (form(profile_id=str(uuid4())), valid, 404),
    ]:
        result = client.post("/api/calibration/detect", data=data, files=files)
        assert result.status_code == expected
        assert str(settings.calibration_path) not in result.text
    settings.max_upload_bytes = 10
    assert client.post("/api/calibration/detect", data=form(), files=valid).status_code == 413


def test_calibration_api_rejects_insufficient_and_unconfirmed(client, views):
    files = [("images", ("sample.jpg", d.image.jpeg_bytes)) for d in views]
    for confirmed, batch in (("true", files[:2]), ("false", files)):
        response = client.post(
            "/api/calibration/calibrate",
            files=batch,
            data=form(
                measured_width_mm="140", measured_height_mm="100", configuration_confirmed=confirmed
            ),
        )
        assert response.status_code == 422


def test_pillow_orients_without_resizing(settings):
    source = Image.new("RGB", (1800, 1000), "white")
    exif = Image.Exif()
    exif[274] = 6
    buffer = BytesIO()
    source.save(buffer, "JPEG", exif=exif)
    native = settings.model_copy(update={"resize_max_dimension": settings.max_image_dimension})
    result = process_image(buffer.getvalue(), native)
    assert (result.width, result.height) == (1000, 1800)


def test_pose_rejects_foreign_profile_and_bad_residuals(views):
    with pytest.raises(ValueError, match="resolution"):
        estimate_pose(views[0], known_profile(camera=CAMERA.model_copy(update={"width": 1500})))
    bad = replace(
        views[0],
        points=views[0].points
        + np.random.default_rng(4).normal(0, 10, views[0].points.shape).astype(np.float32),
    )
    with pytest.raises(ValueError, match="residuals"):
        estimate_pose(bad, known_profile())
    profile = known_profile()
    pose = estimate_pose(views[0], profile)
    with pytest.raises(ValueError, match="another"):
        image_to_board_plane([[640, 480]], known_profile(), pose)


def test_profile_version_corruption_and_board_mismatch(client, settings, views):
    store = CalibrationStore(settings.calibration_path)
    profile = known_profile(opencv_version="3.0.0")
    store.save(profile)
    response = client.post(
        "/api/calibration/validate-capture",
        data=form(profile_id=str(profile.id), configuration_confirmed="true"),
        files={"image": ("board.jpg", views[0].image.jpeg_bytes)},
    )
    assert response.status_code == 422
    assert client.get("/api/calibration/status").json()["invalid_profile_count"] == 1
    board = BoardSpec(square_mm=25, marker_mm=18)
    other = known_profile(
        board=board, board_id=board.board_id, measured_width_mm=175, measured_height_mm=125
    )
    assert assess(views[0], CAMERA, other, True).calibration_status == "mismatch"


def test_calibration_concurrency_and_batch_limit(client, views, monkeypatch):
    from app.api.calibration import calibration_lock

    files = [("images", ("sample.jpg", d.image.jpeg_bytes)) for d in views]
    data = form(measured_width_mm="140", measured_height_mm="100", configuration_confirmed="true")
    with calibration_lock:
        assert client.post("/api/calibration/calibrate", data=data, files=files).status_code == 409
    # Simulate known parsed upload sizes; do not allocate a large fixture in CI.
    from starlette.datastructures import UploadFile

    original = UploadFile.__init__

    def large(self, *args, **kwargs):
        original(self, *args, **kwargs)
        self.size = 6 * 1024 * 1024

    monkeypatch.setattr(UploadFile, "__init__", large)
    assert client.post("/api/calibration/calibrate", data=data, files=files).status_code == 413


def test_unreliable_distortion_inverse_is_rejected(monkeypatch, views):
    profile = known_profile()
    pose = estimate_pose(views[0], profile)
    monkeypatch.setattr(cv2, "undistortPoints", lambda *args: np.array([[[1.0, 1.0]]]))
    with pytest.raises(ValueError, match="distortion inversion"):
        image_to_board_plane([[640, 480]], profile, pose)
