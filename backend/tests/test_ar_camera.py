"""External-camera bridge: pairing-scoped requests and validated summaries only."""

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


@pytest.fixture()
def client(tmp_path):
    settings = Settings(
        _env_file=None, model_api_key=None,
        database_url=f"sqlite:///{tmp_path}/bridge.db",
        upload_dir=str(tmp_path / "u"), calibration_dir=str(tmp_path / "c"),
        frontend_origin="http://localhost:3000",
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


SUMMARY = {
    "kind": "inspection", "state": "correction_required", "status": "correct",
    "explanation": "Printed side is wrong.", "issues": [], "correctionPlan": [],
    "nextAction": "Fix the print.", "errorMessage": None, "verificationStatus": None,
    "specificationId": "spec", "inspectionId": "insp", "snapshotId": "snap",
    "overall": {"kind": "incorrect", "printGate": "fail", "expectedPrint": "Involve Me",
                "observedPrint": "insights", "printAction": "Present the required side.",
                "faceStatus": None, "geometryStatus": None},
}


def test_bridge_request_claim_result_flow(client):
    created = client.post("/api/ar-camera/requests", json={
        "project_id": "p1", "step_id": "s1", "code": "482916", "mode": "inspect"})
    assert created.status_code == 201, created.text
    request_id = created.json()["id"]
    # Wrong pairing code sees nothing.
    assert client.get("/api/ar-camera/requests/pending",
                      params={"project_id": "p1", "code": "000000"}).json() == []
    pending = client.get("/api/ar-camera/requests/pending",
                         params={"project_id": "p1", "code": "482916"}).json()
    assert [r["id"] for r in pending] == [request_id]
    assert client.post(f"/api/ar-camera/requests/{request_id}/claim",
                       json={"code": "482916"}).status_code == 200
    # A second claim is rejected: exactly one companion captures.
    assert client.post(f"/api/ar-camera/requests/{request_id}/claim",
                       json={"code": "482916"}).status_code == 409
    posted = client.post(f"/api/ar-camera/requests/{request_id}/result",
                         json={"code": "482916", "summary": SUMMARY})
    assert posted.status_code == 200, posted.text
    latest = client.get("/api/ar-camera/result",
                        params={"project_id": "p1", "step_id": "s1", "code": "482916"}).json()
    assert latest["result"]["summary"]["overall"]["kind"] == "incorrect"
    assert latest["result"]["summary"]["overall"]["observedPrint"] == "insights"
    # Cross-project / wrong code cannot read the result.
    other = client.get(
        "/api/ar-camera/result",
        params={"project_id": "p2", "step_id": "s1", "code": "482916"},
    )
    assert other.json() == {"result": None}


def test_bridge_rejects_bad_codes_and_frame_payloads(client):
    assert client.post("/api/ar-camera/requests", json={
        "project_id": "p1", "step_id": "s1", "code": "x", "mode": "inspect"}).status_code == 422
    created = client.post("/api/ar-camera/requests", json={
        "project_id": "p1", "step_id": "s1", "code": "482916", "mode": "verify"})
    request_id = created.json()["id"]
    # Summaries carry no frame/data-url fields; unknown summary fields are
    # ignored by the model, but invalid gate values are rejected.
    bad = dict(SUMMARY, overall={**SUMMARY["overall"], "kind": "verified-ish"})
    assert client.post(f"/api/ar-camera/requests/{request_id}/result",
                       json={"code": "482916", "summary": bad}).status_code == 422
    assert client.post(f"/api/ar-camera/requests/{request_id}/result",
                       json={"code": "111111", "summary": SUMMARY}).status_code == 404
