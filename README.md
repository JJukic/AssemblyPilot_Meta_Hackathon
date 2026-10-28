# AssemblyPilot

**Visual Assembly Intelligence** — a Meta AI Developer Hackathon project for a visual LEGO assembly assistant.

Phase 4 adds **human-guided correction and fresh-image verification** to the existing Muse Spark inspections, camera dashboard, custom block registry and assembly projects. Select a registered project and step, capture a frame, and choose **Inspect with Meta AI**. The backend combines the frame with relevant registered specifications and photographs, calls Meta, and validates the diagnosis before displaying it. Numbered boxes appear only on the exact normalized snapshot analyzed by Meta; uncertain results request a specific additional camera view. A temporary session history keeps the last ten completed inspections.

All inference goes exclusively to Meta Model API. No automatic uploads, continuous analysis, autonomous physical correction or local GPU models are implemented. Verification runs only after an explicit fresh camera capture. Camera capture, SQLite and registry features still work without an API key.

## Architecture

```text
frontend/    Next.js App Router, strict TypeScript, React, Tailwind, Lucide
backend/     FastAPI, SQLModel/SQLAlchemy, SQLite, Pillow, async httpx Meta-only inspection
data/        Shared configurable assembly JSON (data/assemblies/demo-lego.json)
docs/        Architecture, registry/inspection APIs and validation notes
.github/     Lint, build, Python tests and synthetic-camera browser tests
```

The browser keeps live video and JPEG snapshots in memory. It polls the backend health endpoint every 10 seconds; camera preview does not depend on backend availability. The frontend loads custom projects from SQLite through the API, with the shared demo definition as a fallback. Python validates uploaded images entirely independently of any model provider. See [architecture](docs/architecture.md).

## Prerequisites

