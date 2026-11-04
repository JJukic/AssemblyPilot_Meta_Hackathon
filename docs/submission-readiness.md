# Submission readiness

Recorded on 2026-11-04. **Status: not ready to submit.** The blockers are listed below.

## Checked state

| Item | Value |
| --- | --- |
| Branch | `codex/hackathon-submission-ready` |
| Full check commit | `7791409` |
| Final code commit | `77b243b`: same application code; adds the `create_ar_demo.py` fix and documentation |
| Later commits | Documentation only |
| Environment | macOS 26.6.2, arm64, Python 3.12.6, Node 24.10.0, npm 11.19.0, uv 0.13.5, Caddy 2.11.7 |
| CI environment | Linux, uv 0.12.23. **CI has not run on this branch**, because the branch is not pushed. `uv export` from 0.12.23 produced the same requirements content locally, apart from the command in the header line |

All checks ran in fresh `git clone` copies in a temporary directory, with no `.env`, no
`MODEL_API_KEY` and a temporary database. The owner's data was not used.

## Executed checks

| Check | Command | Result |
| --- | --- | --- |
| uv install | `uv sync --frozen` | Passed; `uv.lock` unchanged |
| Requirements drift | `make check-requirements` | Passed at `7791409` and `77b243b` |
| pip install | `python3.12 -m venv`, `python -m pip install -r requirements.txt` | Passed; `pip check` found no broken requirements |
| Backend start from the pip venv | `python -m uvicorn app.main:app --host 127.0.0.1 --port 18000` | Started |
| Health check | `GET /health` | 200 `{"status":"ok","service":"assemblypilot-backend","version":"0.1.0"}` |
| API docs | `GET /docs` | 200 |
| Python lint | `uv run --frozen ruff check .` | Passed at `7791409` and `77b243b` |
| Python tests, uv | `uv run --frozen pytest` | 514 passed at `7791409` and `77b243b` |
| Python tests, pip | `python -m pytest` with `requirements-dev.txt` | 514 passed |
| Frontend install | `npm ci` | Passed |
| ESLint, type check | `npm run lint`, `npm run typecheck` | Passed |
| Frontend unit tests | `npm run test:unit` | 279 passed |
| Production build | `npm run build` | Passed, with an API URL and with an empty one |
| Pages | `/`, `/setup`, `/projects`, `/blocks`, `/settings`, `/ar` | 200 |
| Browser tests | `npx playwright test` | 148 passed |
| Demo project | `scripts/create_ar_demo.py` | Failed with 422 before the fix; passed afterwards on a fresh database |
| HTTPS proxy | `caddy validate` and `caddy run` on the documented variant | `/health`, `/ar` and `/api/projects` returned 200 through Caddy; `Permissions-Policy` present; a client without the root certificate was rejected |
| Secret audit | See [assets and licenses](assets-and-licenses.md#secret-and-privacy-audit) | No findings |
| Documentation links | Internal links, anchors, environment variables | Checked by script |
| Mermaid | Parsed with the Mermaid library | 4 diagrams parsed; not rendered visually |

Differences from the standard commands:

- Ports were 18000 and 13000 (and 13444 for Caddy), because development servers were using
  8000 and 3000 at the start of the check.
- For Playwright only, those ports were patched into a throwaway copy of the test
  configuration. The repository is unchanged. `make test-browser` itself was not run.
- The pip test run first showed 1 failure. The cause was `FRONTEND_ORIGIN` left set by the
  check script. With a clean environment, all 514 tests passed.

`npm audit` reports 0 production vulnerabilities and 8 moderate ones in development
tooling (`minimatch` through `eslint-config-next`). They are not fixed here.

## Skipped checks

| Check | Reason |
| --- | --- |
| Live Meta inference, `backend/smoke_*.py`, benchmark | Needs a key and billable requests; must be run by the owner. **So live inference was not verified in this check** |
| Physical camera and real recognition quality | Automated tests use a synthetic camera and mocks |
| HoloLens 2 device tests, trust on the device | No device attached. Device results are owner reports only |
| Caddy on port 443 with `sudo` | Needs root; only the template and the non-root variant were tested |
| Linux and Windows install | Only macOS arm64 was available |
| Details page and submission form | Require a signed-in session, which was not available |

## Blockers

Deadline: **November 4, 2026, 9:00 PM ET** (November 5, 03:00 CET).

| # | Blocker | Who | Next action |
| --- | --- | --- | --- |
| 1 | No demo video; Demo counts for 25% and the rules judge the video | Owner | Record and upload it ([demo plan](demo-plan.md)) |
| 2 | Form fields, video rules and repository rules not verified | Owner | Sign in to the portal and compare with the [checklist](submission-checklist.md) |
| 3 | The repository is **private** | Owner | Decide on access; visibility was not changed |
| 4 | This work is on local, unmerged branches | Owner | Review, push and merge. `main` lacks the report and `requirements.txt` |
| 5 | Asset rights are open, and the rules require ownership and no rights violation | Owner | Answer the [open questions](assets-and-licenses.md#open-questions-for-the-project-owner) |
| 6 | No live run is recorded in the repository | Owner | Run one real inspection with a key; record it |
| 7 | Track and theme not chosen | Owner | Choose them in the form |

## Draft project text

Every statement below is supported by this repository. Check the portal for length limits,
and only use the last sentence after a real device run.

> **AssemblyPilot** is a visual assembly assistant that checks physical work step by step.
> It shows the next step in a browser or as a WebXR hologram on HoloLens 2, looks at the real
> build through a camera, and uses Muse Spark to judge the step as correct, incorrect or
> uncertain. SAM 3.1 highlights the affected part when something is wrong, and optional local
> OpenCV checks can make a result stricter. A step only counts once a separate fresh image
> confirms it, and when the model cannot tell, the app says so and waits for the user instead
> of guessing. The current build is demonstrated with toy bricks. It uses FastAPI, Next.js,
> three.js and the Meta Model API, and includes a guided setup for your own parts.
