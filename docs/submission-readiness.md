# Submission readiness

Recorded on 2026-11-05. **Status: the repository is ready for a local test, and the submission
is not complete.** The open points are [listed below](#open-before-submitting).

## Readiness by area

| Area | State |
| --- | --- |
| Local testing | **Ready.** A fresh clone installs, passes all checks and starts without a key |
| Real inference | Needs your own Meta key. **Not run in this check** |
| HoloLens testing | Documented. **Not run in this check**: no device was attached |
| Remotion demo | Rendered locally at 166.9 s. **Not uploaded** |
| Cloud deployment | **Not implemented.** A [future option](local-deployment.md#later-cloud-deployment) only |

## Checked state

| Item | Value |
| --- | --- |
| Branch | `codex/hackathon-submission-ready` |
| Checked commit | `7cab24c`. Later commits change documentation only |
| Environment | macOS 26, arm64, Python 3.12.6, Node 24.10.0, npm 11.19.0, uv 0.13.5 |
| Method | Fresh `git clone`, with no `.env`, no `MODEL_API_KEY` and no local data |

## Executed checks

| Check | Command | Result |
| --- | --- | --- |
| Install | `make install` | Passed |
| Requirements drift | `make check-requirements` | Passed |
| Tracked files | `make check-repo` | Passed |
| Lint | `make lint` | Passed |
| Tests | `make test` | 514 backend and 279 frontend unit tests passed |
| Build | `make build` | Passed |
| Browser tests | `make test-browser` | 148 passed |
| Remotion | `npm ci`, `npm run typecheck` in `demo/remotion` | Passed |
| pip install | `python3.12 -m venv`, `pip install -r requirements.txt -r requirements-dev.txt` | Passed; `pip check` clean |
| Python tests, pip | `python -m pytest` | 514 passed |
| Start without a key | `uvicorn` from the pip venv, then `GET /health` | 200, port 18000 |
| Internal links | Script over 10 Markdown files | 124 links, 0 problems |
| Secrets in Git history | Searches for tracked `.env`, key, certificate and database files, and private keys | No findings |

`make check-repo` is a pattern search. It catches common mistakes and cannot prove that no
secret exists. Mermaid diagrams were not rendered in this check. CI results for this branch
are on the GitHub Actions page.

## Skipped checks

| Check | Reason |
| --- | --- |
| Live Meta inference, `backend/smoke_*.py`, benchmark | Needs a key and billable requests, so **live inference was not verified here** |
| Physical camera and recognition quality | Automated tests use a synthetic camera and mocks |
| HoloLens 2 device run | No device attached. Device results are owner reports |
| Caddy | Not re-run. The 2026-11-04 record passed with the non-root variant; port 443 with `sudo` was not tested |
| Linux and Windows install | Only macOS arm64 was available locally. CI covers Linux |
| Remotion render in a fresh clone | Needs the local recordings and audio, which are not in Git |
| Details page and submission form | Need a signed-in session |

## Open before submitting

Deadline: **November 4, 2026, 9:00 PM ET** (November 5, 03:00 CET).

| # | Item | Next action |
| --- | --- | --- |
| 1 | The demo video is not uploaded, and no link exists | Upload `demo/remotion/out/assemblypilot-hackathon-demo.mp4` and add the link to the form |
| 2 | Form fields and video rules are not verified | Sign in and compare with the [checklist](submission-checklist.md) |
| 3 | This work is not on `main` | Review and merge, or name the branch in the form |
| 4 | Asset rights are open, and the rules require ownership | Answer the [open questions](assets-and-licenses.md#open-questions-for-the-project-owner) |
| 5 | No live run is recorded in the repository | Run one real inspection with a key and record it |
| 6 | Track and theme are not chosen | Choose them in the form |

## Draft project text

Every statement below is supported by this repository. Check the portal for length limits.

> **AssemblyPilot** is a visual assembly assistant that checks physical work step by step.
> It shows the next step in a browser or as a WebXR hologram on HoloLens 2, looks at the real
> build through a camera, and uses Muse Spark to judge the step as correct, incorrect or
> uncertain. SAM 3.1 highlights the affected part when something is wrong, and optional local
> OpenCV checks can make a result stricter. A step only counts once a separate fresh image
> confirms it, and when the model cannot tell, the app says so and waits for the user instead
> of guessing. The current build is demonstrated with toy bricks. It uses FastAPI, Next.js,
> three.js and the Meta Model API, and includes a guided setup for your own parts.
