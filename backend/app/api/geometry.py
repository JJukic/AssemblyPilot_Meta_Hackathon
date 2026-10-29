"""Deterministic geometric verification without a paid model request."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from app.api.calibration import camera_config
from app.core.config import Settings, get_settings
from app.models.geometry import GeometricVerificationResult, GeometryFormContext
from app.services.geometric_verification import GeometricVerifier
from app.services.image_processor import ImageValidationError, process_image

router = APIRouter(prefix="/api/geometry", tags=["geometry"])


@router.post("/verify", response_model=GeometricVerificationResult)
async def verify_geometry(
    request: Request,
    image: Annotated[UploadFile, File()],
    settings: Annotated[Settings, Depends(get_settings)],
    project_id: Annotated[str, Form(min_length=1, max_length=100)],
    step_id: Annotated[str, Form(min_length=1, max_length=100)],
    profile_id: Annotated[UUID | None, Form()] = None,
    camera: Annotated[str | None, Form(max_length=2000)] = None,
    configuration_confirmed: Annotated[bool, Form()] = False,
) -> GeometricVerificationResult:
    try:
        data = await image.read(settings.max_upload_bytes + 1)
        native = settings.model_copy(update={"resize_max_dimension": settings.max_image_dimension})
        processed = await run_in_threadpool(process_image, data, native)
    except ImageValidationError as exc:
        raise HTTPException(exc.status_code, str(exc)) from None
    finally:
        await image.close()
    context = GeometryFormContext(
        profile_id=profile_id,
        camera=camera_config(camera) if camera else None,
        configuration_confirmed=configuration_confirmed,
    )
    return await run_in_threadpool(
        GeometricVerifier(request.app.state.engine, settings).verify,
        project_id,
        step_id,
        processed,
        context,
    )
