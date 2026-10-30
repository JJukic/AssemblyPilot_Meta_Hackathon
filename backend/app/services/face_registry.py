from fastapi import HTTPException
from sqlmodel import select

from app.db.tables import BlockFace, FaceReference, ReferenceImage
from app.models.faces import FaceRead
from app.services.block_service import require_block
from app.services.media_service import public_image


def require_face(session, block_id, face_id):
    require_block(session, block_id)
    face = session.get(BlockFace, face_id)
    if not face or face.block_id != block_id:
        raise HTTPException(404, "Face not found in this block")
    return face


def public_face(session, face):
    images = session.exec(
        select(ReferenceImage)
        .join(FaceReference, ReferenceImage.id == FaceReference.image_id)
        .where(FaceReference.face_id == face.id)
        .order_by(ReferenceImage.id)
    ).all()
    return FaceRead(**face.model_dump(), references=[public_image(image) for image in images])
