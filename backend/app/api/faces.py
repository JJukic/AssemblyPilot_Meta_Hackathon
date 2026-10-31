from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlmodel import select

from app.core.config import Settings, get_settings
from app.db.database import ReadSession, WriteSession
from app.db.tables import BlockFace, FaceReference, now
from app.models.faces import FaceInput, FaceRead
from app.services.block_service import require_block
from app.services.face_registry import public_face, require_face, save_print_rule
from app.services.media_service import store_image

router = APIRouter(prefix="/api/blocks/{block_id}/faces", tags=["faces"])


def touch_block(session, block_id):
    block = require_block(session, block_id)
    block.updated_at = now()
    session.add(block)


@router.get("", response_model=list[FaceRead])
def list_faces(block_id: str, session: ReadSession):
    require_block(session, block_id)
    return [
        public_face(session, face)
        for face in session.exec(
            select(BlockFace).where(BlockFace.block_id == block_id).order_by(BlockFace.label)
        ).all()
    ]


@router.post("", response_model=FaceRead, status_code=201)
def create_face(block_id: str, data: FaceInput, session: WriteSession):
    touch_block(session, block_id)
    face = BlockFace(block_id=block_id, **data.model_dump(exclude={"print_rule"}))
    session.add(face)
    session.flush()
    save_print_rule(session, face.id, data)
    return public_face(session, face)


@router.put("/{face_id}", response_model=FaceRead)
def update_face(block_id: str, face_id: str, data: FaceInput, session: WriteSession):
    face = require_face(session, block_id, face_id)
    touch_block(session, block_id)
    face.sqlmodel_update(data.model_dump(exclude={"print_rule"}))
    session.add(face)
    session.flush()
    save_print_rule(session, face.id, data)
    return public_face(session, face)


@router.delete("/{face_id}", status_code=204)
def delete_face(block_id: str, face_id: str, session: WriteSession):
    # Photos remain ordinary block references; deleting a face removes only its labels.
    session.delete(require_face(session, block_id, face_id))
    touch_block(session, block_id)
    session.flush()


@router.post("/{face_id}/images", response_model=FaceRead, status_code=201)
def upload_face(
    block_id: str,
    face_id: str,
    session: WriteSession,
    settings: Annotated[Settings, Depends(get_settings)],
    image: Annotated[UploadFile, File()],
):
    face = require_face(session, block_id, face_id)
    touch_block(session, block_id)
    try:
        if len(public_face(session, face).references) >= 8:
            raise HTTPException(422, "At most eight reference photos per face")
        photo = store_image(
            session,
            settings,
            image.file.read(settings.max_upload_bytes + 1),
            image.filename,
            block_id=block_id,
        )
        session.add(FaceReference(face_id=face.id, image_id=photo.id))
        session.flush()
        return public_face(session, face)
    finally:
        image.file.close()
