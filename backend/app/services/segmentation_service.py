"""One bounded localization pass; SAM never changes an assembly diagnosis."""

from time import perf_counter

from starlette.concurrency import run_in_threadpool

from app.models.diagnosis import BoundingBox, InspectionResult
from app.models.multimodal import MultimodalInspectionRequest
from app.models.segmentation import IssueSegmentation, SegmentationInstance, SegmentationResult
from app.services.contour_service import sam_outline
from app.services.inspection_errors import InspectionError
from app.services.sam_client import SamClient, snapshot_identity

COLORS = frozenset(
    "red green blue yellow orange purple pink white black gray grey brown cyan".split()
)


def overlap(instance: SegmentationInstance, result: SegmentationResult, hint: BoundingBox) -> float:
    left, top = instance.left / result.width, instance.top / result.height
    width, height = instance.mask.width / result.width, instance.mask.height / result.height
    intersection = max(0, min(left + width, hint.x + hint.width) - max(left, hint.x)) * max(
        0, min(top + height, hint.y + hint.height) - max(top, hint.y)
    )
    return intersection / (width * height + hint.width * hint.height - intersection)


def select_instance(result: SegmentationResult, hint: BoundingBox | None) -> str | None:
    if not result.instances:
        return None
    if hint is None:
        return result.instances[0].instance_id if len(result.instances) == 1 else None
    # A single candidate contradicting the hint is ambiguous too. Thresholds are
    # association heuristics, never calibrated confidence or physical verification.
    ranked = sorted(
        ((overlap(item, result, hint), item.instance_id) for item in result.instances), reverse=True
    )
    if ranked[0][0] >= 0.25 and (len(ranked) == 1 or ranked[0][0] - ranked[1][0] >= 0.15):
        return ranked[0][1]
    return None


async def localize_issues(
    client: SamClient, request: MultimodalInspectionRequest, diagnosis: InspectionResult
) -> list[IssueSegmentation]:
    if diagnosis.status != "incorrect":
        return []
    image = request.images[0].image
    blocks = {block.id: block for block in request.context.expected_blocks}
    localizations = []
    calls = 0
    for index, issue in enumerate(diagnosis.issues):
        entry = IssueSegmentation(
            issue_index=index,
            status="skipped",
            message="No reliable visible component description or spatial hint.",
        )
        localizations.append(entry)
        if issue.type == "missing_part":
            entry.message = "Missing components have no visible mask."
            continue
        if not client.settings.sam_enabled:
            entry.status, entry.message = "disabled", "Segmentation is disabled."
            continue
        if issue.type == "unknown":
            continue
        block = blocks.get(issue.block_id)
        concept = None
        if (
            issue.type in {"misplaced_part", "wrong_orientation"}
            and block
            and block.color.lower() in COLORS
        ):
            concept = f"{block.color.lower()} building block"
        # Wrong-color issues must not search for the EXPECTED color. A reliable
        # observed box can prompt the official spatial mode without inventing a color.
        if concept is None and issue.bounding_box is None:
            continue
        if calls >= client.settings.sam_max_concepts_per_inspection:
            entry.message = "Segmentation request limit reached for this inspection."
            continue
        calls += 1
        entry.concept, entry.prompt_kind = concept, "concept" if concept else "box"
        started = perf_counter()
        try:
            result = await client.segment(
                image, concept, box=None if concept else issue.bounding_box
            )
            if result.snapshot_id != snapshot_identity(image) or (result.width, result.height) != (
                image.width,
                image.height,
            ):
                raise InspectionError(
                    "sam_snapshot_mismatch", "SAM snapshot identity did not match."
                )
            selected = select_instance(result, issue.bounding_box)
            entry.result, entry.selected_instance_id = result, selected
            if not result.instances:
                entry.status, entry.message = "no_match", "SAM found no matching visible component."
            elif selected is None:
                entry.status = "ambiguous"
                entry.message = "Localization is ambiguous. No SAM instance is highlighted."
            else:
                entry.status, entry.message = (
                    "matched",
                    "SAM localized the indicated visible component.",
                )
        except InspectionError as exc:
            entry.status = "unavailable"
            entry.message = f"Segmentation unavailable: {exc} Muse diagnosis is retained."
        finally:
            entry.latency_ms = (perf_counter() - started) * 1000
    for entry in localizations:
        entry.outline = await run_in_threadpool(
            sam_outline, entry, snapshot_identity(image), image.width, image.height
        )
    return localizations
