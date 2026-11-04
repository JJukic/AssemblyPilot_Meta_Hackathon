# AssemblyPilot

**Visual Assembly Intelligence** — a Meta AI Developer Hackathon project: an assistant
that guides a person through a LEGO-style assembly, step by step, and checks each step
from a camera image using Meta-hosted models. It runs in a desktop or mobile browser and
as a WebXR experience on HoloLens 2.

- **Muse Spark** (`muse-spark-1.3`) decides whether a step is `correct`, `incorrect` or
  `uncertain`.
- **SAM 3.1** (`sam-3.1`) is an optional add-on that localizes visible objects with masks,
  boxes and outlines. It never overrides Muse.
- **OpenCV** (local, no AI) provides optional measured gates for geometry and printed faces.

The full design, data flow and rationale are in the
[Technical Report](docs/technical-report.md).

## Goal and hackathon context

Physical assembly errors are often found late, and a written manual cannot see what is
on the table. AssemblyPilot's goal is a closed loop: show the intended step, look at the
real build, explain what is wrong, and only accept a step after a separate fresh image
confirms it. The project was built for the Meta AI Developer Hackathon, so all inference
goes exclusively to the Meta Model API. There is no fallback provider and there are no
local model weights for inspection.

## Feature scope

Status terms used here and in the Technical Report:

| Term | Meaning |
| --- | --- |
| **Implemented** | In the code on `main`, on by default or available without extra setup |
| **Optional** | Implemented and configurable; the app works without it |
| **Not implemented** | Deliberately absent from the code |
| **Planned** | Not done yet, intended later |

