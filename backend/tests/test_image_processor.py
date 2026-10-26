from io import BytesIO

import pytest
from PIL import Image

from app.services.image_processor import ImageValidationError, process_image


@pytest.mark.parametrize("format", ["JPEG", "PNG", "WEBP"])
def test_valid_formats_become_jpeg(image_bytes, settings, format):
    result = process_image(image_bytes(format), settings)
    with Image.open(BytesIO(result.jpeg_bytes)) as image:
        assert image.format == "JPEG"
        assert image.size == (100, 80)
        assert image.mode == "RGB"


@pytest.mark.parametrize("data", [b"", b"not an image", b"\xff\xd8\xffcorrupt"])
def test_invalid_image(data, settings):
    with pytest.raises(ImageValidationError):
        process_image(data, settings)


def test_unsupported_format(image_bytes, settings):
    with pytest.raises(ImageValidationError) as error:
        process_image(image_bytes("GIF"), settings)
    assert error.value.status_code == 415


def test_upload_size_limit(image_bytes, settings):
    settings.max_upload_bytes = 10
    with pytest.raises(ImageValidationError) as error:
        process_image(image_bytes(), settings)
    assert error.value.status_code == 413


@pytest.mark.parametrize("size", [(10, 80), (100, 10)])
def test_too_small(image_bytes, settings, size):
    with pytest.raises(ImageValidationError):
        process_image(image_bytes(size=size), settings)


@pytest.mark.parametrize("limit", ["max_image_dimension", "max_image_pixels"])
def test_dimension_limit(image_bytes, settings, limit):
    setattr(settings, limit, 50)
    with pytest.raises(ImageValidationError) as error:
        process_image(image_bytes(), settings)
    assert error.value.status_code == 413


def test_resize_preserves_aspect_ratio(image_bytes, settings):
    result = process_image(image_bytes(size=(2400, 1200)), settings)
    assert (result.width, result.height) == (1600, 800)
    assert (result.original_width, result.original_height) == (2400, 1200)


def test_small_images_are_not_upscaled(image_bytes, settings):
    result = process_image(image_bytes(size=(64, 32)), settings)
    assert (result.width, result.height) == (64, 32)


def test_exif_orientation_and_metadata_removed(image_bytes, settings):
    exif = Image.Exif()
    exif[274] = 6
    result = process_image(image_bytes(size=(100, 50), exif=exif), settings)
    assert (result.width, result.height) == (50, 100)
    with Image.open(BytesIO(result.jpeg_bytes)) as image:
        assert not image.getexif()


def test_alpha_flattened_to_white(settings):
    buffer = BytesIO()
    Image.new("RGBA", (64, 64), (0, 0, 0, 0)).save(buffer, format="PNG")
    result = process_image(buffer.getvalue(), settings)
    with Image.open(BytesIO(result.jpeg_bytes)) as image:
        assert image.getpixel((0, 0)) == (255, 255, 255)


def test_truncated_jpeg_rejected(image_bytes, settings):
    with pytest.raises(ImageValidationError):
        process_image(image_bytes()[:-30], settings)


def test_animated_png_rejected(settings):
    buffer = BytesIO()
    Image.new("RGB", (64, 64), "blue").save(
        buffer,
        format="PNG",
        save_all=True,
        append_images=[Image.new("RGB", (64, 64), "red")],
        duration=100,
        loop=0,
    )
    with pytest.raises(ImageValidationError) as error:
        process_image(buffer.getvalue(), settings)
    assert error.value.status_code == 415
