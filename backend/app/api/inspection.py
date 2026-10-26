from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.core.config import Settings, get_settings
from app.models.inspection import ImageMetadata, InspectionUnavailable
from app.services.image_processor import ImageValidationError, process_image

router = APIRouter(prefix="/api")


@router.post(
    "/inspect",
    status_code=501,
    response_model=InspectionUnavailable,
    responses={413: {"description": "Image too large"}, 415: {"description": "Unsupported format"}},
)
async def inspect_image(
    image: Annotated[UploadFile, File(description="A JPEG, PNG or WebP image")],
    settings: Annotated[Settings, Depends(get_settings)],
) -> InspectionUnavailable:
    try:
        data = await image.read(settings.max_upload_bytes + 1)
        processed = await run_in_threadpool(process_image, data, settings)
    except ImageValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    finally:
        await image.close()
    return InspectionUnavailable(
        image=ImageMetadata(
            width=processed.width,
            height=processed.height,
            original_width=processed.original_width,
            original_height=processed.original_height,
        )
    )
