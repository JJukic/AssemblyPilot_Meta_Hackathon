# AssemblyPilot architecture notes

Module-level notes collected through Phase 4.1E. For the current system overview,
including Spatial AR, Autonomous Assembly and the guided flow, see the
[Technical Report](technical-report.md).

## Components

```text
Browser camera → live preview → in-memory snapshot (unchanged Phase 1)
Block/project forms → FastAPI → SQLModel/SQLAlchemy → local SQLite
Explicit photo upload → Pillow validation → generated JPEG file + SQLite metadata
Project selector → ordered steps/expected blocks/reference URLs → manual camera guide
Explicit inspection → selected SQLite context + safe reference bytes + current snapshot
  → async Meta Chat Completions → strict Pydantic diagnosis + exact input JPEG + timings
  → optional SAM localization → deterministic correction plan / snapshot overlays / Active Vision
Explicit fresh capture → independent Muse verification + prior finding assessments
  → optional SAM on the new snapshot → version-checked SQLite progress
  → snapshot-only boxes/masks / temporary tab history / user-confirmed next step
Explicit precision capture → ChArUco detection → calibration/pose quality guidance
  → user-selected static snapshot → existing on-demand Muse/SAM workflow
```

Next.js App Router provides `/`, `/blocks`, `/projects`, and `/projects/[projectId]`. Interactive management components use a typed API client and reusable image uploader. Dynamic route parameters are awaited on the server. Client fetches display loading/error/empty states; project switching does not remount the camera hook. The five-step JSON demo remains a fallback and is not seeded into or synchronized with the database.

## Persistence and ownership

`db/tables.py` contains internal SQLModel tables; external API models live in `models/`. Routes acquire database sessions via dependency injection. The FastAPI lifespan creates missing tables, enables foreign keys and prepares the upload directory. Relative database/upload paths and `.env` always resolve from the backend root. No module import or test collection creates a database.

| Table | Relationships / constraints |
| --- | --- |
| `building_blocks` | UUID ID; nonempty name; physical properties; positive default quantity; timestamps |
| `assembly_projects` | UUID ID; nonempty name; description and timestamps |
| `assembly_steps` | Project FK with cascade delete; unique `(project_id, position)`; positive positions; title/instruction |
| `assembly_step_blocks` | Step FK with cascade delete; block FK with RESTRICT; unique `(step_id, block_id)`; positive required quantity |
| `reference_images` | Exactly one concrete block/step FK (XOR CHECK); cascade delete; unique generated storage filename; display filename, dimensions, MIME, timestamp |

A reference image cannot have no owner, two owners or a nonexistent owner. Foreign keys are enabled on every SQLite connection, including tests. API responses serialize explicit Pydantic schemas; local file paths never leave the backend.

Mutation dependencies begin `BEGIN IMMEDIATE` before reading, serialize SQLite writers, and commit before the HTTP response is sent. Step ordering uses two passes through temporary positive positions to avoid transient unique-index collisions. Failed assignment/reorder mutations roll back. Full entity edits use last-write-wins semantics; this is a local single-user MVP, not collaborative editing.

## Files and deletion

The existing image processor checks encoded size, formats, dimensions, decompression safety and corruption; applies EXIF orientation; resizes proportionately; flattens transparency; and emits metadata-free JPEG bytes. Reference uploads run in synchronous FastAPI worker threads, under bounded reads. Every stored name is a generated UUID with `.jpg`; exclusive creation prevents overwrites.

GET media requires a database record and a safe file under the upload root. Arbitrary paths and symlink escapes are rejected. Original filenames are sanitized display metadata, never storage addresses. The default backend remains loopback-bound with explicit CORS; no authentication/public deployment is provided.

Deleting a project cascades only its steps, assignments and step image records. Reusable blocks and their photos survive. Deleting a referenced block returns 409. Deleting a step also compacts remaining order. Image files are scheduled for removal after a successful database commit; new files are removed on rollback. Crash/IO failure can leave an unreachable orphan file because SQLite and the filesystem cannot commit atomically; failures are logged. There is no automatic orphan scan or destructive startup cleanup. See README for backup/deletion details.

## Meta inspection boundary

`services/inspection_context.py` remains the metadata-only selected-step resolver. `services/inspection_request.py` builds a typed `MultimodalInspectionRequest`, verifies each reference's ownership and safe storage path, and reprocesses its bytes with Pillow. The camera snapshot is image 0, followed by the selected assembled-step reference (oldest fallback) and first photograph per assigned block, capped at eight references by default. No other step or library image is sent. Existing stored images are unchanged. Inspection copies use a 1280px maximum edge.

The route closes its SQLite read session before awaiting inference; file/SQLite work runs in a worker thread. `prompts/inspection.py` separates developer policy from JSON task data and labels all image roles. Separate component photos do not establish the intended arrangement. Quantities are assignments to the current step, not necessarily the total assembly. Missing/ambiguous visual evidence should result in `uncertain`; prompt instructions alone cannot guarantee model accuracy.

