from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from sqlalchemy import or_
from sqlmodel import select

from app.core.config import Settings, get_settings
from app.db.database import ReadSession, WriteSession
from app.db.tables import AssemblyStepBlock, BuildingBlock, now
from app.models.blocks import BlockInput, BlockRead, ImageRead
from app.services.block_service import public_block, require_block
from app.services.media_service import images_for, schedule_image_cleanup, store_image

router = APIRouter(prefix="/api/blocks", tags=["blocks"])
Config = Annotated[Settings, Depends(get_settings)]


@router.get("", response_model=list[BlockRead])
def list_blocks(
    session: ReadSession,
    search: str = Query(default="", max_length=200),
    color: str = Query(default="", max_length=80),
    category: str = Query(default="", max_length=80),
):
    query = select(BuildingBlock)
    if search.strip():
        # contains(autoescape=True) treats literal '%' and '_' as search text, not SQL wildcards.
        query = query.where(
            or_(
                BuildingBlock.name.icontains(search.strip(), autoescape=True),
                BuildingBlock.color.icontains(search.strip(), autoescape=True),
                BuildingBlock.category.icontains(search.strip(), autoescape=True),
            )
        )
    if color:
        query = query.where(
            BuildingBlock.color.ilike(color.replace("%", "\\%").replace("_", "\\_"), escape="\\")
        )
    if category:
        query = query.where(
            BuildingBlock.category.ilike(
                category.replace("%", "\\%").replace("_", "\\_"), escape="\\"
            )
        )
    blocks = session.exec(query.order_by(BuildingBlock.name, BuildingBlock.id)).all()
    return [public_block(session, block) for block in blocks]


@router.post("", response_model=BlockRead, status_code=201)
def create_block(data: BlockInput, session: WriteSession):
    block = BuildingBlock(**data.model_dump())
    session.add(block)
    session.flush()
    return public_block(session, block)


@router.get("/{block_id}", response_model=BlockRead)
def get_block(block_id: str, session: ReadSession):
    return public_block(session, require_block(session, block_id))


@router.put("/{block_id}", response_model=BlockRead)
def update_block(block_id: str, data: BlockInput, session: WriteSession):
    block = require_block(session, block_id)
    block.sqlmodel_update(data.model_dump())
    block.updated_at = now()
    session.add(block)
    session.flush()
    return public_block(session, block)


@router.delete("/{block_id}", status_code=204)
def delete_block(block_id: str, session: WriteSession, settings: Config):
    block = require_block(session, block_id)
    if session.exec(
        select(AssemblyStepBlock).where(AssemblyStepBlock.block_id == block_id)
    ).first():
        raise HTTPException(
            409, "This block is used in assembly steps. Remove those assignments first."
        )
    schedule_image_cleanup(session, settings, images_for(session, block_id=block_id))
    session.delete(block)
    session.flush()
    return Response(status_code=204)


@router.post("/{block_id}/images", response_model=ImageRead, status_code=201)
def upload_block_image(
    block_id: str, session: WriteSession, settings: Config, image: Annotated[UploadFile, File()]
):
    require_block(session, block_id)
    try:
        return store_image(
            session,
            settings,
            image.file.read(settings.max_upload_bytes + 1),
            image.filename,
            block_id=block_id,
        )
    finally:
        image.file.close()
