import pytest


@pytest.mark.parametrize("format", ["JPEG", "PNG", "WEBP"])
def test_valid_upload_returns_honest_501(client, image_bytes, format):
    response = client.post(
        "/api/inspect", files={"image": ("frame", image_bytes(format), "application/octet-stream")}
    )
    assert response.status_code == 501
    body = response.json()
    assert body["status"] == "not_implemented"
    assert body["image"]["width"] == 100
    assert "not implemented" in body["detail"]
    assert "diagnosis" not in body


def test_invalid_upload(client):
    response = client.post("/api/inspect", files={"image": ("fake.jpg", b"text", "image/jpeg")})
    assert response.status_code == 422


def test_unsupported_upload(client, image_bytes):
    response = client.post("/api/inspect", files={"image": ("fake.jpg", image_bytes("BMP"))})
    assert response.status_code == 415


def test_missing_upload(client):
    assert client.post("/api/inspect").status_code == 422


def test_oversized_upload(client, settings, image_bytes):
    settings.max_upload_bytes = 10
    response = client.post("/api/inspect", files={"image": ("frame.jpg", image_bytes())})
    assert response.status_code == 413
