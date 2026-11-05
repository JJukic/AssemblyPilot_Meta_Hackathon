# Submission checklist

Organizer rules checked on 2026-11-04 against the public event page and the Official Rules.
Repository status updated on 2026-11-05.

**Deadline: November 4, 2026, 9:00 PM ET.** On that date ET is EST (UTC−5), so this is
November 5, 2026, 02:00 UTC, or 03:00 CET. Dates may change at Meta's discretion; changes are
posted on the event page.

## Status by area

| Status | Meaning |
| --- | --- |
| **Done** | Implemented in this repository |
| **Checked locally** | Run on the owner's machine, with the evidence in [Submission readiness](submission-readiness.md) |
| **Open** | Must happen before submitting |
| **Later** | Planned, not needed for this submission |
| **Video only** | Shown in the demo video, not provided for the jury to run |

| Item | Status | Note |
| --- | --- | --- |
| GitHub link | Done | <https://github.com/JJukic/AssemblyPilot_Meta_Hackathon>, public. This work is on `main` |
| README | Done | Links to the report, quickstart and this list |
| Technical Report | Done | Checked against the code |
| Installation with uv and pip | Checked locally | Fresh clone, macOS arm64 |
| `requirements.txt` | Checked locally | Generated from `uv.lock`, with hashes |
| CI status | Checked locally | GitHub Actions passed all four jobs on commit `a6bfe74` (run 41935563210) |
| License | Done | Apache-2.0 for the source; asset questions remain below |
| Secrets | Checked locally | Tracked files and history searched; `make check-repo` runs in CI |
| Automated tests, lint, build | Checked locally | Without a key; live Meta requests never run in CI |
| Local browser demo, without a key | Checked locally | Start and health check only; checks show "Check unavailable" |
| Local browser demo, with a key | Open | Needs your own key and a real run |
| HoloLens over Caddy | Open | The proxy was checked earlier; a current device run is not recorded |
| HoloLens recording | Video only | Real Mixed Reality Capture, local only |
| Meta model explanation | Done | README, report and video |
| Future vision | Video only | Marked "Future vision, not implemented" in the video; cooking is not in the code |
| Demo video | Done | Final render 166.9 s, uploaded to YouTube |
| Actual video link | Done | <https://youtu.be/QWZPpFY55rc>, reachable without signing in |
| Submission form | Done | Sent by the owner on 2026-11-05, as reported by the owner |
| Cloud deployment | Later | [Requirements](local-deployment.md#later-cloud-deployment) only, nothing implemented |

## Sources

| ID | Source | Access |
| --- | --- | --- |
| EP | [Event page](https://cerebralvalley.ai/e/meta-ai-developer-hackathon) | Public, read |
| OR | [Official Rules and Event Waiver](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver) | Public, read |
| DP | [Details page](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details) | Loads only a shell without a session; **content not verified** |
| SP | [Submission portal](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit) | Shows a sign-in link without a session; **form fields not verified** |

No signed-in browser session was available for this check. The project owner must check DP
and SP while signed in.

Status terms: **Done**, **Owner** (the owner must do or confirm it), **Blocked** (missing),
**Not verified** (the source could not be read).

## Confirmed organizer requirements

| Requirement | Source | Implementation or evidence | Status | Open work |
| --- | --- | --- | --- | --- |
| Submit by Nov 4, 2026, 9:00 PM ET | EP | Key dates | **Owner** | Submit in time |
| Submit through the Cerebral Valley portal | OR | Portal URL above | **Owner** | Sign in and submit |
| Accepted applicant; Official Rules accepted | OR, EP | Owner's account | **Owner** | Confirm |
| Eligibility | OR, EP | Not checkable from the repository | **Owner** | Confirm |
| Enter exactly one of two tracks | OR, EP | Not decided in the repository | **Owner** | Choose Indie Developer or Startup |
| Team: Representative submits and names the members. Indie: up to 4 people | OR | Commit authors show one person | **Owner** | Confirm the team |
| Build with Meta AI products | OR, EP | Muse Spark and SAM 3.1: `meta_client.py`, `sam_client.py` | Done | None |
| Original work, solely owned, no third-party rights violated | OR | First commit 2026-10-26; assets are open | **Blocked** | [Open asset questions](assets-and-licenses.md#open-questions-for-the-project-owner) |
| Open-source parts allowed if their licenses are followed and the project builds on them | OR | [Dependency inventory](assets-and-licenses.md#dependencies) | Done | Review `meta-sam-parser` terms |
| Grant the Organizers the license on the submission | OR | Rules text | **Owner** | Read before submitting |

## Judging criteria

Weights come from OR and apply to submitted projects. EP also has shorter track descriptions.

| Criterion | Weight | Evidence | Status | Open work |
| --- | --- | --- | --- | --- |
| Impact, including fit with a problem statement | 30% | [README](../README.md#problem-audience-and-value) | **Owner** | Choose a theme: EP lists "Build for Your World" and "Push the Frontier". Real-world evidence is limited to a toy-brick demonstration |
| Use of Meta AI tooling | 25% | Muse with strict schema, SAM localization, closed verification loop: [report](technical-report.md) | Done | Show it in the video |
| Technical depth and execution | 20% | [Report](technical-report.md), tests in [readiness](submission-readiness.md) | Done | None |
| Demo: working demo, holds up live, video quality | 25% | [Demo video](https://youtu.be/QWZPpFY55rc) | **Owner** | Add the link to the form |

## Not confirmed by any readable source

| Field | Source to check | Status |
| --- | --- | --- |
| Project title, tagline and description limits | SP | Not verified |
| Repository URL required, and whether it must be public | SP, DP | Not verified. The repository is public (checked on 2026-11-05) |
| Demo video required, length, format, host | SP, DP | Not verified. OR judges "the quality of the demo video". Treat it as required: until a video link exists, the submission is **incomplete** |
| Images, team fields, track selection, problem statement | SP | Not verified |
| Live presentation for finalists (Nov 9 closing ceremony) | EP, DP | EP says "live finals"; details are not verified |

The rules name "Muse Spark, Glimmer, SAM 3" and EP names "Muse Spark series, Muse Wonder,
Muse Image and SAM 3.1". This project uses `muse-spark-1.3` and `sam-3.1`.

## Our own quality goals

These are project goals, not organizer requirements.

| Goal | Evidence | Status | Open work |
| --- | --- | --- | --- |
| Reproducible install with uv and pip | [Readiness](submission-readiness.md), CI check | Done | None |
| Jury can rebuild without a HoloLens | [Jury quickstart](jury-quickstart.md) | Done, without live inference | Run it once with a real key |
| Claims backed by code or records | [Report](technical-report.md) | Done | None |
| No secrets in the repository | [Audit](assets-and-licenses.md#secret-and-privacy-audit) | Done | None |
| Live smoke test recorded | `backend/smoke_*.py` | **Owner** | Run with a real key and record the result |
| HoloLens acceptance checklists completed | [HoloLens guide](hololens.md) | **Owner** | Run on the device |
