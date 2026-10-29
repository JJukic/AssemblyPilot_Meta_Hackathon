from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from app.core.config import Settings, get_settings
from app.models.inspection import ImageMetadata, InspectionUnavailable
from app.models.workflow import VerificationResponse, WorkflowInspectionResponse
from app.services.assembly_orchestrator import AssemblyOrchestrator
from app.services.image_processor import ImageValidationError, process_image
from app.services.inspection_errors import InspectionError
from app.services.inspection_request import inspection_image_settings
from app.services.meta_client import MetaClient
from app.services.sam_client import SamClient

router = APIRouter(prefix="/api")


def get_meta_client(settings: Annotated[Settings, Depends(get_settings)]) -> MetaClient:
    return MetaClient(settings)


def get_sam_client(settings: Annotated[Settings, Depends(get_settings)]) -> SamClient:
    return SamClient(settings)


@router.post(
    "/inspect",
    response_model=WorkflowInspectionResponse,
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
    sam: Annotated[SamClient, Depends(get_sam_client)],
    project_id: Annotated[str | None, Form(min_length=1, max_length=100)] = None,
    step_id: Annotated[str | None, Form(min_length=1, max_length=100)] = None,
) -> WorkflowInspectionResponse | JSONResponse:
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

    try:
        return await AssemblyOrchestrator(
            request.app.state.engine, settings, request.app.state.inspection_sessions, meta, sam
        ).observe(project_id, step_id, processed)
    except InspectionError as exc:
        headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after is not None else None
        raise HTTPException(
            exc.status_code, detail={"code": exc.code, "message": str(exc)}, headers=headers
        ) from None


@router.post("/verify", response_model=VerificationResponse)
async def verify_image(
    request: Request,
    image: Annotated[UploadFile, File()],
    settings: Annotated[Settings, Depends(get_settings)],
    meta: Annotated[MetaClient, Depends(get_meta_client)],
    sam: Annotated[SamClient, Depends(get_sam_client)],
    project_id: Annotated[str, Form(min_length=1, max_length=100)],
    step_id: Annotated[str, Form(min_length=1, max_length=100)],
    previous_inspection_id: Annotated[str, Form(min_length=1, max_length=100)],
) -> VerificationResponse:
    try:
        data = await image.read(settings.max_upload_bytes + 1)
        processed = await run_in_threadpool(
            process_image, data, inspection_image_settings(settings)
        )
    except ImageValidationError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    finally:
        await image.close()
    try:
        return await AssemblyOrchestrator(
            request.app.state.engine, settings, request.app.state.inspection_sessions, meta, sam
        ).observe(project_id, step_id, processed, previous_inspection_id)
    except InspectionError as exc:
        headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after is not None else None
        raise HTTPException(
            exc.status_code,
            detail={
                "code": exc.code,
                "message": "AI verification is temporarily unavailable. Please retry. " + str(exc),
            },
            headers=headers,
        ) from None