| Area | Status | Notes |
| --- | --- | --- |
| Block library, projects, ordered steps, reference photos | Implemented | SQLite and local files; no API key needed |
| Setup wizard (`/setup`) | Implemented | Meta plan generation is an explicit, optional click; manual setup needs no key |
| Browser camera capture | Implemented | `getUserMedia`; localhost or HTTPS only |
| Muse Spark inspection and fresh-image verification | Implemented | Requires `MODEL_API_KEY` |
| Correction plan and Active Vision guidance | Implemented | Built deterministically from the validated diagnosis |
| Spatial AR (`/ar?project=<id>`) with WebXR, guided panel and hologram | Implemented | Falls back to a labelled 2D preview on unsupported devices |
| Guided buttons: Check Step, Check Again, Confirm Position, Next Step, Finish, Restart Assembly | Implemented | See [Assembly workflow](#assembly-workflow) |
| Completion hologram (Meta mascot) after Finish | Implemented | Loaded only by Finish; failures never affect the workflow |
| SAM 3.1 localization | Optional | `SAM_ENABLED`, on by default; only runs for `incorrect` diagnoses |
| Explicit object search with SAM (`POST /api/vision/objects`) | Optional | User-triggered, independent of the verdict |
| ChArUco calibration, stud geometry, printed-face and print rules | Optional | Only active for steps that configure them |
| Contour overlays, Canny edge debug | Optional | Visual aids; no verdict impact |
| Autonomous Assembly | Optional | Explicit Start; local change detection, budgeted Meta requests |
| External camera companion (`/api/ar-camera`) | Optional | Second browser supplies the frame for HoloLens |
| Local voice commands (Whisper on the Mac) | Optional | Needs a local Whisper engine; audio never goes to Meta |
| Authentication, public deployment, rate limits on inspection | Not implemented | Trusted local network only |
| Local GPU models, non-Meta inference providers | Not implemented | |
| Autonomous physical correction, 3D metrology, native HoloLens app | Not implemented | A Unity/OpenXR path is only described in [docs/hololens.md](docs/hololens.md) |
| Final HoloLens demo recording, local browser demo recording | Planned | See [Demo-Videos – folgt später](#demo-videos--folgt-später) |
| Real-photo accuracy benchmark, completed HoloLens acceptance checklists | Planned | Tooling exists; results do not |

## Repository layout

```text
backend/    FastAPI app (app/main.py), SQLModel/SQLite, Pillow, OpenCV, httpx, Meta clients, tests
frontend/   Next.js App Router, React, TypeScript, Tailwind, three.js/WebXR, unit + Playwright tests
data/       Shared practice assembly (data/assemblies/demo-lego.json)
deploy/     Caddyfile.hololens: private-LAN HTTPS proxy template
docs/       Technical report, API contracts, HoloLens guide, validation records
.github/    CI workflow
Makefile    install, dev-backend, dev-frontend, test, lint, build, test-browser
```

Entry points: `backend/app/main.py` (`app.main:app`) and
`frontend/src/app/(workspace)/page.tsx` (route `/`). Other routes: `/setup`, `/blocks`,
`/projects`, `/projects/[projectId]`, `/ar`, `/settings`.

## Prerequisites

- Node.js 22+ (`package.json` engines; `.node-version` pins 24)
- Python 3.12+ (`backend/.python-version` pins 3.12)
- [uv](https://docs.astral.sh/uv/getting-started/installation/)
- A current Chrome, Edge, Firefox or Safari; a webcam for real camera testing
- For live inspection: a Meta Model API key from the
  [Meta Model API dashboard](https://dev.meta.ai/)
- For HoloLens: Caddy on the serving machine and HoloLens 2 on the same trusted LAN

## Installation and setup

```sh
make install
# Optional local configuration; -n never overwrites existing files:
cp -n backend/.env.example backend/.env
cp -n frontend/.env.example frontend/.env.local
```

No API key is needed to install, start or run the automated tests. Live inspection needs
`MODEL_API_KEY` in `backend/.env`. Never put it in frontend configuration, source code or
a command argument.

### Dependency sources

| Part | Manifest | Lock file | Install |
| --- | --- | --- | --- |
| Backend | `backend/pyproject.toml` | `backend/uv.lock` | `uv sync --frozen` |
| Frontend | `frontend/package.json` | `frontend/package-lock.json` | `npm ci` |

`pyproject.toml` with `uv.lock` is the primary and only Python dependency source. The
project deliberately has no `requirements.txt`: nothing references one, and a second list
could contradict the lock file. All `make` targets and CI use `uv sync --frozen` or
`uv run --frozen`.

## Environment variables

`backend/.env` is resolved from `backend/` regardless of the shell directory. Process
environment variables override it, and other file names such as `.env.backend` are not
loaded automatically. Restart the backend after changes. `NEXT_PUBLIC_*` values are public
and baked in at build time.

**Frontend** (`frontend/.env.local`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Backend origin as seen by the browser; empty string means same origin (HoloLens build) |

**Backend: Meta Model API** (`backend/.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `MODEL_API_KEY` | unset | The one Meta key, used for both Muse and SAM. There is no separate SAM key |
| `META_API_BASE_URL` | `https://api.meta.ai/v1` | Only this HTTPS host and path are accepted |
| `META_VISION_MODEL` | `muse-spark-1.3` | Muse model ID |
| `META_REQUEST_TIMEOUT` | `60` | Seconds for the whole Muse operation including retries; max 180 |
| `META_MAX_REFERENCE_IMAGES` | `8` | Reference photos per request, plus the current snapshot; 0–20 |
| `META_MAX_REQUEST_BYTES` | `10485760` | Serialized request limit including base64 |
| `INSPECTION_MAX_DIMENSION` | `1280` | Longest image edge sent to Meta; 256–1600 |

**Backend: SAM 3.1** (optional)

| Variable | Default | Purpose |
| --- | --- | --- |
| `SAM_ENABLED` | `true` | `false` keeps Muse-only inspection |
| `META_SAM_MODEL` | `sam-3.1` | Fixed: any other value fails settings validation |
| `SAM_REQUEST_TIMEOUT` | `60` | Seconds per SAM operation including retries and decoding; max 60 |
| `SAM_MAX_CONCEPTS_PER_INSPECTION` | `2` | SAM operations per inspection; 0–2 |

**Backend: application**

| Variable | Default | Purpose |
| --- | --- | --- |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | Exact CORS origin; `*` is rejected |
| `DATABASE_URL` | `sqlite:///./data/assemblypilot.db` | Relative to `backend/` |
| `UPLOAD_DIR` | `./data/uploads` | Reference photos, relative to `backend/` |
| `CALIBRATION_DIR` | `./data/calibrations` | Versioned calibration JSON, relative to `backend/` |
| `MAX_UPLOAD_BYTES` | `8388608` | Upload limit |
| `MAX_IMAGE_PIXELS` | `20000000` | Decoded pixel limit |
| `MAX_IMAGE_DIMENSION` | `8192` | Maximum input edge |
| `MIN_IMAGE_DIMENSION` | `32` | Minimum input edge |
| `RESIZE_MAX_DIMENSION` | `1600` | Longest stored reference edge; never upscales |
| `INSPECTION_SESSION_CAPACITY` | `64` | In-memory inspection sessions; 1–256 |
| `INSPECTION_SESSION_TTL_SECONDS` | `1800` | Session lifetime; 60–7200 |
| `FACE_CANNY_SIGMA` | `0.33` | Adaptive Canny spread for printed faces; 0.1–0.6 |

**Backend: local voice** (optional)

| Variable | Default | Purpose |
| --- | --- | --- |
| `VOICE_WHISPER_COMMAND` | empty | Empty auto-detects `whisper-cli`, `main`, then `whisper` |
| `VOICE_WHISPER_MODEL` | `tiny` | Model name for the `whisper` CLI |
| `VOICE_WHISPER_MODEL_PATH` | empty | Model file for whisper.cpp |
| `VOICE_MAX_AUDIO_BYTES` | `1000000` | Clip size limit |
| `VOICE_MAX_DURATION_SECONDS` | `8` | Clip duration limit |
| `VOICE_SESSION_TTL_SECONDS` | `600` | Voice session lifetime |
| `VOICE_RATE_LIMIT_PER_MINUTE` | `30` | Per-session limit |
| `VOICE_MAX_SESSIONS` | `256` | Concurrent sessions |
| `VOICE_TRANSCRIBE_TIMEOUT_SECONDS` | `60` | Transcription deadline |

## Start the backend

```sh
make dev-backend
```

This runs `uv run --frozen uvicorn app.main:app --reload --host 127.0.0.1 --port 8000` in
`backend/`. Health check: `curl --fail http://localhost:8000/health`. Interactive API
schema: `http://localhost:8000/docs`.

The first start creates missing tables in `backend/data/assemblypilot.db` and the upload
directory. Existing data is never reset or seeded. Use a single backend worker:
inspection sessions, voice sessions and the camera bridge live in process memory.

## Start the frontend

```sh
make dev-frontend
```

Open `http://localhost:3000`. Production build: `make build`, then
`cd frontend && npm run start`. Both `npm run dev` and `npm run start` bind to `0.0.0.0`,
so use them only on a trusted machine or network. The dashboard's backend status comes from
a health poll every 10 seconds; the camera works even when the backend is down.

## Local browser demo

1. Start backend and frontend, with `MODEL_API_KEY` set in `backend/.env`.
2. Create content in one of these ways:
   - Open `/setup` and follow the five-step wizard
     ([guide and acceptance checklist](docs/jury-setup.md)).
   - Or use `/blocks` and `/projects`.
   - Or run the two-step demo project, which prints JSON with the project ID and AR path:
     `cd backend && uv run --frozen python scripts/create_ar_demo.py`
3. Add a photo of the correctly assembled step. Without one, spatial judgments are
   deliberately conservative.
4. **Workspace flow** at `/`: select the project and step, **Start camera**, **Capture**,
   **Inspect with Meta AI**. After `incorrect`, correct the build, choose **I've corrected
   it**, then **Capture & Verify**.
5. **Guided flow** at `/ar?project=<id>`: without an XR session the page shows the same
   guided card and panel actions as HoloLens, using the local browser camera.

The five-step practice assembly from `data/assemblies/demo-lego.json` has no registered
SQLite context and therefore offers no AI inspection. Calibration and edge debugging are
under **Settings** (`/settings`).

Captures stay in browser memory until you explicitly inspect them or save them as
reference photos.

## Assembly workflow

A step's verdict starts with Muse Spark. Optional OpenCV and print gates can only make it
stricter, never better. Only the backend can record a step as `verified`.

| Result | What the user sees | Buttons | What happens next |
| --- | --- | --- | --- |
| `correct` (first image) | "Check Step" continues automatically | none while running | About 2 seconds later a **separate, fresh** frame goes to `POST /api/verify` |
| Verified by backend | "Correct" | Next Step, or Finish on the last step | Progress is stored in SQLite |
| `correct`, verification still missing | "Almost correct" | Check Again | Check Again starts a new inspection and verification |
| `incorrect` | "Try again" with the issue and suggested fix | Check Again | Adjust the build; Check Again uses a fresh image |
| `uncertain` | "Position uncertain" with the requested view | Check Again, Confirm Position | **Nothing is sent** until the user selects Check Again |
| Check could not run | "Check unavailable" | Check Again, Confirm Position | An infrastructure failure is never shown as a verdict |

- **Check Again** captures exactly one new frame and starts one new inspection. Old images
  are never reused: the backend rejects a repeated snapshot during verification.
- **Confirm Position** is a local, user-confirmed fallback. It is labelled "not AI
  verified", writes nothing to the backend and cannot enable Finish.
- **Finish** appears only on the last step after backend verification. It re-reads server
  progress, then shows "Assembly complete" and the completion hologram. It starts no
  camera and no Meta request.
- **Restart Assembly** appears after Finish. It creates a new server run
  (`POST /api/projects/{id}/assembly-runs`), which makes all steps unverified and returns
  to Step 1. Nothing is deleted, and no camera or Meta action starts.

## HoloLens 2 test on the local network

**Check this first:** WebXR and the camera require a secure context, so HoloLens needs
HTTPS. The API has no authentication, so keep both servers on loopback and expose only
the TLS proxy, restricted by firewall to trusted devices. Do not use public tunnels or
port forwarding, and do not expose port 8000.

### Caddy HTTPS configuration

The template is `deploy/Caddyfile.hololens`. It binds to a private IP, uses Caddy's
internal CA (`tls internal`), sets `Permissions-Policy` for XR and camera, forwards
`/api/*` and `/health` to `127.0.0.1:8000` and everything else to `127.0.0.1:3000`.

1. In a copy of the file (or the file itself, without committing it), replace **both**
   `192.168.1.50` occurrences with the serving machine's private LAN IP.
2. Build the frontend with an **empty** API base, so requests use the same HTTPS origin,
   and start it on loopback:

   ```sh
   cd frontend
   NEXT_PUBLIC_API_URL='' npm run build
   npx next start --hostname 127.0.0.1 --port 3000
   ```

3. Start the backend in a second terminal:

   ```sh
   cd backend
   uv run --frozen uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```

4. Start Caddy in a third terminal, with the OS privileges needed to bind port 443:

   ```sh
   caddy run --config deploy/Caddyfile.hololens --adapter caddyfile
   ```

5. Install **only the public** root certificate on each client:
   `pki/authorities/local/root.crt` in Caddy's data directory. Never distribute its
   private key. On HoloLens follow
   [Microsoft's certificate manager guide](https://learn.microsoft.com/en-us/hololens/certificate-manager).
   Do not bypass certificate warnings.

### On the headset

1. Open `https://<your-private-ip>/ar?project=<project-id>` in HoloLens Edge.
2. Select **Enter immersive AR**, rotate the assembly field to match the baseplate and
   select **Confirm Assembly Field**.
3. Place the brick and select **Check Step** with a hand ray and Air Tap.
4. The default camera source is the HoloLens camera, probed while XR stays active. If no
   advancing frames arrive, the panel shows a pairing code. Open the same project page on
   a Mac or iPhone, enter the code and select **Act as external camera companion**. That
   device captures and inspects, and only a validated text summary returns to HoloLens.

Use the same HTTPS URL on all devices so they share state. Details, coordinate
conventions, voice setup and manual checklists are in [docs/hololens.md](docs/hololens.md).

## Tests

```sh
make lint          # Ruff + ESLint (warnings fail)
make test          # pytest, strict TypeScript check, frontend unit tests
make build         # Next.js production build
cd frontend && npx playwright install chromium   # first run only
cd .. && make test-browser                       # Next.js build + Playwright
```

There is no Markdown lint or documentation check in this repository.

- CI (`.github/workflows/ci.yml`) runs on every push and pull request with no Meta
  credentials: Ruff and pytest in the backend job; ESLint, type check, unit tests, build
  and Playwright in the frontend job.
- Playwright starts a disposable API with a temporary database, and refuses to reuse a
  server on port 8000. Stop your development backend first. `make test-browser` overwrites
  `frontend/.next`, so rebuild afterwards if you need the HoloLens build.
- Browser tests use a **synthetic** Chromium camera and mocked Meta results. Tests mock XR
  poses and GPU rendering. They do not prove physical camera, HoloLens or recognition
  quality.

Live checks are opt-in, potentially billable and never run in CI. Without credentials or
opt-in they exit 77:

```sh
cd backend
uv run --frozen python smoke_inspection.py --project-id ID --step-id ID --image /abs/photo.jpg
uv run --frozen python smoke_segmentation.py --image /abs/photo.jpg --output data/sam-smoke/annotated.png
uv run --frozen python smoke_verification.py --run-live --project-id ID --step-id ID --before /abs/a.jpg --after /abs/b.jpg
```

For a labelled real-image evaluation, see [docs/benchmark.md](docs/benchmark.md).

## Current development status

- All listed features are merged on `main`. The latest merged work is the completion
  hologram and header branding (PRs #12 and #13).
- Automated results and manual records are kept in
  [docs/validation.md](docs/validation.md) and the
  [Technical Report](docs/technical-report.md#test-strategy).
- `docs/hololens.md` records owner observations on a real HoloLens 2: immersive WebXR
  works, the microphone is reachable, browser speech recognition is not usable, and a
  live camera image works in the 2D workspace. The manual acceptance checklists there,
  including simultaneous camera and WebXR use, are still open.
- The repository contains no recorded real-photo benchmark. The owner reports working
  live Muse inference locally. The live SAM path and the correction loop have no recorded
  real-image result in the repository.

## Demo-Videos – folgt später

> **TODO — no demo videos exist yet.** This section is a placeholder. It contains no video
> links, file names or results on purpose.

- [ ] TODO: Record the final HoloLens demo live with Mixed Reality Capture, then add it here.
- [ ] TODO: Record the local browser demo with the Mac's screen recording, then add it here.
- [ ] TODO: Note the date and commit each video shows.

## Known limitations

- **Security:** no authentication and no inspection rate limits. Use only on a trusted
  machine or private network.
- **Visual judgment is fallible:** a single view cannot prove hidden connections, exact
  measurements or stability. Confidence is an uncalibrated model estimate or null.
- **Assembled-step photo:** without one, spatial results stay conservative.
- **SAM coverage:** the automatic pass runs only for `incorrect` diagnoses, for at most two
  operations. No mask does not mean the build is correct.
- **`MODEL_API_KEY`:** one key serves Muse and SAM, so without it no inspection runs at all.
- **HoloLens:** behavior depends on the installed Edge build. Anchors last for one session,
  so the field must be confirmed again after re-entering AR. Simultaneous camera and WebXR
  use is a device result, not a guarantee, and the companion path exists for this reason.
- **Navigation is not verification:** moving between steps verifies nothing, and Finish
  checks only the last step on the server. It reports how many steps were verified.
- **Confirm Position on the last step** cannot complete the assembly; Finish requires
  backend verification.
- **Single process:** sessions and the camera bridge expire on backend restart. Progress in
  SQLite remains.
- **Persistence:** SQLModel `create_all` only, with no migration framework. Back up the
  database and upload directory together with the backend stopped.
- **Registry:** no pagination, cloud sync or multi-user conflict handling; edits are
  last-write-wins.

## Data and privacy

Keep personal photos, `.env` files and API keys out of Git; default data paths are ignored.
Images are sent to Meta only on an explicit inspection, or by Autonomous Assembly after you
start it. API responses expose `/api/media/{id}` URLs, never file paths. Deleting a project
keeps reusable blocks and their photos; deleting a block that a step uses returns 409.

## Documentation

| Document | Content |
| --- | --- |
| [Technical Report](docs/technical-report.md) | Architecture, data flow, decisions, security, testing, limits |
| [HoloLens guide](docs/hololens.md) | XR setup, coordinates, voice, autonomy, device checklists |
| [Jury setup](docs/jury-setup.md) | Setup wizard and acceptance checklist |
| [Inspection API](docs/inspection-api.md), [Registry API](docs/registry-api.md) | Schemas, errors, limits |
| [Verification](docs/verification.md) | Workflow states and correction loop |
| [Segmentation](docs/segmentation.md) | SAM protocol, routing and limits |
| [Calibration](docs/calibration.md), [Geometry](docs/geometric-verification.md) | ChArUco, stud offsets |
| [Faces](docs/face-verification.md), [Print recognition](docs/print-recognition.md) | Printed-face and text rules |
| [Contours](docs/contour-overlays.md), [Edge debug](docs/edge-debug.md) | Visual diagnostics |
| [Completion hologram](docs/completion-mascot.md) | Mascot behavior and checks |
| [Architecture notes](docs/architecture.md), [Benchmark](docs/benchmark.md) | Module-level detail, evaluation runner |
| [Validation log](docs/validation.md) | Dated records of executed checks |

## License

Apache License 2.0; see [LICENSE](LICENSE).
