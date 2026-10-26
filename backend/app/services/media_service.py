import re
from pathlib import Path

from fastapi import HTTPException
from sqlmodel import Session, select

from app.core.config import Settings
from app.db.tables import ReferenceImage, new_id
from app.models.blocks import ImageRead
from app.services.image_processor import ImageValidationError, process_image


def public_image(image: ReferenceImage) -> ImageRead:
    return ImageRead(
        id=image.id,
        owner_type="block" if image.block_id else "step",
        owner_id=image.block_id or image.step_id,
        url=f"/api/media/{image.id}",
        original_filename=image.original_filename,
        mime_type=image.mime_type,
        width=image.width,
        height=image.height,
        created_at=image.created_at,
    )


def images_for(session: Session, *, block_id: str | None = None, step_id: str | None = None):
    owner = ReferenceImage.block_id == block_id if block_id else ReferenceImage.step_id == step_id
    return session.exec(
        select(ReferenceImage).where(owner).order_by(ReferenceImage.created_at, ReferenceImage.id)
    ).all()


def safe_path(settings: Settings, filename: str) -> Path:
    if not re.fullmatch(r"[0-9a-f-]{36}\.jpg", filename):
        raise HTTPException(404, "Reference image unavailable")
    root = settings.upload_path
    path = root / filename
    if path.is_symlink() or not path.resolve().is_relative_to(root):
        raise HTTPException(404, "Reference image unavailable")
    return path


def store_image(
    session: Session,
    settings: Settings,
    data: bytes,
    filename: str | None,
    *,
    block_id: str | None = None,
    step_id: str | None = None,
) -> ImageRead:
    try:
        image = process_image(data, settings)
    except ImageValidationError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    image_id = new_id()
    storage_name = f"{image_id}.jpg"
    path = safe_path(settings, storage_name)
    settings.upload_path.mkdir(parents=True, exist_ok=True)
    # Store only a display filename, never an uploaded path or control characters.
    original = (filename or "reference").replace("\\", "/").rsplit("/", 1)[-1]
    original = "".join(c for c in original if c.isprintable())[:200] or "reference"
    row = ReferenceImage(
        id=image_id,
        block_id=block_id,
        step_id=step_id,
        storage_path=storage_name,
        original_filename=original,
        width=image.width,
        height=image.height,
    )
    # Exclusive creation prevents collisions/overwrites, even if an ID were repeated.
    try:
        with path.open("xb") as file:
            session.info.setdefault("created_files", []).append(path)
            file.write(image.jpeg_bytes)
    except OSError as exc:
        raise HTTPException(503, "Unable to store reference image") from exc
    session.add(row)
    session.flush()
    return public_image(row)


def schedule_image_cleanup(session: Session, settings: Settings, images: list[ReferenceImage]):
    for image in images:
        session.info.setdefault("deleted_files", []).append(safe_path(settings, image.storage_path))
