"""External-camera bridge for in-AR inspection.

The HoloLens stays in immersive AR. A companion device (MacBook/iPhone
browser) that can capture real frames polls for capture requests scoped
by project + a short-lived pairing code, runs the existing inspection
pipeline itself, and posts back only a bounded, validated result
summary. No camera frames, data URLs or masks pass through this bridge,
and nothing here can mark a step verified — verification remains the
existing /api/verify + progress flow on the companion.
"""

import re
import secrets
import threading
import time
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/ar-camera", tags=["ar-camera"])

CODE = re.compile(r"^[A-Za-z0-9]{6,12}$")
TTL_SECONDS = 600


class IssueSummary(BaseModel):
    type: str = Field(max_length=60)
    description: str = Field(max_length=2000)
    expected: str = Field(max_length=2000)
    observed: str = Field(max_length=2000)
    suggested_fix: str = Field(max_length=2000)


class OverallSummary(BaseModel):
    kind: str = Field(pattern=r"^(verified|incorrect|uncertain|correct|inspecting|error)$")
    printGate: str | None = Field(default=None, max_length=20)
    expectedPrint: str | None = Field(default=None, max_length=2000)
    observedPrint: str | None = Field(default=None, max_length=2000)
    printAction: str | None = Field(default=None, max_length=2000)
    faceStatus: str | None = Field(default=None, max_length=60)
    geometryStatus: str | None = Field(default=None, max_length=60)


class BridgeSummary(BaseModel):
    kind: str = Field(pattern=r"^(inspection|verification|error|inspecting)$")
    state: str | None = Field(default=None, max_length=60)
    status: str | None = Field(default=None, max_length=20)
    explanation: str = Field(default="", max_length=2000)
    issues: list[IssueSummary] = Field(default_factory=list, max_length=20)
    correctionPlan: list[str] = Field(default_factory=list, max_length=20)
    nextAction: str = Field(default="", max_length=2000)
    errorMessage: str | None = Field(default=None, max_length=2000)
    verificationStatus: str | None = Field(
        default=None, pattern=r"^(verified|still_incorrect|uncertain)$"
    )
    specificationId: str | None = Field(default=None, max_length=200)
    inspectionId: str | None = Field(default=None, max_length=200)
    snapshotId: str | None = Field(default=None, max_length=200)
    overall: OverallSummary | None = None


class CreateRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=100)
    step_id: str = Field(min_length=1, max_length=100)
    code: str = Field(min_length=6, max_length=12)
    mode: str = Field(default="inspect", pattern=r"^(inspect|verify)$")


class ResultPost(BaseModel):
    code: str = Field(min_length=6, max_length=12)
    summary: BridgeSummary


class CodeBody(BaseModel):
    code: str = Field(min_length=6, max_length=12)


