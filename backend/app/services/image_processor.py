"""Decode untrusted images, normalize orientation, and return metadata-free JPEG bytes."""

import warnings
from dataclasses import dataclass
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import Settings


class ImageValidationError(ValueError):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class ProcessedImage:
    jpeg_bytes: bytes
    width: int
    height: int
    original_width: int
    original_height: int


def process_image(data: bytes, settings: Settings) -> ProcessedImage:
    if not data:
        raise ImageValidationError("The image is empty")
    if len(data) > settings.max_upload_bytes:
        raise ImageValidationError("Image exceeds the upload size limit", 413)

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as source:
                if source.format not in {"JPEG", "PNG", "WEBP"}:
                    raise ImageValidationError("Only JPEG, PNG and WebP images are supported", 415)
                width, height = source.size
                if (
                    width * height > settings.max_image_pixels
                    or max(width, height) > settings.max_image_dimension
                ):
                    raise ImageValidationError("Image dimensions exceed the configured limit", 413)
                if min(width, height) < settings.min_image_dimension:
                    raise ImageValidationError("Image dimensions are too small")
                if getattr(source, "is_animated", False):
                    raise ImageValidationError("Animated images are not supported", 415)
                source.verify()
            with Image.open(BytesIO(data)) as source:
                source.load()
                corrected = ImageOps.exif_transpose(source)
                original_width, original_height = corrected.size
                corrected.thumbnail(
                    (settings.resize_max_dimension, settings.resize_max_dimension),
                    Image.Resampling.LANCZOS,
                )
                # Flatten transparency on white and omit EXIF, ICC and other source metadata.
                rgba = corrected.convert("RGBA")
                output = Image.new("RGB", rgba.size, "white")
                output.paste(rgba, mask=rgba.getchannel("A"))
                buffer = BytesIO()
                output.save(buffer, format="JPEG", quality=85)
                return ProcessedImage(
                    buffer.getvalue(), output.width, output.height, original_width, original_height
                )
    except ImageValidationError:
        raise
    except (Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise ImageValidationError("Image exceeds safe decoding limits", 413) from exc
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
        raise ImageValidationError("Invalid or corrupt image") from exc
