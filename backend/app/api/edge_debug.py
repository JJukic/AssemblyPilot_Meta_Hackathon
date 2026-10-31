"""Explicit local edge extraction; no Meta credentials, project, or inference required."""

from threading import Lock
from typing import Annotated

import cv2
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.core.config import Settings, get_settings
from app.models.edge_debug import EdgeDebugResult, EdgeOptions
from app.services.edge_debug import extract_edges
from app.services.image_processor import ImageValidationError

router = APIRouter(prefix="/api/vision", tags=["edge debug"])
edge_lock = Lock()


@router.post("/edges", response_model=EdgeDebugResult)
async def edges(
    settings: Annotated[Settings, Depends(get_settings)],
    image: Annotated[UploadFile, File()],
    snapshot_id: Annotated[str, Form(pattern=r"^[a-f0-9]{64}$")],
    options: Annotated[str, Form(max_length=2000)] = "{}",
):
    acquired = False
    try:
        try:
            controls = EdgeOptions.model_validate_json(options)
        except ValueError:
            raise HTTPException(
                422,
                "Invalid edge settings: use an odd blur size (1–21), "
                "0 ≤ low < high ≤ 255, and a rectangular pixel ROI.",
            ) from None
        acquired = edge_lock.acquire(blocking=False)
        if not acquired:
            raise HTTPException(429, "Edge extraction is busy. Please retry shortly.")
        data = await image.read(settings.max_upload_bytes + 1)
        return await run_in_threadpool(extract_edges, data, snapshot_id, controls, settings)
    except ImageValidationError as exc:
        raise HTTPException(exc.status_code, str(exc)) from None
    except (cv2.error, ValueError, OSError):
        raise HTTPException(
            422, "OpenCV edge extraction failed. Adjust the ROI/settings or capture a new snapshot."
        ) from None
    finally:
        if acquired:
            edge_lock.release()
        await image.close()