- Node.js 22+ (Node 24 recommended; `.node-version`)
- Python 3.12+ (3.12 pinned for development)
- [uv](https://docs.astral.sh/uv/getting-started/installation/) for locked Python dependency installation
- A current Chrome, Edge, Firefox or Safari browser; a webcam for physical camera testing

## Install

From the repository root:

```sh
make install
# Optional local configuration (do not overwrite existing files):
cp -n backend/.env.example backend/.env
cp -n frontend/.env.example frontend/.env.local
```

`npm ci` uses `frontend/package-lock.json`; `uv sync --frozen` uses `backend/uv.lock`. No API key is needed to install, start or run automated tests. Live inspection requires a backend Meta API key. If your sandbox disallows the default cache directories, set `npm_config_cache` and `UV_CACHE_DIR` to writable paths.

## Run

Use two terminals from the repository root:

```sh
make dev-backend
make dev-frontend
```

Open `http://localhost:3000` on your development machine. Backend: `http://localhost:8000`; interactive API schema: `/docs`.

Production build locally: `make build`, then `cd frontend && npm run start` (keep the backend running separately). The dev/start scripts bind the frontend to all interfaces for development. This is not a hardened public deployment; keep it on a trusted local machine/network.

## Configuration

| Variable | Location | Default / purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `frontend/.env.local` | `http://localhost:8000`; browser-reachable backend origin |
| `FRONTEND_ORIGIN` | `backend/.env` | `http://localhost:3000`; exact CORS origin, no wildcard |
| `DATABASE_URL` | `backend/.env` | `sqlite:///./data/assemblypilot.db`; relative paths resolve from `backend/` |
| `UPLOAD_DIR` | `backend/.env` | `./data/uploads`; normalized JPEG references, relative to `backend/` |
| `MODEL_API_KEY` | `backend/.env` | Required only for live inspection; never put this in frontend configuration |
| `META_API_BASE_URL` | `backend/.env` | `https://api.meta.ai/v1`; only this HTTPS host and base path are allowed |
| `META_VISION_MODEL` | `backend/.env` | `muse-spark-1.3`; verified in official Meta documentation |
| `META_REQUEST_TIMEOUT` | `backend/.env` | 60 seconds for the entire network operation, including retries; maximum 180 |
| `INSPECTION_MAX_DIMENSION` | `backend/.env` | 1280 pixels for frames and reference copies sent to Meta |
| `META_MAX_REFERENCE_IMAGES` | `backend/.env` | 8 references plus the current snapshot |
| `META_MAX_REQUEST_BYTES` | `backend/.env` | 10 MiB total serialized JSON, including base64 |
| `MAX_UPLOAD_BYTES` | `backend/.env` | 8 MiB |
| `MAX_IMAGE_PIXELS` | `backend/.env` | 20 million decoded pixels |
| `MAX_IMAGE_DIMENSION` | `backend/.env` | 8192 pixels on either input edge |
| `MIN_IMAGE_DIMENSION` | `backend/.env` | 32 pixels on each input edge |
| `RESIZE_MAX_DIMENSION` | `backend/.env` | 1600 pixels on the output's longest edge; never upscale |

The backend resolves `.env`, relative SQLite paths and relative upload paths from `backend/`, independently of the shell working directory. Restart the backend after configuration changes. `NEXT_PUBLIC_*` values are public and embedded at frontend build time: restart development or rebuild production after changing them. For remote access, both origins must match the addresses your browser actually uses; a phone's `localhost` is the phone itself. Camera access outside localhost requires HTTPS.

## Test the camera

1. Open the dashboard on localhost or HTTPS. Click **Start camera** and allow permission.
2. After permission is granted, select an available camera. Continuity Camera is selectable only if macOS and your browser expose the iPhone as a video device; it is not guaranteed.
3. Confirm the live preview, click **Capture**, and check the JPEG snapshot and dimensions.
4. Click **Stop camera** and confirm your hardware's camera indicator turns off. Start it again.
5. Switch sources, deny permission, and disconnect/reconnect a camera to check recovery.
6. Stop the backend: the camera should remain usable while backend status becomes Disconnected (within the poll/timeout window).

Captures are not saved to disk or uploaded automatically. Refreshing the page clears them. The latest capture remains visible when the camera is stopped. Permission prompts may stay visible after Stop; a late successful permission response is discarded and its tracks stopped.

## Create blocks and assembly projects

1. Start both services and open **Block library** (`/blocks`). Choose **Add block**, enter its name, category, color, shape, optional dimensions and positive default quantity, then save.
2. In the saved block editor, choose **Take reference photo**, then **Start camera** and allow camera access. Select a camera, place the individual block in view, choose **Capture**, review the preview and choose **Save as reference**. You can capture again before saving or cancel without uploading. Alternatively, choose **Upload reference photo** for an existing JPEG, PNG or WebP. Photos are validated, oriented, resized and saved as metadata-free JPEGs. You can add multiple photos or delete an individual photo with confirmation. The first photo is marked **Used for inspection**; delete it to use the next photo. Arbitrary category names are supported.
3. Open **Projects** (`/projects`) and create a project. Open it, choose **Add step**, write the title/instruction, select registered blocks and enter each required quantity, then save. In **Edit step**, the **Reference photographs** section lets you upload, capture, select or delete that step's photos. Use **Take reference photo → Start camera → Capture → Save as reference** for a new capture. Choose **Use for inspection** on a photo to make it the active reference. The selection survives reloads and backend restarts; other photos remain stored. Closing the step editor also closes its camera.
4. Use the up/down buttons to reorder steps. Edit or delete steps as needed; positions stay contiguous. A block can be assigned once per step and reused by any number of projects.
5. Choose **Open in workspace**, or select the project in the dashboard's **Assembly project** selector. The ordered instructions, expected quantities and selected step photo appear alongside the camera controls. The same selected photo is sent as the assembled-step reference for inspection. Without an explicit selection, the oldest available photo is used. Deleting the selected photo falls back to the oldest remaining photo. Manual navigation never claims AI verification.

Saving a block or step and saving its photos are separate operations: if a photo fails to save, its camera preview remains available for retry. Capturing a camera frame does **not** save or upload it. Only **Save as reference** or an explicit file upload persists a reference image. Saving, canceling, leaving the page or switching the reference target releases the reference camera. The workspace camera captures a separate current view; **Inspect with Meta AI** sends it with the relevant saved reference photos through FastAPI.

## SQLite and image storage

The first backend startup creates missing tables in `backend/data/assemblypilot.db` and the `backend/data/uploads/` directory. Data survives restarts. Existing tables/data are never reset or seeded automatically. Initialization uses SQLModel `create_all`, not a migration framework; future schema changes require an explicit migration and backup plan.

The core tables are `building_blocks`, `assembly_projects`, `assembly_steps`, `assembly_step_blocks` and `reference_images`. The additive `step_reference_selections` table stores the chosen photo per step; it is created on startup without rebuilding existing tables or changing existing photos. SQLite foreign keys are enabled on every connection. Reference images have exactly one concrete foreign-key owner (`block_id` or `step_id`), not an unchecked polymorphic ID. API responses expose `/api/media/{id}` URLs, never storage paths.

Deletion policy:

- A block used by any step returns HTTP 409 and is retained with its photos.
- Deleting an unreferenced block removes only its own image records/files.
- Deleting a step removes its assignments/photos and renumbers remaining steps.
- Deleting a project removes its steps, assignments and step photos, **but never reusable blocks or block photos**.
- Individual reference photos can be deleted independently.

Related database mutations commit atomically. SQLite writers are serialized with `BEGIN IMMEDIATE`, and order updates use collision-free temporary positions inside the transaction. Uploaded files are removed if the transaction fails. Deletion removes files only after the database commit. Filesystem/database operations cannot be one atomic transaction: a process crash or filesystem cleanup failure may leave an unreachable orphan file; cleanup errors are logged. Do not delete files belonging to live records. Back up the database **and** upload directory with the backend stopped before moving/removing local data.

Default data paths, database files and uploads are ignored by Git. If configuring a different upload directory inside the checkout, add that path to `.gitignore` before using it. Do not commit personal reference photos or API credentials. This is an unauthenticated local MVP: keep the backend bound to loopback, and do not expose it publicly.

## Demo assembly and reference photos

Edit `data/assemblies/demo-lego.json` to configure the five-step example. Parts and colors are suggestions; no specific LEGO set is required. Navigation marks only the **current step**, never completion or AI verification.

Add your real reference photos under `frontend/public/references/` and set a step's `reference_image` to a path such as `/references/step-1.jpg`. Null or broken image paths show an explicit placeholder. No construction photos are fabricated. Restart/rebuild after changing assembly data in production.

## Configure and use Meta inspection

Create an API key in the [Meta Model API dashboard](https://dev.meta.ai/) (API keys → Create API key). In the existing `backend/.env`, set `MODEL_API_KEY` securely; do not paste it into source code, the frontend or logs. Keep the other defaults from `.env.example`:

```env
META_API_BASE_URL=https://api.meta.ai/v1
META_VISION_MODEL=muse-spark-1.3
META_REQUEST_TIMEOUT=60
```

Environment variables override `.env`. Restart the backend after changes. For cloud development, securely configure `MODEL_API_KEY` for this environment and allow `api.meta.ai` (inference) and `dev.meta.ai` (documentation); a saved setting may need propagation before the running backend receives it.

Register your blocks, project and steps as above. A block photo describes an individual component; upload a **correctly assembled step photograph** to describe the intended arrangement. Without that photograph, spatial judgments are deliberately conservative. Capture a frame and choose **Inspect with Meta AI**. Results show `correct`, `incorrect` or `uncertain`, visible components/counts, issues, explanation and next action. Confidence can be null and is never a calibrated probability. Changing the frame, project or step clears the current displayed result. Completed diagnoses remain in the session history with capture/inspection timestamps, exact analyzed snapshot and measured Meta request latency. History survives client-side page navigation and is cleared by refresh, closing the tab, or **Clear history**; nothing is written to browser storage or SQLite. An in-flight upstream request may still incur cost even if the browser discards its answer.

Each issue includes expected versus observed evidence and a suggested fix. Missing parts are never assigned a box; visible misplaced/wrong-color/wrong-orientation/unexpected parts can have a box only when localization is reliable. Boxes are not drawn on live video or the newest capture. When **Another view needed** appears, keep the build unchanged, follow the camera-angle instruction, capture a new frame and explicitly inspect again. There is no automatic camera movement or repeated inference.

The practice JSON demo has no registered SQLite context and does not offer AI inspection. Hidden connections, occluded parts, exact measurements and guaranteed physical correctness cannot be established from a single view. Do not treat a suggested fix as verified: capture a new frame after changing the build.

## API

```sh
curl --fail http://localhost:8000/health
curl --fail-with-body -F 'image=@/path/to/photo.jpg' \
  -F 'project_id=YOUR_PROJECT_ID' -F 'step_id=YOUR_STEP_ID' \
  http://localhost:8000/api/inspect
```

`GET /health` retains the Phase 1 contract (`status: ok`, `service: assemblypilot-backend`, `version: 0.1.0`). The API application metadata is version 0.3.1.

`POST /api/inspect` returns validated diagnostic JSON on success. Missing Meta configuration returns 503; provider failures never produce a diagnosis. For compatibility, image-only requests still validate the image and return 501 with dimensions and guidance to supply both IDs. Both IDs plus the image are required for actual inspection.

JPEG/PNG/WebP bytes are validated regardless of file extension, EXIF-oriented, proportionately resized and converted to metadata-free JPEG in memory. Corrupt/too-small images return 422; oversized images return 413; unsupported/animated formats return 415. Multipart parsing can spool before validation; public deployment would require authentication, request-body and rate limits. Keep this unauthenticated MVP on a trusted local machine.

See [inspection API and verified Meta protocol](docs/inspection-api.md) and [registry API](docs/registry-api.md) for schemas, errors and limits.

### Explicit live smoke test

This command sends a potentially billable request to Meta. Use a real photograph and actual IDs from your local registry; it is never run by CI:

```sh
cd backend
uv run --frozen python smoke_inspection.py \
  --project-id YOUR_PROJECT_ID --step-id YOUR_STEP_ID \
  --image /absolute/path/to/your-assembly-photo.jpg
```

It loads the backend environment, resolves the registered context and references, prints the validated diagnosis and duration, and exits 0 on success or nonzero on failure. Without a key it prints `SKIPPED` and exits 77. No sample result is substituted. See [validation results](docs/validation.md) for whether a live request was actually performed.

## Correct and verify an assembly step

After an incorrect diagnosis, read **Correction Required** and the suggested fix.
Physically adjust the assembly, choose **I've corrected it**, then **Capture & Verify**.
This captures a new live frame and asks Muse to independently assess the whole step
and every outstanding earlier finding. No success is inferred from the acknowledgement.

Results are **Step Verified**, **Correction Still Required**, or **Another View Needed**.
Only accepted verification persists `verified` progress in SQLite. Initial `correct`
diagnoses and manual navigation do not. **Continue to Next Step** requires a click and
appears only when a next step exists. Editing specifications or reference photographs
invalidates previous verification. Overlays always use the newly analyzed snapshot.

The planner reuses the diagnosis without another model call: one initial Muse operation
and one per explicit verification, each with the existing bounded transport retries.
Sessions retain metadata/findings for up to 30 minutes (64 records by default), without
camera bytes. They expire on backend restart; progress persists. Use one backend worker.

See [workflow architecture, API and real Four-Block Color Tower test](docs/verification.md).
The optional two-photo API replay is:

```sh
cd backend
uv run --frozen python smoke_verification.py --run-live \
  --project-id YOUR_PROJECT_ID --step-id YOUR_STEP_4_ID \
  --before /absolute/path/to/before.jpg --after /absolute/path/to/after.jpg
```

Use actual photographs and a running backend with the Meta key. This is potentially
billable and changes progress metadata; it never runs in CI. Without opt-in/inputs it
exits 77. Real Phase 4 verification in this cloud remains unverified despite the user's
confirmation that their local Muse integration works.

## Real-image benchmark

No user photographs or labelled test cases are bundled. See [the benchmark guide](docs/benchmark.md) to evaluate 1–10 real, labelled photographs against your registered project and reference images. The runner is opt-in, uses Meta only, records validated diagnoses and latency, and reports errors without inventing scores. It does not run in CI.

## Checks

```sh
make test          # Python tests + strict TypeScript check
make lint          # Ruff + ESLint (warnings fail)
make build         # Next.js production build
cd frontend && npx playwright install chromium
cd .. && make test-browser
```

Browser tests start a real FastAPI service with an isolated temporary SQLite database and upload directory. They refuse to reuse an existing backend on port 8000: stop your development backend before running them. `make test-browser` builds with the local test API URL. Browser inspection cases use test-only mocked responses to verify explicit uploads, loading, diagnosis display, errors, Active Vision, exact-snapshot box alignment on desktop/mobile, session history and stale-result clearing. The registry browser workflow tests block/project/step CRUD, photo upload, reordering, deletion conflicts, and custom-project camera capture. The original tests exercise dashboard rendering, five-step navigation, backend statuses, synthetic camera capture, source restart, track cleanup, permission denial, disconnection and mobile layout. They use Chromium's **synthetic** camera (the original Phase 1 cases mock health responses); they do not establish physical webcam or iPhone compatibility. If Chromium is already installed, use `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium make test-browser` instead of downloading a browser. On Linux, Playwright may need system libraries (`npx playwright install --with-deps chromium`). CI runs without Meta credentials.

The executed cloud validation results and remaining hardware limitations are recorded in [docs/validation.md](docs/validation.md).

## Current limitations and next steps

- Single-view diagnosis is fallible, especially with occlusion, similar colors/parts, poor lighting or no assembled-step reference. Boxes are optional and validated geometrically, not visually verified. Localization and verification quality need real-image evaluation.
- Model confidence is an uncalibrated estimate or null. A `correct` result is not a physical safety or connection guarantee.
- No autonomous correction loop, SAM adapter on main, image generation or smart-glasses integration. SAM remains a separate unmerged PR. Real assemblies still need evaluation of the new human-guided correction and verification workflow.
- Reference photos must be supplied by the user; navigation remains manual. The selected step photo (or oldest photo if no choice was saved) and first photo per assigned block are included, up to the configured reference cap; omitted counts are included in the prompt.
- Registry limitations remain: no pagination, multi-user conflict resolution, migrations or cloud sync. Full-field edits use last-write-wins semantics.
- Physical webcam/iPhone compatibility needs local hardware validation. Offline transport tests establish request/response handling, not model recognition quality or your account's live access.
