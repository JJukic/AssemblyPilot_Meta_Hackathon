# Real Meta integration validation — 2026-10-27

## Verdict

**Real image inspection is blocked; do not treat Phase 3B as live-validated yet.**
The stored key successfully authenticated a real model-metadata request, and all
Phase 3B automated checks passed. No real image inference request was sent, no
real diagnosis was received, and no real inference latency or localization
accuracy was measured. Test fixtures are not evidence of working inference.

## Versions and running environment

- User checkout: `main`, `d577684`, Phase 3A. Running API reports `0.3.0`.
- Phase 3B exists on `origin/feature/visual-ai-debugging`, commit
  `6fba3772a5b396f84b94655d0b5f5829184ffe80`; it is not on the checked-out main.
- Phase 3B was fetched and examined in a detached worktree at
  `/tmp/assemblypilot-validation-KHLwoF/phase3b`.
- No Phase 4 or application behavior changes were made. Existing development
  servers were not stopped or replaced. User data was inspected read-only.

## Configuration and credential checks

`backend/app/core/config.py` loads `BACKEND_ROOT / ".env"`, independently of the
working directory. Process environment variables take precedence. Settings are
cached and captured by `create_app`; restart the backend after changes.

Observed locally:

- `backend/.env` does not exist.
- `backend/.env.backend` exists and contains a nonempty `MODEL_API_KEY`.
- `.env.backend` is not loaded automatically by `Settings` or `make dev-backend`.
- Default `Settings()` has no usable key.
- Both the Uvicorn reloader and serving Python process lack `MODEL_API_KEY` in
  their process environment. This was checked again after their PIDs changed
  during validation; only boolean results were printed.
- Explicit `uv run --env-file .../backend/.env.backend` makes the key available
  to a new validation process. This does not update the existing FastAPI process.
- No key value, raw process environment, Authorization header, or secret file
  contents were printed or added to this report.

`GET /health` returns 200, but tests service availability, not Meta readiness.

## Actual endpoint and model access

Configured and independently checked against official Meta documentation:

- `POST https://api.meta.ai/v1/chat/completions`
- Model: `muse-spark-1.3`
- Bearer authentication; JPEG data URLs in `image_url` message content;
  `response_format.json_schema` with `strict: true`.

