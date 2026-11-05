# Submission checklist

Organizer rules checked on 2026-11-04 against the public event page and the Official Rules.
Repository status updated on 2026-11-05.

**Deadline: November 4, 2026, 9:00 PM ET.** On that date ET is EST (UTC−5), so this is
November 5, 2026, 02:00 UTC, or 03:00 CET. Dates may change at Meta's discretion; changes are
posted on the event page.

<a id="status-by-area"></a>

## 🎯 Status by area

| Status | Meaning |
| --- | --- |
| **Implemented** | In the code or documents on `main` |
| **Tested locally** | Run with recorded commands and results |
| **CI passed** | Verified on GitHub Actions for the named commit |
| **Owner-reported** | Stated by the project owner, with no record in this repository |
| **Submitted by owner** | The owner reports that the portal is filled in |
| **Historical** | A dated check of an older commit |
| **Open** | Still to be done or confirmed |
| **Not implemented** | Deliberately absent |

| Item | Status | Note |
| --- | --- | --- |
| Portal submission | Submitted by owner | Owner-reported. The portal contents were not seen in this check |
| GitHub link | Implemented | <https://github.com/JJukic/AssemblyPilot_Meta_Hackathon>, public. Pull request #15 is on `main` |
| README, Technical Report | Implemented | Checked against the code |
| Installation with uv and pip | Historical | Fresh clone at `7cab24c`, macOS arm64 |
| `requirements.txt` | Implemented | Generated from `uv.lock`, with hashes; checked by CI |
| CI status | CI passed | [GitHub Actions run 41942595313](https://github.com/JJukic/AssemblyPilot_Meta_Hackathon/actions/runs/41942595313) passed all four jobs on `13b516f`. It runs offline |
| License | Implemented | Apache-2.0 for the source; asset questions are open |
| Secrets | Historical | History searched on 2026-11-05 before `7cab24c`; `make check-repo` runs in CI |
| Automated tests, lint, build | Historical | Full counts at `7cab24c`; CI repeats them on `main` |
| Local browser demo, without a key | Historical | Start and health check only; checks show "Check unavailable" |
| Local browser demo, with a key | Owner-reported | Live Muse inference has no result recorded in this repository |
| HoloLens over Caddy | Historical | Proxy checked on 2026-11-04. No device was attached |
| HoloLens operation and recording | Owner-reported | Real capture in the video. The acceptance checklists are open |
| Meta model explanation | Implemented | README, report and video |
| Future vision | Implemented | Marked "FUTURE VISION · NOT IMPLEMENTED" in the video. Cooking is not in the code |
| Demo video | Implemented | Final render 166.9 s ([`CLIP_MAPPING.md`](../demo/remotion/CLIP_MAPPING.md)); YouTube link below |
| Actual video link | Implemented | <https://youtu.be/QWZPpFY55rc> |
| Asset and brand rights | Open | [Open questions](assets-and-licenses.md#open-questions-for-the-project-owner) |
| Cloud deployment | Not implemented | The project is started locally on purpose. [Requirements](local-deployment.md#later-cloud-deployment) only |

<a id="sources"></a>

## 📚 Sources

| ID | Source | Access |
| --- | --- | --- |
| EP | [Event page](https://cerebralvalley.ai/e/meta-ai-developer-hackathon) | Public, read |
| OR | [Official Rules and Event Waiver](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver) | Public, read |
| DP | [Details page](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details) | Loads only a shell without a session; **content not verified** |
| SP | [Submission portal](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit) | Shows a sign-in link without a session; **form fields not verified** |

No signed-in browser session was available for this check. The project owner must check DP
and SP while signed in.

The tables below come from the 2026-11-04 rules check and use these terms: **Done**, **Owner**
(the owner must do or confirm it), **Blocked** (missing), **Not verified** (the source could
not be read). **Owner-reported** marks what the owner has since reported.

## Confirmed organizer requirements

| Requirement | Source | Implementation or evidence | Status | Open work |
| --- | --- | --- | --- | --- |
| Submit by Nov 4, 2026, 9:00 PM ET | EP | Portal filled in, owner-reported; acceptance timestamp not independently checked | **Owner-reported** | Keep the portal receipt privately |
| Submit through the Cerebral Valley portal | OR | Portal URL above | **Submitted by owner** | None |
| Accepted applicant; Official Rules accepted | OR, EP | Owner's account | **Owner** | Confirm |
| Eligibility | OR, EP | Not checkable from the repository | **Owner** | Confirm |
| Enter exactly one of two tracks | OR, EP | Portal filled in, owner-reported; selected track not recorded here | **Owner** | Keep the selected track in the private submission record |
| Team: Representative submits and names the members. Indie: up to 4 people | OR | Commit authors show one person | **Owner** | Confirm the team |
| Build with Meta AI products | OR, EP | Muse Spark and SAM 3.1: `meta_client.py`, `sam_client.py` | Done | None |
| Original work, solely owned, no third-party rights violated | OR | First commit 2026-10-26; assets are open | **Blocked** | [Open asset questions](assets-and-licenses.md#open-questions-for-the-project-owner) |
| Open-source parts allowed if their licenses are followed and the project builds on them | OR | [Dependency inventory](assets-and-licenses.md#dependencies) | Done | Review `meta-sam-parser` terms |
| Grant the Organizers the license on the submission | OR | Rules text | **Owner** | Read before submitting |

<a id="judging-criteria"></a>

## 🎯 Judging criteria

Weights come from OR and apply to submitted projects. EP also has shorter track descriptions.

| Criterion | Weight | Evidence | Status | Open work |
| --- | --- | --- | --- | --- |
| Impact, including fit with a problem statement | 30% | [README](../README.md#problem-audience-and-value) | **Owner-reported** | Portal filled in; selected theme not recorded here. Real-world evidence is limited to a toy-brick demonstration |
| Use of Meta AI tooling | 25% | Muse with strict schema, SAM localization, closed verification loop: [report](technical-report.md) | Done | Show it in the video |
| Technical depth and execution | 20% | [Report](technical-report.md), tests in [readiness](submission-readiness.md) | Done | None |
| Demo: working demo, holds up live, video quality | 25% | [Demo video](https://youtu.be/QWZPpFY55rc) | **Owner-reported** | None |

## Not confirmed by any readable source

This is the state of the 2026-11-04 check. The owner has since filled in the form.

| Field | Source to check | Status |
| --- | --- | --- |
| Project title, tagline and description limits | SP | Not verified |
| Repository URL required, and whether it must be public | SP, DP | Not verified. The repository is public (checked on 2026-11-05) |
| Demo video required, length, format, host | SP, DP | Not verified. OR judges "the quality of the demo video". Treat it as required: the link exists |
| Images, team fields, track selection, problem statement | SP | Not verified |
| Live presentation for finalists (Nov 9 closing ceremony) | EP, DP | EP says "live finals"; details are not verified |

The rules name "Muse Spark, Glimmer, SAM 3" and EP names "Muse Spark series, Muse Wonder,
Muse Image and SAM 3.1". This project uses `muse-spark-1.3` and `sam-3.1`.

<a id="our-own-quality-goals"></a>

## ✨ Our own quality goals

These are project goals, not organizer requirements.

| Goal | Evidence | Status | Open work |
| --- | --- | --- | --- |
| Reproducible install with uv and pip | [Readiness](submission-readiness.md), CI check | Done | None |
| Jury can rebuild without a HoloLens | [Jury quickstart](jury-quickstart.md) | Done, without live inference | Record one run with a real key |
| Claims backed by code or records | [Report](technical-report.md) | Done | None |
| No secrets in the repository | [Audit](assets-and-licenses.md#secret-and-privacy-audit) | Done | None |
| Live smoke test recorded | `backend/smoke_*.py` | **Owner** | Run with a real key and record the result |
| HoloLens acceptance checklists completed | [HoloLens guide](hololens.md), [final device test](final-device-test.md) | **Owner** | Run on the device and fill in the result |
