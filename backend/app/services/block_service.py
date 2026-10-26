from fastapi import HTTPException
from sqlmodel import Session

from app.db.tables import BuildingBlock
from app.models.blocks import BlockRead
from app.services.media_service import images_for, public_image


def require_block(session: Session, block_id: str) -> BuildingBlock:
    block = session.get(BuildingBlock, block_id)
    if block is None:
        raise HTTPException(404, "Building block not found")
    return block


def public_block(session: Session, block: BuildingBlock) -> BlockRead:
    return BlockRead(
        **block.model_dump(),
        reference_images=[public_image(image) for image in images_for(session, block_id=block.id)],
    )
