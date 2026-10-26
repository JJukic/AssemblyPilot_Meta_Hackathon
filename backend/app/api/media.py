from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import FileResponse

from app.core.config import Settings, get_settings
from app.db.database import ReadSession, WriteSession
from app.db.tables import ReferenceImage
from app.services.media_service import safe_path, schedule_image_cleanup

router = APIRouter(prefix="/api/media", tags=["media"])
Config = Annotated[Settings, Depends(get_settings)]


@router.get("/{image_id}")
def get_image(image_id: str, session: ReadSession, settings: Config):
    image = session.get(ReferenceImage, image_id)
    if image is None:
        raise HTTPException(404, "Reference image not found")
    path = safe_path(settings, image.storage_path)
    if not path.is_file():
        raise HTTPException(404, "Reference image file unavailable")
    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
        },
    )


@router.delete("/{image_id}", status_code=204)
def delete_image(image_id: str, session: WriteSession, settings: Config):
    image = session.get(ReferenceImage, image_id)
    if image is None:
        raise HTTPException(404, "Reference image not found")
    schedule_image_cleanup(session, settings, [image])
    session.delete(image)
    session.flush()
    return Response(status_code=204)
