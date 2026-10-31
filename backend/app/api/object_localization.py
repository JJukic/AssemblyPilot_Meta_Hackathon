"""One explicit SAM request for an exact inspected JPEG, independent of verdicts."""

import hashlib
from io import BytesIO
from time import perf_counter
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from PIL import Image
from starlette.concurrency import run_in_threadpool

from app.api.inspection import get_sam_client
from app.core.config import Settings, get_settings
from app.models.segmentation import ObjectLocalization, ObjectOutline
from app.services.contour_service import instance_outline
from app.services.image_processor import ImageValidationError, ProcessedImage, process_image
from app.services.inspection_errors import InspectionError
from app.services.sam_client import SamClient

router = APIRouter(prefix="/api/vision", tags=["object localization"])


def exact_image(data, snapshot_id, settings):
    checked = process_image(data, settings.model_copy(update={"resize_max_dimension": 1600}))
    if hashlib.sha256(data).hexdigest() != snapshot_id:
        raise ImageValidationError("Inspected snapshot identity changed.", 409)
    with Image.open(BytesIO(data)) as source:
        if source.format != "JPEG" or source.getexif().get(274, 1) != 1:
            raise ImageValidationError("Use the exact upright analyzed JPEG.")
        if source.size != (checked.width, checked.height):
            raise ImageValidationError("Use the analyzed snapshot, at most 1600 pixels per side.")
    return ProcessedImage(data, checked.width, checked.height, checked.width, checked.height)


def outlines(result):
    return [
        ObjectOutline(
            instance_id=item.instance_id,
            outline=instance_outline(item, result.snapshot_id, result.width, result.height),
        )
        for item in result.instances
    ]


@router.post("/objects", response_model=ObjectLocalization)
async def localize_objects(
    settings: Annotated[Settings, Depends(get_settings)],
    sam: Annotated[SamClient, Depends(get_sam_client)],
    image: Annotated[UploadFile, File()],
    snapshot_id: Annotated[str, Form(pattern=r"^[a-f0-9]{64}$")],
    concept: Annotated[str, Form(min_length=1, max_length=80)],
):
    try:
        if not concept.strip():
            raise HTTPException(422, "Describe a visible object to localize.")
        data = await image.read(settings.max_upload_bytes + 1)
        frame = await run_in_threadpool(exact_image, data, snapshot_id, settings)
        started = perf_counter()
        result = await sam.segment(frame, concept.strip())
        if (result.snapshot_id, result.width, result.height) != (
            snapshot_id,
            frame.width,
            frame.height,
        ):
            raise InspectionError("sam_snapshot_mismatch", "SAM returned a different snapshot.")
        return ObjectLocalization(
            concept=concept.strip(),
            result=result,
            outlines=await run_in_threadpool(outlines, result),
            latency_ms=(perf_counter() - started) * 1000,
        )
    except ImageValidationError as exc:
        raise HTTPException(exc.status_code, str(exc)) from None
    except InspectionError as exc:
        raise HTTPException(
            exc.status_code, detail={"code": exc.code, "message": str(exc)}
        ) from None
    finally:
        await image.close()