class Bridge:
    def __init__(self, ttl=TTL_SECONDS, clock=time.monotonic):
        self.ttl, self.clock = ttl, clock
        self.lock = threading.Lock()
        self.requests: dict[str, dict] = {}
        self.results: dict[tuple[str, str, str], dict] = {}
        # Results are also keyed by the request that produced them, so a poll
        # for request B can never be answered with request A's older result.
        self.results_by_request: dict[str, dict] = {}

    def prune(self):
        now = self.clock()
        self.requests = {k: v for k, v in self.requests.items() if v["expires"] > now}
        self.results = {k: v for k, v in self.results.items() if v["expires"] > now}
        self.results_by_request = {
            k: v for k, v in self.results_by_request.items() if v["expires"] > now
        }

    def create(self, body: CreateRequest) -> dict:
        if not CODE.match(body.code):
            raise HTTPException(422, "Pairing code must be 6-12 letters or digits.")
        with self.lock:
            self.prune()
            request_id = secrets.token_urlsafe(12)
            record = {
                "id": request_id,
                "project_id": body.project_id,
                "step_id": body.step_id,
                "code": body.code,
                "mode": body.mode,
                "status": "pending",
                "expires": self.clock() + self.ttl,
            }
            self.requests[request_id] = record
            return record

    def pending(self, project_id: str, code: str) -> list[dict]:
        with self.lock:
            self.prune()
            return [
                r for r in self.requests.values()
                if r["project_id"] == project_id and r["code"] == code and r["status"] == "pending"
            ]

    def claim(self, request_id: str, code: str) -> dict:
        with self.lock:
            self.prune()
            record = self.requests.get(request_id)
            if record is None or record["code"] != code:
                raise HTTPException(404, "Camera request unavailable.")
            if record["status"] != "pending":
                raise HTTPException(409, "Camera request already claimed.")
            record["status"] = "claimed"
            return record

    def complete(self, request_id: str, code: str, summary: BridgeSummary) -> dict:
        with self.lock:
            self.prune()
            record = self.requests.get(request_id)
            if record is None or record["code"] != code:
                raise HTTPException(404, "Camera request unavailable.")
            if record["status"] == "completed":
                raise HTTPException(409, "Camera request already has a result.")
            record["status"] = "completed"
            payload = {
                "request_id": record["id"],
                "summary": summary.model_dump(),
                "project_id": record["project_id"],
                "step_id": record["step_id"],
                "mode": record["mode"],
                "updated_at": time.time(),
                "expires": self.clock() + self.ttl,
            }
            self.results[(record["project_id"], record["step_id"], code)] = payload
            self.results_by_request[record["id"]] = {**payload, "code": code}
            return payload

    def latest(
        self, project_id: str, step_id: str, code: str, request_id: str | None = None
    ) -> dict | None:
        with self.lock:
            self.prune()
            if request_id is None:
                return self.results.get((project_id, step_id, code))
            payload = self.results_by_request.get(request_id)
            if payload is None or (
                payload["project_id"], payload["step_id"], payload["code"]
            ) != (project_id, step_id, code):
                return None
            return payload


def get_bridge(request: Request) -> Bridge:
    bridge = getattr(request.app.state, "ar_camera_bridge", None)
    if bridge is None:
        bridge = Bridge()
        request.app.state.ar_camera_bridge = bridge
    return bridge


@router.post("/requests", status_code=201)
def create_request(body: CreateRequest, request: Request):
    record = get_bridge(request).create(body)
    return {"id": record["id"], "status": record["status"], "mode": record["mode"]}


@router.get("/requests/pending")
def list_pending(project_id: str, code: str, request: Request):
    if not CODE.match(code):
        raise HTTPException(422, "Invalid pairing code.")
    return [
        {"id": r["id"], "step_id": r["step_id"], "mode": r["mode"]}
        for r in get_bridge(request).pending(project_id, code)
    ]


@router.post("/requests/{request_id}/claim")
def claim_request(request_id: str, body: CodeBody, request: Request):
    record = get_bridge(request).claim(request_id, body.code)
    return {"id": record["id"], "status": record["status"]}


@router.post("/requests/{request_id}/result")
def post_result(request_id: str, body: ResultPost, request: Request):
    payload = get_bridge(request).complete(request_id, body.code, body.summary)
    return {"status": "completed", "step_id": payload["step_id"]}


@router.get("/result")
def latest_result(
    project_id: str,
    step_id: str,
    code: str,
    request: Request,
    request_id: Annotated[str | None, Query(max_length=64)] = None,
):
    """Result for one capture request. With `request_id` (recommended) only the
    result of exactly that request is returned; without it, the latest result
    for project + step + pairing code (legacy behaviour)."""
    if not CODE.match(code):
        raise HTTPException(422, "Invalid pairing code.")
    payload = get_bridge(request).latest(project_id, step_id, code, request_id)
    if payload is None:
        return {"result": None}
    return {
        "result": {
            "request_id": payload["request_id"],
            "project_id": payload["project_id"],
            "step_id": payload["step_id"],
            "summary": payload["summary"],
            "mode": payload["mode"],
            "updated_at": payload["updated_at"],
        }
    }
