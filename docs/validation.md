# Validation results

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