Sources checked on 2026-10-27:
[Quickstart](https://dev.meta.ai/docs/quickstart),
[Chat Completions](https://dev.meta.ai/docs/api-reference/chat-completions/create-chat-completion),
[Image understanding](https://dev.meta.ai/docs/image-understanding),
[Structured output](https://dev.meta.ai/docs/structured-output),
[Retrieve a model](https://dev.meta.ai/docs/api-reference/models/retrieve-model).

One real authenticated read-only request was made using the explicitly loaded key:

| Request | Result | Elapsed client time |
| --- | --- | --- |
| `GET https://api.meta.ai/v1/models/muse-spark-1.3` | HTTP 200; returned ID matches `muse-spark-1.3` | 817.94 ms |

This establishes authentication for model metadata and model visibility. It does
not establish completion permissions, billing readiness, image/schema acceptance
or successful inference. **817.94 ms is not model inference latency.** No API error
was observed on this request. Raw response bodies were not logged.

## Smoke-test blockers

The existing `smoke_inspection.py` was run with normal configuration in main and
Phase 3B. Both returned exit **77**:

```text
SKIPPED: MODEL_API_KEY is not configured in the backend. No Meta request sent.
```

The user's configured SQLite database and running registry API are empty:
0 projects, 0 steps, 0 blocks, 0 reference-image records. No usable photograph
was found in the repository outside generated test/dependency/build artifacts.
No real camera photograph was supplied for the smoke test. Even with explicit
key loading, real project/step IDs and photograph inputs are still required.

Real `POST /api/inspect`, model output validation, model error behavior and
frontend rendering of a real diagnosis therefore remain unverified.

## Image payload, schema and UI review

Verified in Phase 3B source and automated tests:

- `inspectSnapshot` sends the selected captured JPEG plus `project_id` and
  `step_id` only after explicit inspection. Capturing alone sends no request.
- `build_multimodal_request` places `current_snapshot` first, then the first
  assembled-step reference and the first reference per assigned block, up to
  eight references by default. Other photos are deliberately omitted and the
  omitted count is included in task data. Ownership and safe file access are checked.
- Images are EXIF-oriented, proportionally resized to at most 1280 pixels,
  normalized to JPEG, and sent as actual base64 image bytes. Reference URLs are
  not relied on for provider access. Image roles, block IDs and dimensions are
  represented in the manifest.
- `InspectionResult.model_validate_json` rejects invalid types/fields,
  inconsistent status, invalid boxes, wrong step IDs and unknown block IDs.
  Phase 3B requires `expected`/`observed`, null boxes for missing parts, and
  Active Vision for uncertain results. These cross-field rules are enforced
  locally even if a response conforms to the provider JSON schema.
- `inspect_with_metadata` returns the exact normalized snapshot sent to Meta.
  The backend, not the model, supplies snapshot bytes, timestamp, configured model
  name and elapsed client request time (`model_latency_ms`, including retries).
  The model name is configuration provenance, not an independently checked
  provider-returned model identity.
- `DiagnosticOverlay` draws normalized boxes on `analyzed_snapshot`, verifies
  natural image dimensions, and hides boxes on mismatches. It never places boxes
  on a subsequently captured frame or on live video.
- Browser tests verify desktop/mobile alignment, diagnosis fields, explicit
  submission, Active Vision, stale-result cancellation, history limits and
  clearing. The mobile screenshot was visually inspected; it contains synthetic
  test content, not a real Meta diagnosis.

The existing smoke script calls `MetaClient.inspect` directly and prints a
validated `InspectionResult` plus total duration. It does not exercise the
running FastAPI route, `InspectionResponse` metadata or frontend. Those need the
separate HTTP and browser checks below.

## Automated checks actually executed

| Target | Check | Result |
| --- | --- | --- |
| Main `d577684` | Ruff, ESLint, pytest, TypeScript | Passed; 143 Python tests |
| Phase 3B `6fba377` | `make lint` | Passed |
| Phase 3B `6fba377` | `make test` | Passed; 161 Python tests and TypeScript |
| Phase 3B `6fba377` | Production build | Passed |
| Phase 3B `6fba377` | Entire Playwright suite | 19 passed, 10.6 s |

Phase 3B browser checks used isolated temporary SQLite/uploads and ports 18000
and 13000. Only test-server port/origin configuration and hard-coded registry
test URLs were adapted in the detached worktree. The frontend was built with
`NEXT_PUBLIC_API_URL=http://localhost:18000`. No assertions were removed.
The developer's ports 8000/3000 and database were not reused by these tests.

The Starlette/httpx TestClient deprecation and browser NO_COLOR messages remain
non-failing warnings. Inference tests use HTTP mocks, and browser inspection
tests use synthetic answers; neither proves real inference. Physical camera
and recognition/localization quality were not tested.

## Local validation commands

Run from the normal repository, after stopping your two development servers
with Ctrl+C. Select the Phase 3B branch first (it was not checked out during this
audit):

```sh
git fetch origin feature/visual-ai-debugging
git switch --track origin/feature/visual-ai-debugging
make install
```

If that local branch already exists, use `git switch feature/visual-ai-debugging`.
Then make the existing configuration available under the filename the app loads.
The non-overwriting copy below is appropriate to the observed missing `.env`:

```sh
cp -n backend/.env.backend backend/.env
cd backend
uv run --frozen python -c 'from app.core.config import Settings; s=Settings(); print("MODEL_API_KEY available:", bool(s.model_api_key and s.model_api_key.get_secret_value().strip()))'
cd ..
make dev-backend
```

Start `make dev-frontend` in a second terminal. Alternatively, keep the filename
`.env.backend` and start the backend explicitly from `backend/` with:

```sh
uv run --frozen --env-file .env.backend uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

In `/blocks`, register the real pieces and upload their photographs. In
`/projects`, create a project and step, assign pieces/quantities, and upload a
correct assembled-step reference. Capture a separate current assembly photo;
do not use the reference itself as evidence of the current build. Save the
current JPEG locally for the CLI smoke test. Obtain actual IDs from:

```sh
curl --fail-with-body http://localhost:8000/api/projects
curl --fail-with-body http://localhost:8000/api/projects/PROJECT_ID
curl --fail-with-body http://localhost:8000/api/projects/PROJECT_ID/steps/STEP_ID/context
```

Replace the uppercase ID placeholders and image path below. From `backend/`,
the existing real smoke command (potentially billable) is:

```sh
uv run --frozen --env-file .env.backend python smoke_inspection.py \
  --project-id PROJECT_ID \
  --step-id STEP_ID \
  --image /absolute/path/current-assembly.jpg
```

Success means exit 0 with a validated diagnosis; exit 77 means no key was loaded;
exit 1 means an inspection/input error. `Duration` covers preparation and the
client request, not pure model compute time.

Then test the **running** FastAPI process. From the repository root:

```sh
curl --fail-with-body --max-time 190 \
  -o backend/data/live-inspection.json \
  -w '\nHTTP %{http_code}; end-to-end seconds %{time_total}\n' \
  -F 'project_id=PROJECT_ID' \
  -F 'step_id=STEP_ID' \
  -F 'image=@/absolute/path/current-assembly.jpg' \
  http://localhost:8000/api/inspect
```

The saved response includes the private analyzed photo and belongs only in
ignored local storage. After HTTP 200, independently validate the response:

```sh
cd backend
uv run --frozen python - <<'PY'
from pathlib import Path
from app.models.diagnosis import InspectionResponse
r = InspectionResponse.model_validate_json(Path('data/live-inspection.json').read_text())
print('Validated:', r.status, 'model:', r.model)
print('Meta client request latency (ms, includes retries):', r.model_latency_ms)
print('Analyzed image dimensions:', r.analyzed_snapshot.width, r.analyzed_snapshot.height)
print('Issues:', len(r.issues), 'located:', sum(i.bounding_box is not None for i in r.issues))
PY
```

Finally use the Phase 3B workspace: select the project/step, capture the real build,
click **Inspect with Meta AI**, and verify the Network response is the real
`POST /api/inspect` HTTP 200. Check expected/observed text, the returned analyzed
snapshot, and any numbered boxes against visibly present components. A legitimate
response can have no boxes. An uncertain result must request another view; take
a fresh capture and explicitly inspect again. Changing step/capture must clear
the current result, while the prior snapshot remains only in session history.

Record actual `model_latency_ms`, curl total time, status, error code and any
`Retry-After` separately for real requests. Until that run completes, actual
inference latency, real Pydantic response acceptance and real overlay quality
remain **not measured / not verified**.
