"""Model evidence and server-owned workflow metadata remain separate contracts."""

from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from app.models.diagnosis import InspectionIssue, InspectionResponse, InspectionResult, StrictOutput
from app.models.faces import FaceResult
from app.models.geometry import GeometricVerificationResult

WorkflowState = Literal[
    "idle",
    "inspecting",
    "correct",
    "correction_required",
    "awaiting_rescan",
    "verifying",
    "verified",
    "still_incorrect",
    "uncertain",
    "error",
]

TRANSITIONS = {
    "idle": {"inspecting"},
    "inspecting": {"correct", "correction_required", "uncertain", "error"},
    "correct": {"awaiting_rescan", "inspecting"},
    "correction_required": {"awaiting_rescan", "inspecting"},
    "awaiting_rescan": {"verifying", "inspecting"},
    "verifying": {"verified", "still_incorrect", "uncertain", "error"},
    "verified": {"awaiting_rescan", "inspecting"},
    "still_incorrect": {"awaiting_rescan", "inspecting"},
    "uncertain": {"awaiting_rescan", "inspecting"},
    "error": {"awaiting_rescan", "inspecting"},
}


def transition(current: str, target: str) -> str:
    if target not in TRANSITIONS.get(current, set()):
        raise ValueError(f"Invalid workflow transition: {current} -> {target}")
    return target


class IssueAssessment(StrictOutput):
    previous_issue_id: str = Field(min_length=1, max_length=100)
    resolution: Literal["resolved", "unresolved", "uncertain"]
    explanation: str = Field(min_length=1, max_length=2000)
    current_issue_index: int | None = Field(ge=0, le=99)

    @model_validator(mode="after")
    def consistent_reference(self):
        if self.resolution == "resolved" and self.current_issue_index is not None:
            raise ValueError("Resolved findings cannot reference a current discrepancy")
        if self.resolution == "unresolved" and self.current_issue_index is None:
            raise ValueError("Unresolved findings must identify a current discrepancy")
        return self


class VerificationEvidence(InspectionResult):
    """One Muse call assesses the whole new image AND every outstanding prior finding."""

    issue_assessments: list[IssueAssessment] = Field(max_length=200)

    @model_validator(mode="after")
    def supported_verification(self):
        if self.status == "correct" and any(
            item.resolution != "resolved" for item in self.issue_assessments
        ):
            raise ValueError("Correct verification requires explicit resolution evidence")
        if self.status != "uncertain" and any(
            item.resolution == "uncertain" for item in self.issue_assessments
        ):
            raise ValueError("Uncertain findings require an uncertain overall assessment")
        return self


class TrackedIssue(StrictOutput):
    issue_id: str
    original_inspection_id: str
    original_snapshot_id: str
    original: InspectionIssue
    resolution: Literal["open", "resolved", "unresolved", "uncertain"]
    evidence: str
    current_issue_index: int | None


class CorrectionAction(StrictOutput):
    issue_id: str | None
    block_id: str | None
    kind: Literal["adjust", "geometry_adjust", "face_adjust", "face_capture", "capture"]
    instruction: str


class WorkflowInspectionResponse(InspectionResponse):
    inspection_id: str
    snapshot_id: str = Field(pattern=r"^[a-f0-9]{64}$")
    specification_id: str = Field(pattern=r"^[a-f0-9]{64}$")
    state: WorkflowState
    tracked_issues: list[TrackedIssue] = Field(max_length=200)
    correction_plan: list[CorrectionAction] = Field(max_length=100)
    geometry: GeometricVerificationResult | None = None
    face: FaceResult | None = None
    muse_call_count: Literal[1] = 1
    meta_attempt_count: int = Field(ge=1, le=3)

    @model_validator(mode="after")
    def consistent_workflow(self):
        import base64
        import hashlib

        digest = hashlib.sha256(
            base64.b64decode(self.analyzed_snapshot.data_url.split(",", 1)[1], validate=True)
        ).hexdigest()
        if digest != self.snapshot_id:
            raise ValueError("Snapshot identity mismatch")
        states = {
            "correct": {"correct", "verified"},
            "incorrect": {"correction_required", "still_incorrect"},
            "uncertain": {"uncertain"},
        }
        allowed = states[self.status]
        if self.status == "correct" and self.geometry and self.geometry.constraint_id:
            allowed = {
                "correct": {"correct", "verified"},
                "incorrect": {"correction_required", "still_incorrect"},
                "uncertain": {"uncertain"},
                "not_measured": {"uncertain"},
            }[self.geometry.geometry_status]
        if self.face and self.face.expected_face_id:
            if self.face.status == "incorrect":
                allowed = {"correction_required", "still_incorrect"}
            elif self.face.status == "uncertain" and allowed == {"correct", "verified"}:
                allowed = {"uncertain"}
        if self.state not in allowed:
            raise ValueError("Workflow state contradicts diagnostic evidence")
        ids = [item.issue_id for item in self.tracked_issues]
        indices = [
            item.current_issue_index
            for item in self.tracked_issues
            if item.current_issue_index is not None
        ]
        if len(ids) != len(set(ids)) or sorted(indices) != list(range(len(self.issues))):
            raise ValueError("Findings must identify every current issue exactly once")
        if self.state == "verified" and any(
            item.resolution != "resolved" for item in self.tracked_issues
        ):
            raise ValueError("Verified requires every tracked finding resolved")
        return self


class VerificationResponse(StrictOutput):
    verification_id: str
    previous_inspection_id: str
    status: Literal["verified", "still_incorrect", "uncertain"]
    inspection: WorkflowInspectionResponse
    issue_assessments: list[IssueAssessment]

    @model_validator(mode="after")
    def consistent_result(self):
        if (
            self.status != self.inspection.state
            or self.previous_inspection_id == self.inspection.inspection_id
        ):
            raise ValueError("Verification must describe a new, consistent inspection")
        return self


class StepProgressRead(StrictOutput):
    step_id: str
    specification_id: str
    status: Literal["not_started", "in_progress", "verified"]
    verified_at: datetime | None
