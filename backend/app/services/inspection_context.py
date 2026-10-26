import base64

from sqlmodel import Session

from app.models.inspection_context import (
    CameraFrame,
    ExpectedBlock,
    InspectionContext,
    PreviousInspection,
)
from app.services.image_processor import ProcessedImage
from app.services.project_service import public_step, require_project, require_step


def build_inspection_context(
    session: Session,
    project_id: str,
    step_id: str,
    snapshot: ProcessedImage | None = None,
    previous_context: PreviousInspection | None = None,
) -> InspectionContext:
    project = require_project(session, project_id)
    step = public_step(session, require_step(session, project_id, step_id))
    return InspectionContext(
        project_id=project.id,
        project_name=project.name,
        step_id=step.id,
        position=step.position,
        title=step.title,
        instruction=step.instruction,
        expected_blocks=[
            ExpectedBlock(
                **item.block.model_dump(exclude={"created_at", "updated_at"}),
                required_quantity=item.required_quantity,
            )
            for item in step.required_blocks
        ],
        step_reference_images=step.reference_images,
        step_reference_image=step.reference_images[0].url if step.reference_images else None,
        snapshot=CameraFrame(
            width=snapshot.width,
            height=snapshot.height,
            jpeg_base64=base64.b64encode(snapshot.jpeg_bytes).decode("ascii"),
        )
        if snapshot
        else None,
        previous_context=previous_context,
    )
