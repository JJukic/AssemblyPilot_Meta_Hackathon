"""Deterministic planning from validated evidence; zero extra inference calls."""

from app.models.diagnosis import InspectionResult
from app.models.workflow import CorrectionAction, TrackedIssue


def plan_corrections(
    result: InspectionResult, tracks: list[TrackedIssue]
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
    if result.status == "correct":
        return []
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
    return actions