`services/meta_client.py` uses async httpx and the documented `POST https://api.meta.ai/v1/chat/completions` protocol with Bearer `MODEL_API_KEY`, default model `muse-spark-1.3`, JPEG data URLs, and a strict JSON schema generated from `models/diagnosis.py`. The endpoint guard accepts only Meta HTTPS, without URL credentials/query/fragment, and redirects are not followed. No fallback inference provider, tool execution or local model exists. The transport is injectable for tests.

One 60-second deadline covers networking, up to three attempts and backoff. Short transient 429/500/502/503 and transport failures may retry with exponential backoff/jitter; authentication/validation errors and upstream 504 do not. Long Retry-After values return guidance instead of retrying early. Request JSON is capped at 10 MiB; response bytes at 1 MiB. Raw upstream error bodies are never returned or logged.

Successful HTTP status is insufficient: the adapter requires a completed single choice, JSON that passes strict Pydantic validation, the requested step ID, and only supplied block IDs or null. Extra fields, unknown statuses, invalid/nonfinite confidence, invalid boxes and inconsistent status/issues are rejected. Refusals, truncated output and malformed responses return errors, never fabricated success or a synthetic `uncertain` result.

`InspectionPanel` sends multipart image/project_id/step_id only after a click, shows loading/errors and the validated diagnosis, and never advances the step. Remounting on project/step/capture changes aborts the browser request and discards stale results. This does not guarantee cancellation of work already running at Meta. Frames/results are not persisted to disk or browser storage by AssemblyPilot; references remain in the existing local registry. The root-layout `InspectionSessionProvider` retains at most ten completed responses in tab memory across client navigation. Each record binds project/step labels, capture time, backend inspection time, normalized JPEG, diagnosis and latency; reload/close/clear releases history. Credentials remain exclusively in backend settings.

`inspection_service.py` wraps the existing adapter without altering its transport: it measures the entire Meta adapter call (including retries, excluding image/context preparation), adds the backend UTC completion timestamp and model ID, and returns exactly the camera JPEG bytes sent upstream. These metadata fields are never generated by the model.

`DiagnosticOverlay` accepts the analyzed snapshot and validated issues as one unit. A natural-size image and SVG share a responsive container without crop or letterboxing; normalized boxes scale with that image. Overlays wait for image decode and matching dimensions, never attach to the camera video, and never reuse the latest capture as a substitute. Missing/invalid boxes are omitted; missing-part boxes are rejected by the backend.

Issues now separate expected specification from observed evidence. `uncertain` results require a non-null Active Vision reason, requested view and specific instruction; other statuses require null. No default camera request is manufactured when the model fails this contract. New angles remain separate, explicitly triggered inspections, not an automatic multi-view fusion loop.

The image-only legacy route still validates and returns 501; context-aware requests use the real adapter and the Phase 4 orchestrator. Fresh post-repair frames drive explicit verification. See [inspection API](inspection-api.md) for protocol sources and errors.

## Testing and local operation

Existing `make install`, `make dev-backend`, `make dev-frontend`, `make lint`, `make test`, and `make build` remain valid. Locked dependencies include SQLModel and SQLAlchemy. Python tests explicitly disable ambient Meta credentials and override settings with per-test temporary SQLite databases/uploads and exercise API behavior, DB constraints, persistence after restart, filesystem cleanup, rollback and contextual data scoping.

Playwright starts `backend/browser_test_server.py`, which runs the API with a disposable temporary database and upload directory. It refuses an already-running backend on port 8000 rather than reuse user data. The frontend CI job installs backend dependencies as well. The browser suite preserves all original synthetic-camera tests and adds the complete registry/project workflow against the real isolated API. New inspection browser cases mock only API fixtures/results inside tests, exercising manual submission, state and failure handling. Physical-camera compatibility still requires local hardware validation.

SQLite `create_all` initializes a new schema; it is not a migration system. Keep database/files outside Git and back up both before future schema changes. No external service, cloud sync or GPU is required.

## Phase 4 active workflow

`services/assembly_orchestrator.py` is the active coordinator for `/api/inspect` and
`/api/verify`. It reuses `MetaClient`, adds deterministic `correction_planner`, and
uses `VerificationClient` for a single verification-specific structured Meta request.
The original context-free Phase 1 agents remain unused. No agent framework or autonomous
loop is introduced. Phase 4 and SAM PR #5 are merged into main. Both active routes inject
SamClient into the orchestrator; localization follows the fresh Muse diagnosis before
progress completion. SAM failures retain the diagnosis and valid Muse boxes.

`models/workflow.py` defines explicit transitions, evidence assessments, tracked findings
and API responses. `InspectionSessions` bounds metadata-only server sessions (default
64 records, 30 minutes), rejects consumed/busy/cross-step/duplicate-frame references,
and never retains JPEG bytes. `progress_service.py` uses short SQLite transactions and
specification/request versions to reject stale commits. A new additive `step_progress`
table stores only minimal metadata. Effective progress is invalidated by current
specification/reference revisions, including edits made during inference.

