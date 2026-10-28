"""Explicit diagnosis/planning/verification, bounded sessions, no autonomous loops."""

import base64
import hashlib
from collections import OrderedDict
from dataclasses import dataclass
from datetime import UTC, datetime
from threading import RLock
from time import monotonic, perf_counter
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy.engine import Engine
from sqlmodel import Session
from starlette.concurrency import run_in_threadpool

from app.core.config import Settings
from app.models.diagnosis import AnalyzedSnapshot, InspectionResult
from app.models.workflow import (
    TrackedIssue,
    VerificationResponse,
    WorkflowInspectionResponse,
    transition,
)
from app.services.correction_planner import plan_corrections
from app.services.image_processor import ProcessedImage
from app.services.inspection_request import build_multimodal_request
from app.services.meta_client import MetaClient
from app.services.progress_service import begin_progress, complete_progress
from app.services.verification_client import VerificationClient
from app.services.sam_client import SamClient
from app.services.segmentation_service import localize_issues


@dataclass
class InspectionSession:
    inspection_id: str
    project_id: str
    step_id: str
    specification_id: str
    snapshot_hashes: tuple[str, ...]
    tracks: list[TrackedIssue]
    state: str
    expires_at: float
    busy: bool = False
    consumed: bool = False


class InspectionSessions:
    """Single-process MVP. No camera bytes, paths or secrets are retained here."""

    def __init__(self, capacity=64, ttl_seconds=1800, clock=monotonic):
        self.capacity, self.ttl_seconds, self.clock = capacity, ttl_seconds, clock
        self.entries: OrderedDict[str, InspectionSession] = OrderedDict()
        self.lock = RLock()

    def put(self, record: InspectionSession) -> None:
        with self.lock:
            for key in list(self.entries):
                if self.entries[key].expires_at <= self.clock():
                    del self.entries[key]
            self.entries[record.inspection_id] = record
            while len(self.entries) > self.capacity:
                self.entries.popitem(last=False)

    def claim(
        self, inspection_id: str, project_id: str, step_id: str, snapshot_hash: str
    ) -> InspectionSession:
        with self.lock:
            record = self.entries.get(inspection_id)
            if record is None:
                raise HTTPException(404, "Previous inspection unavailable. Start a new inspection.")
            if record.expires_at <= self.clock():
                del self.entries[inspection_id]
                raise HTTPException(410, "Inspection session expired. Start a new inspection.")
            if (record.project_id, record.step_id) != (project_id, step_id):
                raise HTTPException(409, "Previous inspection belongs to another project or step.")
            if record.busy or record.consumed:
                raise HTTPException(
                    409, "Previous inspection is busy or superseded. Reload and inspect again."
                )
            if snapshot_hash in record.snapshot_hashes:
                raise HTTPException(
                    409, "Capture a fresh image; a prior snapshot cannot verify a repair."
                )
            if len(record.snapshot_hashes) >= 32:
                raise HTTPException(
                    409, "Session observation limit reached. Start a new inspection."
                )
            record.state = transition(transition(record.state, "awaiting_rescan"), "verifying")
            record.busy = True
            return record

    def release(self, record: InspectionSession, consumed: bool = False) -> None:
        with self.lock:
            record.busy, record.consumed = False, consumed
            if not consumed:
                record.state = transition(record.state, "error")


def track_issues(result, inspection_id, snapshot_id, previous=None):
    tracks = []
    if previous is not None:
        assessments = {item.previous_issue_id: item for item in result.issue_assessments}
        for old in previous.tracks:
            assessment = assessments.get(old.issue_id)
            tracks.append(
                old.model_copy(
                    update={
                        "resolution": assessment.resolution if assessment else old.resolution,
                        "evidence": assessment.explanation if assessment else old.evidence,
                        "current_issue_index": assessment.current_issue_index
                        if assessment
                        else None,
                    }
                )
            )
    assigned = {item.current_issue_index for item in tracks}
    for index, issue in enumerate(result.issues):
        if index not in assigned:
            tracks.append(
                TrackedIssue(
                    issue_id=str(uuid4()),
                    original_inspection_id=inspection_id,
                    original_snapshot_id=snapshot_id,
                    original=issue,
                    resolution="open",
                    evidence=issue.observed,
                    current_issue_index=index,
                )
            )
    if len(tracks) > 200:
        raise HTTPException(409, "Session finding limit reached. Start a new inspection.")
    return tracks


