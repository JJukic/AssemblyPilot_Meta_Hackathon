"""Deterministic planning from validated evidence; zero extra inference calls."""

from app.models.diagnosis import InspectionResult
from app.models.geometry import GeometricVerificationResult
from app.models.workflow import CorrectionAction, TrackedIssue


def plan_corrections(
    result: InspectionResult,
    tracks: list[TrackedIssue],
    geometry: GeometricVerificationResult | None = None,
) -> list[CorrectionAction]:
    if result.active_vision:
        return [
            CorrectionAction(
                issue_id=None,
                block_id=None,
                kind="capture",
                instruction=result.active_vision.instruction,
            )
        ]
    actions = []
    for index, issue in enumerate(result.issues):
        track = next(item for item in tracks if item.current_issue_index == index)
        actions.append(
            CorrectionAction(
                issue_id=track.issue_id,
                block_id=issue.block_id,
                kind="adjust",
                instruction=issue.suggested_fix,
            )
        )
    if geometry and geometry.constraint_id:
        if geometry.geometry_status == "incorrect":
            target = next(
                (item.block_id for item in geometry.evidence.features if item.role == "target"),
                None,
            )
            actions.append(
                CorrectionAction(
                    issue_id=None,
                    block_id=target,
                    kind="geometry_adjust",
                    instruction=geometry.guidance,
                )
            )
        elif geometry.geometry_status in {"uncertain", "not_measured"}:
            actions.append(
                CorrectionAction(
                    issue_id=None,
                    block_id=None,
                    kind="capture",
                    instruction=geometry.guidance,
                )
            )
    return actions