The existing camera hook can return a fresh frame without publishing it as the dashboard's
manual capture. `InspectionPanel` uses that frame for Capture & Verify, keeps human
acknowledgement separate from successful evidence, preserves on-demand behavior and
never advances automatically. Project/step/manual-capture/specification changes abort
and invalidate active UI work. Progress polling refreshes metadata only. Completed
images remain exclusively in the existing temporary browser history.

Full state machine, retry counts, cache limits, progress invalidation policy, real-image
manual testing and known limitations are in [verification.md](verification.md).

## Phase 3C localization boundary

`inspection_service.py` (standalone smoke/benchmark) and the active orchestrator call `segmentation_service.localize_issues` after Muse,
before returning server provenance. `sam_client.py` reuses the exact normalized image,
Meta credential/origin guard, async HTTP and bounded retry conventions. It implements
the official SAM streaming Responses protocol and supports concept or spatial-box
prompts. `sam_decode.py` isolates the official parser's CPU/memory use in a bounded
subprocess and produces validated box-local RGBA PNGs. No keys are passed to it.
`models/segmentation.py` validates geometry, masks and issue selection, while the
inspection response binds every localization to its JPEG hash and dimensions.

Correct/uncertain/missing/unknown cases skip SAM. Up to two visible issues receive
localization, with conservative spatial association and explicit ambiguity. Errors
remain per-issue localization statuses and never alter Muse's diagnosis. SAM itself
adds no database tables or continuous inference; Phase 4 adds the progress table.

The frontend validates provenance and mask metadata before storing the response.
`DiagnosticOverlay` adds original/annotated comparison and segmentation/box modes,
with fallback to valid Muse boxes. Both history and current inspection reuse this
component on the returned snapshot only. The current view still aborts/discards stale
requests on capture/step/project changes; live camera state is independent.

See [segmentation.md](segmentation.md) for protocol evidence, association thresholds,
resource limits, optional configuration, cost considerations and live smoke testing.
## Phase 4.1A calibration and Phase 4.1B deterministic verification

The camera dashboard's collapsed calibration panel reuses the camera stream.
Explicit sample/capture actions call `api/calibration.py`; Pillow validates and
orients without resizing, then `charuco_vision.py` detects board corners, fits
intrinsics or estimates a distortion-aware board pose. `calibration_store.py`
saves validated versioned JSON without photographs or SQLite changes.

Only the assessed static image receives corner overlays. Phase 4.1B adds an optional
step constraint in the additive `step_spatial_constraints` table and a narrow
`geometric_verification.py` service. It intersects calibrated camera rays with two
explicit known-height surfaces, fits complete 2×4 stud grids and compares a signed
longitudinal offset with an uncertainty-aware tolerance. It never projects elevated
studs with the board-plane-only helper.

Geometry runs on the native static upload while Muse receives its bounded inspection
copy. Each result retains its own JPEG hash, dimensions and overlay coordinates.
The orchestrator fuses validated statuses: Muse `correct` cannot override geometric
`incorrect`; inconclusive configured geometry remains `uncertain`. No-constraint
steps remain `not_measured` and keep their previous semantic behavior. See
[calibration.md](calibration.md) for calibration and
[geometric-verification.md](geometric-verification.md) for frames, thresholds,
API fields, tests and the unperformed physical experiment.

## Printed-face identity and physical direction

The [Phase 4.1C pipeline](face-verification.md) adds block-local face definitions,
reference links and optional step constraints through three additive SQLite tables.
Face references reuse existing media ownership and cleanup. `face_registry.py`
provides shared serialization; `face_inspection.py` uses ORB/MAGSAC, planar
rectification, Canny support, template correlation and calibrated face/board pose.
The orchestrator combines semantic, geometric and face evidence; unresolved
required faces block successful verification. Existing SAM masks can reject an
inconsistent target association without introducing another model call. Muse
receives registered face context in its existing request and returns a validated
nullable face ID. Face and geometry panels remain separate, each tied to its exact
snapshot. Reference/specification edits invalidate prior progress.

Optional [inspection contour overlays](contour-overlays.md) add independently selectable SAM
boundaries, raw ROI Canny edges and verified reference feature pairs on their
exact snapshots. New contours are disabled by default and make no additional AI calls.

[Independent Edge Detection Debug Mode](edge-debug.md) analyzes the captured camera
JPEG without AI or matching prerequisites. It adds direct rectangular ROI selection,
manual Gaussian/Canny controls, a full-resolution edge image and an optional raw
overlay while preserving existing inspection results.


## Meta-first print recognition

[Phase 4.1E](print-recognition.md) adds one optional JSON configuration table linked
to existing physical faces. `print_recognition.py` evaluates validated Muse
observations against registered text or reusable references. Physical direction
and geometric placement keep independent gates. `print_crop.py` may add one
supported planar crop to the same Muse request; it never infers a plane from an
object mask or starts another model call. The existing correction and fresh-image
verification flow incorporates `print_adjust`/`print_capture` actions. The frontend
shows versioned recognition and its exact-snapshot region alongside the existing
face, geometry, SAM, contour and Canny tools. No non-Meta provider is added.
