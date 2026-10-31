from fastapi import HTTPException
from sqlmodel import select

from app.db.tables import (
    BlockFace,
    FaceReference,
    PrintedSideRule,
    ReferenceImage,
    StepFaceConstraint,
)
from app.models.faces import FaceRead
from app.models.print_config import PrintConfig
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
    config = session.get(PrintedSideRule, face.id)
    return FaceRead(
        **face.model_dump(),
        references=[public_image(image) for image in images],
        print_rule=PrintConfig.model_validate_json(config.configuration_json) if config else None,
    )


def save_print_rule(session, face_id, data):
    # Older clients updating names/photos do not silently erase the new configuration.
    if "print_rule" not in data.model_fields_set:
        return
    existing = session.get(PrintedSideRule, face_id)
    if data.print_rule is None:
        if (
            existing
            and session.exec(
                select(StepFaceConstraint).where(
                    StepFaceConstraint.required_face_id == face_id,
                    StepFaceConstraint.facing_direction == "not_required",
                )
            ).first()
        ):
            raise HTTPException(
                409, "Remove the step's print-only requirement before disabling this rule"
            )
        if existing:
            session.delete(existing)
    else:
        row = existing or PrintedSideRule(face_id=face_id, configuration_json="{}")
        row.configuration_json = data.print_rule.model_dump_json()
        session.add(row)
    session.flush()
