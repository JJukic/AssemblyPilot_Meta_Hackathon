# Validation results

## Independent Canny debug — 2026-10-30

Validated on `feature/logo-face-orientation-verification` / PR #9.

| Check | Result |
| --- | --- |
| `make lint` | Ruff and ESLint passed |
| `make test` | 352 Python tests and TypeScript passed |
| `make build` | Next.js production build passed |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium make test-browser` | 63 Playwright tests passed |

Thirteen new backend cases verify no-key/no-project operation, exact original
JPEG bytes, native resolution above the normal resize limit, default full-image
and explicit ROI behavior, actual threshold/blur effects, invalid controls,
stale hashes, extraction/busy errors and valid empty results. Six browser cases
cover direct ROI selection, controls, side-by-side output, optional overlays,
responsive alignment, late responses after capture/settings changes, failure
handling and preservation of the current correction workflow. The calibration
test now selects its confirmation checkbox by accessible name because the
dashboard has an additional independent debug checkbox.

No paid inference or physical camera benchmark was run. Existing model-based
inspection, printed-face rules, SAM, calibration and fresh verification regressions
remain passing. See [independent edge debugging](edge-debug.md) for contracts and limits.

## Optional contour overlays — 2026-10-30

Validated on the open Phase 4.1C feature branch / PR #9.

| Check | Result |
| --- | --- |
| `make lint` | Ruff and ESLint passed |
| `make test` | 339 Python tests and TypeScript passed |
| `make build` | Next.js production build passed |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium make test-browser` | 57 Playwright tests passed |

Thirteen added backend cases cover SAM crop offsets/holes, missing/empty/stale
segmentation, ROI validation/background exclusion, geometry budgets, reference
inlier filtering and exact-snapshot face output. Six added browser cases cover
independent controls, disabled defaults, mobile/desktop SVG alignment, stale
capture clearing, invalid layer hashes/bounds/dimensions/budgets and unavailable
evidence. Alignment assertions measure transformed SVG points, excluding the
painted non-scaling stroke's bounding-box expansion.

