"""Bind a validated diagnosis to the exact normalized bytes actually sent to Meta."""

import base64
from datetime import UTC, datetime
from time import perf_counter

from app.models.diagnosis import AnalyzedSnapshot, InspectionResponse
from app.models.multimodal import MultimodalInspectionRequest
from app.services.meta_client import MetaClient


async def inspect_with_metadata(
    client: MetaClient, request: MultimodalInspectionRequest
) -> InspectionResponse:
    if not request.images or request.images[0].role != "current_snapshot":
        raise ValueError("The first inspection image must be the camera snapshot")
    snapshot = request.images[0]
    started = perf_counter()
    result = await client.inspect(request)
    latency = (perf_counter() - started) * 1000
    return InspectionResponse(
        **result.model_dump(),
        analyzed_snapshot=AnalyzedSnapshot(
            data_url="data:image/jpeg;base64,"
            + base64.b64encode(snapshot.image.jpeg_bytes).decode("ascii"),
            width=snapshot.image.width,
            height=snapshot.image.height,
        ),
        model=client.settings.meta_vision_model,
        model_latency_ms=latency,
        inspected_at=datetime.now(UTC),
    )
