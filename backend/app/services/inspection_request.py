"""Materialize only permitted reference bytes; never hand file paths or URLs to a model."""

from fastapi import HTTPException
from sqlmodel import Session

from app.core.config import Settings
from app.db.tables import ReferenceImage
from app.models.multimodal import InspectionImage, MultimodalInspectionRequest
from app.services.image_processor import ImageValidationError, ProcessedImage, process_image
from app.services.inspection_context import build_inspection_context
from app.services.inspection_errors import InspectionError
from app.services.media_service import safe_path


def inspection_image_settings(settings: Settings) -> Settings:
    return settings.model_copy(update={"resize_max_dimension": settings.inspection_max_dimension})


def load_reference_image(
    session: Session,
    settings: Settings,
    reference_id: str,
    *,
    block_id: str | None = None,
    step_id: str | None = None,
) -> ProcessedImage:
    record = session.get(ReferenceImage, reference_id)
    if record is None or record.block_id != block_id or record.step_id != step_id:
        raise InspectionError(
            "reference_unavailable",
            "A selected reference image is unavailable. Reload or replace the reference.",
            409,
        )
    try:
        path = safe_path(settings, record.storage_path)
        with path.open("rb") as file:
            data = file.read(settings.max_upload_bytes + 1)
        return process_image(data, inspection_image_settings(settings))
    except (OSError, HTTPException, ImageValidationError) as exc:
        raise InspectionError(
            "reference_unavailable",
            "A selected reference image cannot be read safely. Replace it before inspecting.",
            409,
        ) from exc


def build_multimodal_request(
    session: Session, settings: Settings, project_id: str, step_id: str, snapshot: ProcessedImage
) -> MultimodalInspectionRequest:
    context = build_inspection_context(session, project_id, step_id)
    images = [InspectionImage(role="current_snapshot", image=snapshot)]
    # One assembled-step view, then one identifying photo per assigned block. Deterministic order.
    candidates = []
    if context.step_reference_images:
        candidates.append((context.step_reference_images[0], None, step_id))
    for block in context.expected_blocks:
        if block.reference_images:
            candidates.append((block.reference_images[0], block.id, None))
    for reference, block_id, owner_step_id in candidates[: settings.meta_max_reference_images]:
        image = load_reference_image(
            session, settings, reference.id, block_id=block_id, step_id=owner_step_id
        )
        images.append(
            InspectionImage(
                role="block_reference" if block_id else "assembled_step_reference",
                image=image,
                reference_id=reference.id,
                block_id=block_id,
            )
        )
    available_count = len(context.step_reference_images) + sum(
        len(block.reference_images) for block in context.expected_blocks
    )
    return MultimodalInspectionRequest(
        context=context,
        images=tuple(images),
        omitted_reference_count=available_count - (len(images) - 1),
    )
