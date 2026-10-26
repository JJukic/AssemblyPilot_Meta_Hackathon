# AssemblyPilot

**Visual Assembly Intelligence** — a Meta AI Developer Hackathon project for a visual LEGO assembly assistant.

Phase 2 adds a persistent **custom building block registry and assembly project manager** to the Phase 1 camera dashboard. Register reusable blocks, upload real reference photographs, create projects with ordered steps, and select a project in the camera workspace. SQLite and local image storage require no external service.

**AI inspection is not implemented.** There are no inference calls, generated diagnoses, autonomous loops, Docker requirements, authentication, cloud synchronization or local GPU dependencies.

## Architecture

```text
frontend/    Next.js App Router, strict TypeScript, React, Tailwind, Lucide
backend/     FastAPI, SQLModel/SQLAlchemy, SQLite, Pillow; future Meta-only context
data/        Shared configurable assembly JSON (data/assemblies/demo-lego.json)
docs/        Architecture, registry API and validation notes
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

`npm ci` uses `frontend/package-lock.json`; `uv sync --frozen` uses `backend/uv.lock`. No API key is needed to install, start or test either phase. If your sandbox disallows the default cache directories, set `npm_config_cache` and `UV_CACHE_DIR` to writable paths.

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
| `MODEL_API_KEY` | `backend/.env` | Optional, unused in Phases 1–2; never put this in frontend configuration |
| `META_API_BASE_URL` | `backend/.env` | `https://api.meta.ai/v1`; reserved, unverified integration setting, not called |
| `META_VISION_MODEL` | `backend/.env` | Empty until verified against official Meta documentation |
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
2. In the saved block editor, choose **Upload reference photo**. JPEG, PNG and WebP files are validated, oriented, resized and saved as metadata-free JPEGs. You can upload multiple photos or delete an individual photo with confirmation. Arbitrary category names are supported.
3. Open **Projects** (`/projects`) and create a project. Open it, choose **Add step**, write the title/instruction, select registered blocks and enter each required quantity. Save, then upload a photograph of the correct step.
4. Use the up/down buttons to reorder steps. Edit or delete steps as needed; positions stay contiguous. A block can be assigned once per step and reused by any number of projects.
5. Choose **Open in workspace**, or select the project in the dashboard's **Assembly project** selector. The ordered instructions, expected quantities and first available step photo appear alongside the unchanged camera controls. Manual navigation never claims AI verification.

Saving a block or step and uploading its photos are separate operations: if a photo fails validation, the saved entity remains available for another upload. Capturing a camera frame does **not** save or upload it. Only the explicit reference-photo uploader persists images.

## SQLite and image storage

The first backend startup creates missing tables in `backend/data/assemblypilot.db` and the `backend/data/uploads/` directory. Data survives restarts. Existing tables/data are never reset or seeded automatically. Initialization uses SQLModel `create_all`, not a migration framework; future schema changes require an explicit migration and backup plan.

The five tables are `building_blocks`, `assembly_projects`, `assembly_steps`, `assembly_step_blocks` and `reference_images`. SQLite foreign keys are enabled on every connection. Reference images have exactly one concrete foreign-key owner (`block_id` or `step_id`), not an unchecked polymorphic ID. API responses expose `/api/media/{id}` URLs, never storage paths.

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

## API

```sh
curl --fail http://localhost:8000/health
curl -i -F 'image=@/path/to/photo.jpg' http://localhost:8000/api/inspect
```

`GET /health` returns HTTP 200 with `status: ok`, `service: assemblypilot-backend`, `version: 0.1.0`.

`POST /api/inspect` accepts multipart field **image**. The actual bytes, not the MIME type or extension, determine the format. Valid JPEG/PNG/WebP is decoded, EXIF-oriented, resized proportionately, flattened on white if transparent, and encoded as metadata-free JPEG. Images are not persisted. A valid image returns **HTTP 501** with `status: not_implemented`, an explanation and image dimensions. No fake inference result is returned.

Invalid/corrupt/too-small images return 422; size/dimension excess returns 413; unsupported/animated formats return 415. Missing multipart fields return 422. The upload is read with a byte limit, but multipart parsing can spool to a temporary file before validation; a public deployment must add a request-body limit at its reverse proxy as well as authentication/rate limits. AssemblyPilot is a local development tool.

Additional registry endpoints and request examples are documented in [docs/registry-api.md](docs/registry-api.md). The inspection context endpoint resolves only the selected step's block definitions, quantities and reference-image metadata. The typed Python service can also accept a transient normalized camera frame and optional previous context. It produces an intermediate schema, makes no model calls and never persists the frame.

## Checks

```sh
make test          # Python tests + strict TypeScript check
make lint          # Ruff + ESLint (warnings fail)
make build         # Next.js production build
cd frontend && npx playwright install chromium
cd .. && make test-browser
```

Browser tests start a real FastAPI service with an isolated temporary SQLite database and upload directory. They refuse to reuse an existing backend on port 8000: stop your development backend before running them. `make test-browser` builds with the local test API URL. The new browser workflow tests block/project/step CRUD, photo upload, reordering, deletion conflicts, and custom-project camera capture. The original tests exercise dashboard rendering, five-step navigation, backend statuses, synthetic camera capture, source restart, track cleanup, permission denial, disconnection and mobile layout. They use Chromium's **synthetic** camera (the original Phase 1 cases mock health responses); they do not establish physical webcam or iPhone compatibility. If Chromium is already installed, use `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium make test-browser` instead of downloading a browser. On Linux, Playwright may need system libraries (`npx playwright install --with-deps chromium`). CI runs without Meta credentials.

The executed cloud validation results and remaining hardware limitations are recorded in [docs/validation.md](docs/validation.md).

## Current limitations and next phase

- No AI diagnosis, correction, repair verification, SAM, image generation or smart-glasses integration.
- Reference photos must be supplied by the user. Assembly navigation remains manual.
- The registry is optimized for a small local collection: no pagination, multi-user editing/merge resolution, migrations or cloud sync. Concurrent writes preserve database integrity, but full-field edits use last-write-wins semantics.
- No physical-camera testing is possible in a headless cloud environment. Validate your MacBook/iPhone with the steps above.
- The proposed Meta endpoint and Muse Spark model identifier have **not been verified** against official documentation; the model ID is deliberately empty. No assumed SDK methods or payload formats exist in the code.
- For the next phase (Meta Vision integration), verify official Meta API access, exact model ID and vision support, authentication, image payload format, response schema, limits and data policy. Then implement `MetaClient` behind the existing typed interfaces with timeouts, bounded retries, schema validation, and explicit user-triggered uploads. Keep credentials exclusively in the backend.
- Verification must inspect a **new image after a human correction**, not reuse the original image as evidence of a repair.
