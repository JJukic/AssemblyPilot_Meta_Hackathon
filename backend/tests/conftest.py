from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.core.config import Settings
from app.main import create_app


@pytest.fixture
def settings(tmp_path):
    return Settings(
        _env_file=None,
        model_api_key=None,
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        upload_dir=str(tmp_path / "uploads"),
    )


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as client:
        yield client


@pytest.fixture
def image_bytes():
    def make(format="JPEG", size=(100, 80), mode="RGB", **save_options):
        buffer = BytesIO()
        Image.new(mode, size, "blue").save(buffer, format=format, **save_options)
        return buffer.getvalue()

    return make