class AssemblyOrchestrator:
    def __init__(
        self, engine: Engine, settings: Settings, sessions: InspectionSessions, meta: MetaClient,
        sam: SamClient | None = None
    ):
        self.engine, self.settings, self.sessions, self.meta = engine, settings, sessions, meta
        self.sam = sam or SamClient(settings)

    def prepare(self, project_id, step_id, image, revision, previous):
        with Session(self.engine) as session:
            session.connection().exec_driver_sql("BEGIN IMMEDIATE")
            request = build_multimodal_request(session, self.settings, project_id, step_id, image)
            fingerprint = begin_progress(
                session,
                project_id,
                step_id,
                revision,
                previous.specification_id if previous else None,
                previous.inspection_id if previous else None,
            )
            session.commit()
        return request, fingerprint

    def commit_result(self, project_id, step_id, revision, fingerprint, verified):
        with Session(self.engine) as session:
            session.connection().exec_driver_sql("BEGIN IMMEDIATE")
            complete_progress(session, project_id, step_id, revision, fingerprint, verified)
            session.commit()

    async def observe(
        self,
        project_id: str,
        step_id: str,
        image: ProcessedImage,
        previous_inspection_id: str | None = None,
    ) -> WorkflowInspectionResponse | VerificationResponse:
        snapshot_id = hashlib.sha256(image.jpeg_bytes).hexdigest()
        previous = (
            self.sessions.claim(previous_inspection_id, project_id, step_id, snapshot_id)
            if previous_inspection_id
            else None
        )
        completed = False
        try:
            revision = str(uuid4())
            request, fingerprint = await run_in_threadpool(
                self.prepare, project_id, step_id, image, revision, previous
            )
            client = VerificationClient(self.meta, previous.tracks) if previous else self.meta
            started = perf_counter()
            evidence = await client.inspect(request)
            latency = (perf_counter() - started) * 1000
            tracks = track_issues(evidence, revision, snapshot_id, previous)
            state = (
                {"correct": "verified", "incorrect": "still_incorrect", "uncertain": "uncertain"}
                if previous
                else {
                    "correct": "correct",
                    "incorrect": "correction_required",
                    "uncertain": "uncertain",
                }
            )[evidence.status]
            transition("verifying" if previous else transition("idle", "inspecting"), state)
            if previous and previous.expires_at <= self.sessions.clock():
                raise HTTPException(
                    410, "Inspection session expired during verification. Inspect again."
                )
            # Strip model-only assessments before preserving the existing diagnosis contract.
            diagnosis = InspectionResult.model_validate(
                evidence.model_dump(exclude={"issue_assessments"})
            )
            segmentations = await localize_issues(self.sam, request, diagnosis)
            if previous and previous.expires_at <= self.sessions.clock():
                raise HTTPException(410, "Inspection session expired. Inspect again.")
            response = WorkflowInspectionResponse(
                segmentations=segmentations,
                **diagnosis.model_dump(),
                meta_attempt_count=evidence._meta_attempt_count,
                inspection_id=revision,
                snapshot_id=snapshot_id,
                specification_id=fingerprint,
                state=state,
                tracked_issues=tracks,
                correction_plan=plan_corrections(diagnosis, tracks),
                analyzed_snapshot=AnalyzedSnapshot(
                    data_url="data:image/jpeg;base64,"
                    + base64.b64encode(image.jpeg_bytes).decode("ascii"),
                    width=image.width,
                    height=image.height,
                ),
                model=self.settings.meta_vision_model,
                model_latency_ms=latency,
                inspected_at=datetime.now(UTC),
            )
            await run_in_threadpool(
                self.commit_result, project_id, step_id, revision, fingerprint, state == "verified"
            )
            self.sessions.put(
                InspectionSession(
                    inspection_id=revision,
                    project_id=project_id,
                    step_id=step_id,
                    specification_id=fingerprint,
                    snapshot_hashes=(*previous.snapshot_hashes, snapshot_id)
                    if previous
                    else (snapshot_id,),
                    tracks=tracks,
                    state=state,
                    expires_at=previous.expires_at
                    if previous
                    else self.sessions.clock() + self.sessions.ttl_seconds,
                )
            )
            completed = True
            if previous:
                return VerificationResponse(
                    verification_id=str(uuid4()),
                    previous_inspection_id=previous.inspection_id,
                    status=state,
                    inspection=response,
                    issue_assessments=evidence.issue_assessments,
                )
            return response
        finally:
            if previous:
                self.sessions.release(previous, consumed=completed)
