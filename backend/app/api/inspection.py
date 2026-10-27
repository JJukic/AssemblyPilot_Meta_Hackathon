from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from sqlmodel import Session
from starlette.concurrency import run_in_threadpool

from app.core.config import Settings, get_settings
from app.models.diagnosis import InspectionResponse
from app.models.inspection import ImageMetadata, InspectionUnavailable
from app.services.image_processor import ImageValidationError, process_image
from app.services.inspection_errors import InspectionError
from app.services.inspection_request import build_multimodal_request, inspection_image_settings
from app.services.inspection_service import inspect_with_metadata
from app.services.meta_client import MetaClient

router = APIRouter(prefix="/api")


def get_meta_client(settings: Annotated[Settings, Depends(get_settings)]) -> MetaClient:
    return MetaClient(settings)


@router.post(
    "/inspect",
    response_model=InspectionResponse,
    responses={
        413: {"description": "Image or inspection payload too large"},
        415: {"description": "Unsupported image format"},
        404: {"description": "Project or step not found"},
        429: {"description": "Meta rate limited; see Retry-After"},
        501: {"model": InspectionUnavailable, "description": "Legacy image-only request"},
        502: {"description": "Upstream failure or invalid diagnosis"},
        503: {"description": "Meta not configured"},
        504: {"description": "Meta timeout"},
    },
)
async def inspect_image(
    request: Request,
    image: Annotated[UploadFile, File(description="A JPEG, PNG or WebP camera snapshot")],
    settings: Annotated[Settings, Depends(get_settings)],
    meta: Annotated[MetaClient, Depends(get_meta_client)],
    project_id: Annotated[str | None, Form(min_length=1, max_length=100)] = None,
    step_id: Annotated[str | None, Form(min_length=1, max_length=100)] = None,
) -> InspectionResponse | JSONResponse:
    try:
        data = await image.read(settings.max_upload_bytes + 1)
        image_settings = inspection_image_settings(settings) if project_id or step_id else settings
        processed = await run_in_threadpool(process_image, data, image_settings)
    except ImageValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    finally:
        await image.close()
    if project_id is None and step_id is None:
        legacy = InspectionUnavailable(
            detail="Context-free inspection is not implemented. Supply project_id and step_id.",
            image=ImageMetadata(
                width=processed.width,
                height=processed.height,
                original_width=processed.original_width,
                original_height=processed.original_height,
            ),
        )
        return JSONResponse(status_code=501, content=legacy.model_dump())
    if project_id is None or step_id is None:
        raise HTTPException(422, "Supply both project_id and step_id")

    def prepare():
        # SQLite/image work runs off the event loop; close the transaction before inference.
        with Session(request.app.state.engine) as session:
            return build_multimodal_request(session, settings, project_id, step_id, processed)

    try:
        context = await run_in_threadpool(prepare)
        return await inspect_with_metadata(meta, context)
    except InspectionError as exc:
        headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after is not None else None
        raise HTTPException(
            exc.status_code, detail={"code": exc.code, "message": str(exc)}, headers=headers
        ) from None