Existing Muse, SAM, calibration, face-rule and fresh-verification tests remain
passing. No new live inference or physical-image validation was performed. These
results establish software contracts, not contour accuracy on actual blocks.
See [visualization limits](contour-overlays.md#validation-and-limits).

## Phase 4.1C printed-face verification — 2026-10-30

Validated on `feature/logo-face-orientation-verification`, based on main
`37e2088` (merged Phase 4.1B / PR #8).

| Check | Result |
| --- | --- |
| `make lint` | Ruff and ESLint passed |
| `make test` | 326 Python tests passed; strict TypeScript passed |
| `make build` | Next.js production build passed |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium make test-browser` | 51 Playwright tests passed against isolated FastAPI/SQLite |
| Live Meta inference | Not executed for this change; no new successful inference claim |
| Real printed-face/tower experiment | Not performed; reference/test photographs and physical measurements unavailable |

New coverage includes additive startup over a prior schema, face CRUD/ownership,
reference edits/deletion, specification invalidation after edit/revert, invalid model
face IDs, planar matching under rotation/perspective, different or ambiguous artwork,
low texture/darkness/occlusion, unresolved calibration/operator frame, correct and
wrong face decisions with mocked pose acquisition, unsupported success and stale
snapshot rejection, SAM association disagreement and fresh verification gating.
Browser tests exercise registry editing/upload/deletion, constraints, face status,
static overlays and invalid hashes/coordinates/scores. Existing Muse/SAM/calibration
and correction workflow regressions remain green. Python emitted one existing
Starlette/httpx deprecation warning.

Synthetic fixtures and injected model/pose responses establish software behavior;
they are not physical accuracy or live model-validation evidence. See the
[manual experiment and limitations](face-verification.md#four-block-color-tower-manual-experiment-protocol).

## Phase 4.1B stud-level geometry — 2026-10-29

Validated on `feature/stud-geometric-verification`, based on merged Phase 4.1A main
at `4351f5e`.

| Check | Result |
| --- | --- |
| `make lint` | Ruff and ESLint passed |
| `make test` | 308 Python tests passed; strict TypeScript passed |
| `make build` | Next.js 16.4.3 production build passed |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium make test-browser` | 44 Playwright tests passed against the isolated FastAPI/SQLite server |
| Live Meta inference | Not requested; automated tests use no paid inference |
| Physical iPhone/ChArUco/tower experiment | Not performed; no physical accuracy or repeatability result is claimed |

New deterministic coverage includes constraint persistence and rejection, old steps
without constraints, synthetic 2×4 grids under rotation, partial reference visibility,
invalid masks, correct/incorrect offsets, uncertainty-boundary overlap, elevated-plane
ray intersection, missing calibration, profile/resolution mismatch and semantic
`correct` versus geometric `incorrect`. The browser verifies the fused correction
state and exact-snapshot stud/axis overlay; no geometry is drawn on live video.

The synthetic tests establish code behavior and transform consistency only. They do
not validate HSV association, ChArUco print quality, iPhone Continuity Camera stability,
physical dimensions, measurement accuracy or repeatability. The blank controlled
experiment protocol and failure reporting table are in
[geometric-verification.md](geometric-verification.md).

## Phase 4.1A integration — 2026-10-29

OpenCV 4.14.0 (headless contrib wheel 4.14.0.94) is integrated with the preserved
Phase 4 workflow and merged SAM adapter. Automated calibration tests use rendered
ChArUco boards under a known pinhole camera, not photographs of actual assemblies.
They exercise detection, calibration, pose, distortion-aware plane conversion,
profile persistence/validation, bad views, ambiguity, blur and API limits.
Browser tests cover the calibration workflow and existing camera/Muse/SAM flows.

No physical camera experiment, real calibration or live Meta call was performed
for this phase in the cloud. Runtime inspection found no Meta key, no reference
JPEGs and no saved real calibration profiles. The user reports prior successful
local Muse and SAM inference. Real print scale, hidden camera changes, board
flatness and elevated geometry remain unvalidated. See [the manual protocol](calibration.md).

PR #6 is merged in main at `b03d4db`, including the Phase 4/SAM conflict resolution
and its additional fallback regressions. PR #7 merges that exact main state while
retaining calibration APIs, profiles, UI and geometry tests. The current integrated
branch passes `make lint`, `make test` (300 Python tests plus strict TypeScript),
`make build`, and `make test-browser` (43 Playwright tests). No tests are disabled.
Existing Starlette/httpx and NO_COLOR notices remain non-failing.

The dated sections below preserve the original branch validation history; their old
merge-status statements are historical. See [the Phase 4 conflict review](pr6-integration-review.md).

## Phase 4 — 2026-10-28

Implemented on `feature/closed-loop-verification` from current `main` at `9089e07`.
Phase 3B is merged. SAM PR #5 was checked at the start and end and remains an open
draft, not merged; this implementation follows the requested Muse-only path and
leaves the separate SAM branch intact. The reference-camera and selected-step-photo
features already on main are preserved.

| Check | Result |
| --- | --- |
| `make lint` | Ruff and ESLint passed |
| `make test` | 212 Python tests passed (164 existing + 48 new); strict TypeScript passed |
| `make build` | Next.js production build passed |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium make test-browser` | 33 browser tests passed, including all 23 existing tests |
| Additive schema upgrade | Existing test project, block and reference bytes survived startup from a schema without `step_progress` |
| Concurrent operations | Duplicate verification rejected; intervening edits/new inspections prevented stale verified commits |
| Metadata persistence | Verified progress survives restart; no camera image or diagnosis text is written to the new table |
| Fresh evidence | API rejects prior canonical JPEG hashes; browser test confirms a newly captured JPEG is uploaded |
| Mobile review | Verification screenshot at 390px reviewed; no horizontal overflow |
| Live runner preflight | `python smoke_verification.py` exited 77 without opt-in/photos; no request sent |

The user has confirmed working live Muse inference in their local environment.
**The new Phase 4 real-camera correction/verification cycle has not been independently
completed here.** This running cloud environment still has no configured backend key,
no `backend/.env` or `.env.backend`, and no real user reference/test photographs.
No live inference or successful physical repair is claimed from mocked tests.
An executable Four-Block Color Tower procedure and opt-in two-photo replay are provided
in [verification.md](verification.md). No secrets, personal photographs or generated
image outputs are committed.

New backend coverage includes deterministic correction planning without extra inference,
explicit transition rejection, independently assessed fresh verification, resolved/
unresolved/uncertain finding IDs, new errors after old errors resolve, model schema and
association validation, unknown/cross-context/consumed/superseded sessions, repeated
frames, invalid images, missing credentials, authentication/rate/timeouts, cancellation,
cache capacity/expiry (including expiry during inference), retries/attempt counts,
progress persistence, additive schema startup and specification invalidation after
instruction, quantity, block, photo addition/deletion/selection and order changes.
Reverting a specification edit does not revive old verification. The smoke replay
contract is also exercised through the real test API with mocked Meta transport.

New browser coverage exercises correction acknowledgement without success, fresh
Capture & Verify upload, loading, verified/still-incorrect/uncertain states, Active
Vision, provider/session/malformed errors, camera availability, explicit advancement,
progress reload, finding history, mobile layout and late-response rejection after
step/manual-capture/specification changes. Specification changes also reload the
assembly instructions. Inspection fixtures are synthetic and confined to tests;
registry/reference-photo workflows continue to use the isolated real FastAPI service.

Remaining limitations: single backend worker and trusted-local access only; sessions
expire/evict and do not survive restart; progress invalidation is conservative; a hash
is a duplicate-image guard, not camera attestation; finding links do not prove physical
object tracking; visual verification cannot certify hidden connections or mechanical
stability. Model text remains probabilistic. Real camera hardware, real recognition
accuracy and the new live correction cycle need local acceptance testing. Existing
non-failing Starlette/httpx and NO_COLOR notices remain; no tests were disabled.

## Phase 3C — 2026-10-28

Implemented on `feature/sam-segmentation`, based on `main` at `9089e07`.
Phase 3B PR #4 was already merged (`2a6d1a2`). The newer reference-camera and selected
step-photo changes on main were preserved. No repository reinitialization, database
reset, model-weight download or photo replacement was performed.

| Check | Result |
| --- | --- |
| `make lint` | Ruff and ESLint passed |
| `make test` | 215 Python tests passed (164 existing + 51 SAM tests); strict TypeScript passed |
| `make build` | Next.js production build passed |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium make test-browser` | All 26 browser tests passed, including all 23 existing cases |
| Mocked end-to-end API | Muse and SAM received byte-identical JPEG data URLs; returned identity and mask geometry validated |
| Official parser | Parsed official synthetic conformance vector through the real installed parser; no live inference involved |
| Live smoke preflight | `smoke_segmentation.py` exited 77: no backend `MODEL_API_KEY`; no request sent and no output generated |
| Real images | No developer-supplied photograph available in this cloud checkout/attachments; no real-image benchmark run |

**No actual Muse or SAM inference succeeded in this cloud task.** The separate
user-provided local validation note reports a successful model-metadata GET, which
is not inference. The current cloud process, `backend/.env` and `backend/.env.backend`
do not provide a key here. Synthetic fixtures were used only in tests, never as
application results or as substitutes for a developer photo. No credentials, private
photos or generated annotation outputs are included in the change.

Protocol implementation used official Meta GitHub sources because the requested
`dev.meta.ai` pages were blocked by the cloud proxy (403); exact sources and remaining
provider-limit/non-streaming documentation gaps are recorded in [segmentation.md](segmentation.md).

Coverage includes authentication/origin/model/request format, exact JPEG identity,
concept validation, official box prompting (including subpixel failure), SSE finalizers,
empty/refused/incomplete/interleaved output, malformed masks, inconsistent dimensions,
large allocations, safe errors/retries/Retry-After, overall timeout and cancellation,
parser-worker cleanup, optional activation, correct/uncertain/missing routing,
maximum two operations, wrong-color spatial prompts, multiple-instance ambiguity,
spatial association and snapshot mismatch fallback. The backend retains the Muse
status and issue details for all SAM fallback states.

Browser checks cover responsive mask geometry, SAM box-only mode, original/annotated
comparison, ambiguous/empty/disabled/unavailable fallback, malformed mask/provenance
rejection, snapshot/history separation and existing stale-request behavior. They use
Chromium's synthetic camera and mock inspection responses; registry and reference
camera tests use the isolated real FastAPI/SQLite service. No tests were skipped.

Known limits: real localization accuracy and provider/account access remain unverified;
large masks can exceed conservative decoder limits; spatial association uses documented
heuristics; color concepts use a small vocabulary, with validated box prompts or a clear
skip for other cases. The parser worker requires POSIX resource limits (tested on Linux,
not physical macOS hardware). Browser abort cannot guarantee cancellation of Meta work
already in progress. Existing non-failing Starlette/httpx and NO_COLOR notices remain.
The next acceptance step is the explicit smoke command with the developer's key and
real photo, followed by visual review of multiple similar parts and occluded assemblies.


## Phase 3B — 2026-10-27

Based on merged Phase 3A (`d577684`), on `feature/visual-ai-debugging`.

| Check | Result |
| --- | --- |
| Phase 3A transport verification before changes | 56 mocked HTTP/client/API tests passed; live smoke exited 77 because no backend key was available |
| `make lint` | Ruff and ESLint passed |
| `make test` | All 161 Python tests passed; strict TypeScript passed |
| `make build` | Production build passed |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium make test-browser` | All 19 tests passed |
| Exact snapshot provenance | API response JPEG matched the bytes in the mocked Meta request, including EXIF rotation and 1280px resize |
| Desktop/mobile overlays | Coordinate alignment verified against the actual image transform; mobile screenshot reviewed |
| `python smoke_inspection.py` | SKIPPED, exit 77: MODEL_API_KEY missing from the running backend |
| `python benchmark_inspection.py` | SKIPPED, exit 77: no real-photo manifest / live opt-in |

No real user reference/test photographs were available in the configured local registry or reference directory: zero projects, steps and reference-image records. **No actual Meta inference succeeded in this task, and no real benchmark scores or localization-quality claims were produced.** The live tools remain ready for explicit use with the user’s real images and configured backend key.

New coverage verifies expected/observed fields for all five discrepancy categories, null boxes for missing parts, required Active Vision for uncertain results, exact analyzed-image provenance and backend latency/timestamp metadata, failure-inclusive benchmark metrics, explicit benchmark opt-in, responsive overlay geometry, invalid coordinates and image-dimension mismatch rejection, snapshot/history separation, navigation persistence, history cap/clear/reload and existing stale-answer cancellation. Synthetic images and diagnoses exist only in tests.

The initial coordinate assertion measured the visible SVG stroke rather than the coordinate rectangle. It was corrected to compare the SVG rectangle transformed to screen coordinates against the image in the same layout frame, with a tighter tolerance; the complete 19-test browser suite then passed. No application checks were disabled. The existing non-failing Starlette/httpx deprecation and browser NO_COLOR notices remain. Physical cameras and real recognition/localization quality still require user hardware and images.

## Phase 3A — 2026-10-26

Validated on `feature/meta-vision-integration`, based on merged Phase 2 (`103cbbb`).

| Check | Result |
| --- | --- |
| `make lint` | Ruff and ESLint passed |
| `make test` | 143 Python tests passed (all previous 60 retained); strict TypeScript passed |
| `make build` | Next.js production build passed |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium make test-browser` | All 14 tests passed, including all previous 11 |
| Mobile inspection view | Synthetic diagnosis screenshot reviewed at 390px; no horizontal overflow |
| Official Meta protocol documentation | Read successfully before implementing HTTP transport; sources in inspection-api.md |
| Normal development startup | Backend/frontend started; health, blocks, projects and dashboard HTTP 200 |
| `cd backend && .venv/bin/python smoke_inspection.py` | SKIPPED, exit 77: MODEL_API_KEY absent from this running backend |
| Git exclusions | backend/.env, database and upload paths remain ignored |

New backend coverage includes safe reference ownership/path/file validation; relevant image selection and omitted references; 1280px preprocessing; strict status/confidence/count/box schemas; documented multimodal payload/authentication; Meta-only destination and no redirects; transient retries and Retry-After; overall timeout; authentication/billing/rate/network errors; oversized request/response limits; incomplete/refused/malformed output; unknown IDs; API missing-context/configuration errors and successful mocked transport.

Inspection browser cases cover explicit multipart submission without frontend credentials, disabled/loading states, diagnosis/components/issues/next-action rendering, no automatic advancement, clearing prior results on retry/capture, step changes during an in-flight request, project switching and continued camera use. Registry cases still run against the disposable real FastAPI/SQLite backend. Inspection answers are synthetic fixtures confined to tests; no real inference was used in automated tests.

The user reported configuring a key locally and in environment settings; checks in this running cloud instance still found no backend key. The smoke script therefore skipped before any inference request. The local registry also contains no real project/step/reference photograph for live evaluation. **Real Meta inference and recognition accuracy remain unverified.** No credentials or personal photos were added to Git. Run the explicit README smoke command locally with the configured backend and a real assembly photograph.

One upstream Starlette/httpx TestClient deprecation warning remains. No automated tests were skipped or disabled. Physical webcam/iPhone compatibility and remote GitHub Actions have not been verified here.

## Phase 2 — 2026-10-26

The Phase 2 implementation was validated in the current cloud checkout.

| Check | Result |
| --- | --- |
| `make lint` | Ruff and ESLint passed |
| `make test` | 60 Python tests passed, including all original 28; TypeScript passed |
| `make build` | Production build passed for `/`, `/blocks`, `/projects`, `/projects/[projectId]` |
| Playwright (system Chromium, real isolated API) | All 11 tests passed, including all original 9 |
| `make dev-backend` / `make dev-frontend` | Both started successfully |
| Normal local startup | Five SQLite tables initialized; health, blocks and projects returned HTTP 200; DELETE CORS preflight passed |
| Live browser checks | Desktop and mobile editors reviewed; no page errors or horizontal overflow; dashboard backend Connected and empty-project guidance visible |
| Git exclusions | Database and upload paths confirmed ignored |

Backend checks include CRUD/search, invalid dimensions/quantities, conflicting/missing references, cross-project isolation, concurrent reorder consistency, foreign-key and exactly-one-image-owner constraints, corrupt/unsupported/oversized uploads, path/symlink rejection, upload rollback cleanup, owner-specific deletion, app-restart persistence, and inspection context with a transient normalized snapshot.

The new complete browser workflow creates a block, uploads a synthetic test photo, edits and filters the block, creates/edits a project, assigns quantities to steps, uploads a step photo, reorders and edits steps, reloads persisted data, captures a synthetic camera frame with the custom project, switches back to the demo without stopping the camera, verifies block-deletion conflicts, and removes owned records. A separate browser case covers backend errors. Tests use disposable SQLite storage, never the developer database. Live visual checks did not create real registry records or photographs.

One upstream Starlette/httpx TestClient deprecation warning remains; no tests were skipped or disabled. Physical webcam/iPhone hardware, remote GitHub Actions and Meta inference were not tested. No Meta calls or credentials were required.

## Phase 1 — 2026-10-26 (historical)

Executed in the cloud checkout with Node 24.19.0, Python 3.12.14, uv 0.12.23 and system Chromium 154.0.8037.57.

| Check | Result |
| --- | --- |
| `make install` (frozen uv + npm installs) | Passed; repeated successfully |
| `make lint` | Ruff and ESLint passed |
| `make test` | 28 pytest tests passed; TypeScript route generation and check passed |
| `make build` | Next.js 16.4.3 production build passed |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:e2e` in frontend | 9 tests passed against the production server |
| `make dev-backend` / `make dev-frontend` | Both development services started successfully |
| Live API requests | Health 200; exact CORS origin; valid image resized to 1600×800 with 501; corrupt image rejected with 422 |
| Browser with real backend | Connected indicator, synthetic-camera capture and stop passed; no page errors |
| Desktop/mobile inspection | Screenshots reviewed at 1440px and 390px widths; mobile overflow test passed |

The browser suite validates five-step navigation, backend connection states, camera start/stop/restart, JPEG capture, source restart and old-track cleanup, permission denial, disconnection/recovery, and stopping a pending permission request. Camera streams are synthetic; no physical webcam or Continuity Camera was available.

The Playwright bundled-browser download was blocked by the environment network policy (`cdn.playwright.dev`, HTTP 403). Tests ran successfully with the preinstalled Chromium using the supported executable override. CI is configured to download Playwright's matching Chromium on GitHub-hosted runners; that remote workflow has not been executed here.

Non-failing dependency notices: ESLint 9 is marked deprecated by npm; the current Next.js lint stack passes. Starlette emits one deprecation warning for its httpx-based TestClient; all 28 tests execute and pass. No checks were disabled to avoid these notices.

No Meta credentials or inference calls were used. Muse Spark API/model compatibility remains unverified and is deferred to the documented Phase 2 integration work. Physical camera checks remain a local acceptance step.

## Phase 4.1E — automated validation, 2026-10-31

Integrated on PR #9's unmerged printed-side / contour / independent Canny branch.

- `make lint`: Ruff and ESLint passed.
- `make test`: 390 backend tests passed; frontend typecheck passed.
- `make build`: production Next.js build passed.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium make test-browser`: 69 passed,
  including six new browser cases for configuration without photos, recognition
  states, responsive alignment and stale print evidence.
- 38 new backend cases cover print configuration and additive compatibility,
  text/reference/contour/hybrid modes, supported crops and direction association,
  SAM conflicts, provider failure, fresh verification and invalid evidence.
- Existing FastAPI/Starlette test-client deprecation warning remains non-fatal.

Only synthetic images and mocked Meta inference were used. No Phase 4.1E live
request was sent, no real-image print accuracy or latency was measured, and no
new model provider or automatic inference loop was introduced. The actual yellow
block experiment and its pending A–G records are in [print-recognition.md](print-recognition.md).

## Direct analyzed-image Canny overlay — 2026-10-31

`Detect Canny edges` now computes and displays raw edges directly on the inspected
JPEG using the existing local endpoint. No new inference or verdict change.
`make lint`, `make test` (390 backend tests and TypeScript), `make build`, and
`make test-browser` (73 tests with system Chromium) passed. Four added browser
cases cover exact analyzed-image transport and desktop/mobile alignment, toggles,
stale captures, backend failure and mismatched image identity.

## Rejected Meta response diagnostics — 2026-10-31

`make lint` and `make test` passed (399 backend tests and frontend TypeScript).
Nine new cases verify safe rejection categories, token truncation, malformed JSON,
print-rule evidence and removal of untrusted values/keys from messages and logs.
Validation rules remain strict; no live inference or extra retry was performed.
The reported three failures occurred locally outside this workspace, so their
specific historical cause is not known. A conflicting legacy prompt instruction
was clarified; a new local attempt can now expose the bounded rejection reason.

## Structured detection overview — 2026-10-31

`make lint`, `make test` (399 backend tests and TypeScript), `make build` and
`make test-browser` (73 passed with system Chromium) passed. The existing Canny
browser scenario additionally checks exact contour alignment and no horizontal
overflow at 1600, 1280 and 390 px. Desktop/mobile screenshots with synthetic
fixtures were visually reviewed. This change reorganizes presentation only.
