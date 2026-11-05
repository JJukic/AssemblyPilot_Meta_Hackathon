# Submission readiness

Recorded on 2026-11-05. **Status: submitted by owner.** The owner reports that the hackathon
portal is filled in. The repository is ready for a local test. The remaining owner tasks are
[listed below](#open).

Evidence in this file uses these terms:

| Term | Meaning |
| --- | --- |
| **Implemented** | In the code on `main` |
| **Tested locally** | Run on the owner's machine, with the commands and results recorded |
| **CI passed** | Verified on GitHub Actions for the named commit |
| **Owner-reported** | Stated by the project owner, with no record in this repository |
| **Historical** | A dated check of an older commit |
| **Open** | Still to be done or confirmed |

<a id="verified-state"></a>

## 🧪 Verified state

Checked on 2026-11-05 against GitHub.

| Item | Value |
| --- | --- |
| Application code on `main` | `13b516f`, the merge of pull request #16. Only documentation from `codex/readme-visual-polish` follows it |
| Pull request #15 | Merged to `main` as `aa21cee` on 2026-11-05 |
| Pull request #16 | Merged to `main` as `13b516f` on 2026-11-05, documentation only |
| CI on `13b516f` | Run 41942595313: `repository`, `demo`, `backend` and `frontend` passed |
| Repository | Public |
| Demo video | <https://youtu.be/QWZPpFY55rc>; YouTube reports it as publicly available (oEmbed, 2026-11-05), but it was not replayed in this check |
| Final render length | 166.9 s, recorded in [`CLIP_MAPPING.md`](../demo/remotion/CLIP_MAPPING.md) |

CI runs offline with mocks and a synthetic camera. **It does not test live Meta inference or a
HoloLens.**

<a id="status-by-area"></a>

## 🎯 Status by area

| Area | Status | Note |
| --- | --- | --- |
| Assembly workflow, Muse Spark and SAM 3.1 clients, WebXR | Implemented | See the [Technical Report](technical-report.md) |
| Install, lint, tests, build | CI passed | Run 41942595313 on `13b516f`; local results are in the [historical check](#historical-check-of-7cab24c) |
| Local start without a key | Tested locally | Health check only |
| Portal submission | Submitted by owner | Owner-reported. Form fields were not seen in this check |
| Live Muse inference | Owner-reported | No result is recorded in this repository |
| HoloLens 2 operation | Owner-reported | The video shows real captures; the [acceptance checklists](hololens.md) stay open |
| Real-photo benchmark | Open | Tooling exists, results do not |
| Asset and brand rights | Open | See [open questions](assets-and-licenses.md#open-questions-for-the-project-owner) |
| Cloud deployment | Not implemented | The project is started locally on purpose |

## Historical check of `7cab24c`

These results belong to commit `7cab24c`, the state before pull request #15 was merged. Later
commits changed documentation only. The check ran in a fresh `git clone` on macOS 26, arm64,
with Python 3.12.6, Node 24.10.0, npm 11.19.0 and uv 0.13.5. It used no `.env`, no
`MODEL_API_KEY` and no local data.

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
| Secrets in Git history | Searches for tracked `.env`, key, certificate and database files, and private keys | No findings |

`make check-repo` is a pattern search. It catches common mistakes and cannot prove that no
secret exists. Mermaid diagrams were not rendered.

## Documentation review on 2026-11-05

The `codex/readme-visual-polish` worktree was reviewed against `main` at `13b516f`.
The local tracked-file check and whitespace check passed. A scan of 154 local Markdown
links, including heading anchors, found no missing targets. The focused `auto-retry.test.cjs` and
`guided-flow.test.cjs` tests passed (27 tests) on the unchanged application code.
These checks cover simulated `uncertain` holds, explicit Check Again and guided completion;
they do not establish a new live Meta or HoloLens result.

<a id="not-checked"></a>

## ⚠️ Not checked

| Check | Reason |
| --- | --- |
| Live Meta inference, `backend/smoke_*.py`, benchmark | Needs a key and billable requests |
| Physical camera and recognition quality | Automated tests use a synthetic camera and mocks |
| HoloLens 2 device run | No device was attached |
| Caddy | Not re-run. The 2026-11-04 check passed with the non-root variant; port 443 with `sudo` was not tested |
| Linux install | Covered by CI only |
| Windows install | Not tested |
| Remotion render in a fresh clone | Needs the local recordings and audio, which are not in Git |
| Portal contents | Need the owner's session |

<a id="open"></a>

## ⚠️ Open

| # | Item | Next action |
| --- | --- | --- |
| 1 | Asset and brand rights are not confirmed, and the rules require that no third-party rights are violated | Answer the [open questions](assets-and-licenses.md#open-questions-for-the-project-owner) |
| 2 | No live run is recorded in the repository | Run one real inspection with a key and record it |
| 3 | The HoloLens acceptance checklists are not complete | Run them on the device and fill in the [final device test](final-device-test.md) |

## Project text prepared for the form

The owner entered the final text in the portal, and it may differ from this draft.

> **AssemblyPilot** is a visual assembly assistant that checks physical work step by step.
> It shows the next step in a browser or as a WebXR hologram on HoloLens 2, looks at the real
> build through a camera, and uses Muse Spark to judge the step as correct, incorrect or
> uncertain. SAM 3.1 highlights the affected part when something is wrong, and optional local
> OpenCV checks can make a result stricter. A step only counts once a separate fresh image
> confirms it, and when the model cannot tell, the app says so and waits for the user instead
> of guessing. The current build is demonstrated with toy bricks. It uses FastAPI, Next.js,
> three.js and the Meta Model API, and includes a guided setup for your own parts.
