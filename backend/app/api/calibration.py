"""Explicit OpenCV-only calibration calls. No Meta requests or image persistence."""

import base64
from io import BytesIO
from threading import Lock
from typing import Annotated
from uuid import UUID

import cv2
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from app.core.config import Settings, get_settings
from app.models.calibration import (
    DEFAULT_BOARD,
    CalibrationProfile,
    CalibrationStatus,
    CameraConfiguration,
    CaptureAssessment,
)
from app.services.calibration_store import CalibrationStore
from app.services.charuco_vision import assess, board_image, calibrate, detect
from app.services.image_processor import ImageValidationError, process_image

router = APIRouter(prefix="/api/calibration", tags=["calibration"])
# Local MVP: one expensive calibration at a time, bounded images and native threads.
calibration_lock = Lock()
SettingsDep = Annotated[Settings, Depends(get_settings)]


def camera_config(value: str) -> CameraConfiguration:
    try:
        return CameraConfiguration.model_validate_json(value)
    except ValueError:
        raise HTTPException(422, "Invalid camera configuration JSON") from None


def store(settings):
    return CalibrationStore(settings.calibration_path)


async def read_image(upload, settings):
    try:
        data = await upload.read(settings.max_upload_bytes + 1)
        # Preserve native oriented pixels; rescaling would invalidate the intrinsics.
        native = settings.model_copy(update={"resize_max_dimension": settings.max_image_dimension})
        return await run_in_threadpool(process_image, data, native)
    except ImageValidationError as exc:
        raise HTTPException(exc.status_code, str(exc)) from None


@router.get("/status", response_model=CalibrationStatus)
def status(settings: SettingsDep):
    profiles, invalid = store(settings).list()
    return CalibrationStatus(
        opencv_version=cv2.__version__, profiles=profiles, invalid_profile_count=invalid
    )


@router.get("/board.pdf")
def printable_board():
    picture = board_image().convert("RGB")
    buffer = BytesIO()
    picture.save(
        buffer,
        format="PDF",
        dpi=(
            picture.width * 25.4 / (DEFAULT_BOARD.squares_x * DEFAULT_BOARD.square_mm),
            picture.height * 25.4 / (DEFAULT_BOARD.squares_y * DEFAULT_BOARD.square_mm),
        ),
    )
    return Response(
        buffer.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="charuco-7x5.pdf"'},
    )


@router.post("/detect", response_model=CaptureAssessment)
@router.post("/validate-capture", response_model=CaptureAssessment)
async def validate_capture(
    settings: SettingsDep,
    image: Annotated[UploadFile, File()],
    camera: Annotated[str, Form(max_length=2000)],
    profile_id: Annotated[UUID | None, Form()] = None,
    configuration_confirmed: Annotated[bool, Form()] = False,
):
    try:
        config = camera_config(camera)
        profile = None
        if profile_id:
            try:
                profile = await run_in_threadpool(store(settings).load, profile_id)
            except FileNotFoundError:
                raise HTTPException(404, "Calibration profile not found") from None
            except (ValueError, OSError):
                raise HTTPException(422, "Calibration profile is invalid; recalibrate") from None
        processed = await read_image(image, settings)
        if (processed.width, processed.height) != (config.width, config.height):
            raise HTTPException(409, "Declared camera resolution does not match the image")
        try:
            detection = await run_in_threadpool(detect, processed)
            result = await run_in_threadpool(
                assess, detection, config, profile, configuration_confirmed
            )
            result.analyzed_snapshot = "data:image/jpeg;base64," + base64.b64encode(
                processed.jpeg_bytes
            ).decode("ascii")
            return result
        except cv2.error:
            raise HTTPException(422, "Board detection failed; capture a clearer image") from None
    finally:
        await image.close()


@router.post("/calibrate", response_model=CalibrationProfile, status_code=201)
async def calibrate_camera(
    settings: SettingsDep,
    images: Annotated[list[UploadFile], File()],
    camera: Annotated[str, Form(max_length=2000)],
    measured_width_mm: Annotated[float, Form(gt=0)],
    measured_height_mm: Annotated[float, Form(gt=0)],
    configuration_confirmed: Annotated[bool, Form()],
):
    acquired = False
    try:
        config = camera_config(camera)
        if not configuration_confirmed:
            raise HTTPException(422, "Confirm consistent lens, focus, crop, zoom and stabilization")
        if not 12 <= len(images) <= 20:
            raise HTTPException(422, "Capture 12–20 different calibration views")
        acquired = calibration_lock.acquire(blocking=False)
        if not acquired:
            raise HTTPException(409, "Another calibration is running; retry shortly")
        detections, total = [], 0
        for upload in images:
            processed = await read_image(upload, settings)
            total += upload.size or 0
            if total > 64 * 1024 * 1024:
                raise HTTPException(413, "Calibration batch exceeds 64 MiB")
            detections.append(await run_in_threadpool(detect, processed))
        try:
            profile = await run_in_threadpool(
                calibrate, detections, config, measured_width_mm, measured_height_mm
            )
            await run_in_threadpool(store(settings).save, profile)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
        except OSError:
            raise HTTPException(503, "Calibration storage unavailable; retry locally") from None
        return profile
    except cv2.error:
        raise HTTPException(422, "Calibration failed; use sharp, varied board views") from None
    finally:
        if acquired:
            calibration_lock.release()
        for upload in images:
            await upload.close()
