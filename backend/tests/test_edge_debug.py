"""Independent OpenCV endpoint uses synthetic images, no model or registry prerequisites."""

import base64
import hashlib
import json
from io import BytesIO

import cv2
import numpy as np
import pytest
from PIL import Image

from app.api.edge_debug import edge_lock


def jpeg(array):
    output = BytesIO()
    Image.fromarray(array).convert("RGB").save(output, "JPEG", quality=95)
    return output.getvalue()


def scene():
    image = np.full((160, 240), 100, np.uint8)
    cv2.rectangle(image, (30, 30), (90, 100), 130, -1)
    cv2.rectangle(image, (150, 40), (210, 120), 230, -1)
    return jpeg(image)


def request(client, data=None, options=None, digest=None):
    data = data if data is not None else scene()
    return client.post(
        "/api/vision/edges",
        files={"image": ("capture.jpg", data, "image/jpeg")},
        data={
            "snapshot_id": digest or hashlib.sha256(data).hexdigest(),
            "options": json.dumps(options or {}),
        },
    )


def edge_pixels(result):
    return np.array(Image.open(BytesIO(base64.b64decode(result["edge_image"].split(",")[1]))))


def test_independent_endpoint_keeps_exact_jpeg_and_full_native_resolution(client, settings):
    data = jpeg(np.tile(np.arange(2000, dtype=np.uint8), (100, 1)))
    result = request(client, data)
    assert result.status_code == 200, result.text
    result = result.json()
    assert base64.b64decode(result["analyzed_snapshot"]["data_url"].split(",")[1]) == data
    assert result["analyzed_snapshot"]["width"] == 2000  # Above standard resize limit.
    assert result["applied_roi"] == {"left": 0, "top": 0, "width": 2000, "height": 100}
    assert result["snapshot_id"] == hashlib.sha256(data).hexdigest()
    assert edge_pixels(result).shape == (100, 2000)
    assert settings.model_api_key is None and not settings.sam_enabled
    assert client.get("/api/projects").json() == []
    assert "status" not in result and "state" not in result  # No correctness judgment.


def test_roi_canny_excludes_background_and_preserves_coordinates(client):
    roi = {"left": 15, "top": 15, "width": 100, "height": 100}
    result = request(client, options={"roi": roi, "low_threshold": 5, "high_threshold": 20}).json()
    pixels = edge_pixels(result)
    assert result["edge_pixel_count"] > 0
    assert np.count_nonzero(pixels[:, 115:]) == 0
    assert np.count_nonzero(pixels[:15]) == 0
    assert result["edge_pixel_count"] == np.count_nonzero(pixels)
    for path in result["contours"]["paths"]:
        assert all(15 <= x < 115 and 15 <= y < 115 for x, y in path["points"])


def test_thresholds_and_blur_change_real_edge_pixels(client):
    roi = {"left": 15, "top": 15, "width": 100, "height": 100}
    low = request(client, options={"roi": roi, "low_threshold": 5, "high_threshold": 20}).json()
    high = request(client, options={"roi": roi, "low_threshold": 200, "high_threshold": 250}).json()
    assert low["edge_pixel_count"] > high["edge_pixel_count"]
    noisy = jpeg(np.random.default_rng(8).integers(80, 150, (160, 240), dtype=np.uint8))
    sharp = request(client, noisy, {"blur_kernel": 1}).json()
    blurred = request(client, noisy, {"blur_kernel": 15}).json()
    assert sharp["edge_pixel_count"] > blurred["edge_pixel_count"]


@pytest.mark.parametrize(
    "options",
    [
        {"blur_kernel": 2},
        {"blur_kernel": 23},
        {"low_threshold": -1},
        {"low_threshold": 150, "high_threshold": 50},
        {"high_threshold": 300},
        {"roi": {"left": -1, "top": 0, "width": 20, "height": 20}},
        {"roi": {"left": 230, "top": 0, "width": 20, "height": 20}},
        {"roi": {"left": 0, "top": 0, "width": 1, "height": 20}},
    ],
)
def test_invalid_controls_and_roi_are_rejected(client, options):
    assert request(client, options=options).status_code == 422


def test_stale_hash_corrupt_upload_and_busy_errors(client, monkeypatch):
    assert request(client, digest="0" * 64).status_code == 409
    assert request(client, data=b"not an image").status_code == 422
    with edge_lock:
        response = request(client)
        assert response.status_code == 429 and "busy" in response.json()["detail"]

    def fail(*args):
        raise cv2.error("test extraction failure")

    monkeypatch.setattr("app.services.edge_debug.cv2.Canny", fail)
    response = request(client)
    assert response.status_code == 422 and "extraction failed" in response.json()["detail"]
    assert not edge_lock.locked()


def test_no_edges_is_a_valid_empty_debug_result(client):
    response = request(client, jpeg(np.full((80, 100), 80, np.uint8)))
    assert response.status_code == 200
    result = response.json()
    assert result["edge_pixel_count"] == 0
    assert result["contours"]["status"] == "unavailable"
    assert result["contours"]["paths"] == []
    assert not np.any(edge_pixels(result))
