# Validation results

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
