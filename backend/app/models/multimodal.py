from dataclasses import dataclass
from typing import Literal

from app.models.inspection_context import InspectionContext
from app.services.image_processor import ProcessedImage


@dataclass(frozen=True)
class InspectionImage:
    role: Literal[
        "current_snapshot", "assembled_step_reference", "block_reference", "current_print_crop"
    ]
    image: ProcessedImage
    reference_id: str | None = None
    block_id: str | None = None
    source_snapshot_id: str | None = None
    source_quad: list[list[float]] | None = None


@dataclass(frozen=True)
class MultimodalInspectionRequest:
    context: InspectionContext
    images: tuple[InspectionImage, ...]
    omitted_reference_count: int = 0
