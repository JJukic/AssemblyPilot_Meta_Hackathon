# Assets and licenses

Checked on 2026-11-04, and updated on 2026-11-05. This is a technical inventory, not legal
advice. Nothing below is marked as cleared unless a record in this repository shows it.

Status terms: **Done** (confirmed in this repository), **Open** (the owner must confirm it).

Owner update on 2026-11-05: Meshy.ai was used for the model and ElevenLabs was accessed
through MCP. This confirms the services used. The plan active when each asset was generated
and the origin of the original mascot reference image are still not recorded.

<a id="project-license"></a>

## ⚖️ Project license

The source code is under the Apache License 2.0 ([LICENSE](../LICENSE)), and GitHub detects
it as such. The file is the unmodified license text. The repository has no `NOTICE` file.

The license covers what the project owner may license. It does not by itself establish
rights in the assets below.

<a id="bundled-assets"></a>

## ⚖️ Bundled assets

| File | SHA-256 (start) | Origin on record | Use | Status |
| --- | --- | --- | --- | --- |
| `frontend/public/assets/meta-mascot-animated.glb` | `99ce1939` | "User-supplied Meshy GLB" (`completion-mascot.md`); 24.6 MB. Meshy plan not on record | Completion hologram | **Open** |
| `frontend/public/assets/Meshy_AI_brick_figure_concept.png` | `87a05927` | "Supplied concept image" (commit `5f4d8af`); the file name points to Meshy. Meshy plan not on record | Source of `meta-mascot.png`; not referenced by the application | **Open** |
| `frontend/public/assets/meta-mascot.png` | `2868dd1f` | Derived from the concept image (commit `5f4d8af`) | Header brand image | **Open** |

The repository contains no sample photographs. Reference photos are created by each user and
stored in the ignored `backend/data/`.

### Demo video project

| File | Origin | Status |
| --- | --- | --- |
| `demo/remotion/public/fonts/` | Inter and JetBrains Mono, SIL Open Font License; license texts are alongside | Done |
| `demo/remotion/public/architecture/` | Made for this project | Done |
| `docs/assets/stack/` | Generic pictograms made for this project, no logos | Done |
| Voice-over, in the published video | Generated with ElevenLabs, voice "Kayleigh - Poised Tech Tutorial Narrator", model `eleven_v4` | **Open**: plan and public or commercial use not on record |
| Music and UI sounds, local only | Synthesized by `scripts/generate-audio.ts` | Done |
| Recordings, in the published video | The owner's own recordings | **Open**: printed texts on the bricks are visible |

Remotion 4.0.540 has its own license. **Open:** confirm the applicable terms for this
project using the [Remotion license](https://www.remotion.dev/license).

<a id="open-questions-for-the-project-owner"></a>

## ⚠️ Open questions for the project owner

The Official Rules require that a submission is original, solely owned, and does not violate
third-party rights, including trademarks. They allow open-source components when their
licenses are followed. The following confirmations remain open after the owner-reported
portal submission:

1. **Meshy output:** which Meshy plan applied when the concept image and the GLB were generated?
   Rights and attribution can differ by plan, so a free plan and a paid plan must not be
   assumed to have the same terms. Confirm the plan, then whether attribution is required and
   whether publication under this repository's terms is permitted. This repository makes no
   claim about the plan.
2. **"Meta" in the mascot:** the UI labels the image "Meta mascot" (`alt="Meta mascot"` in
   `Brand.tsx`) and the file names use "meta". **The mascot is not an official Meta asset**,
   and no permission is on record. Does the figure use any Meta brand, and is that use
   permitted? The rules mention the use of name and logo only for the Organizers' publicity;
   they grant participants no trademark right. See
   [Names and trademarks](#names-and-trademarks).
3. **LEGO:** "LEGO" is a trademark of the LEGO Group. The repository uses it in
   `data/assemblies/demo-lego.json` ("LEGO Demo Assembly"), in descriptive text and in the
   video. Saying what the parts are is a different matter from using the logo or brand, which
   this project does not do on purpose. The rights question is not resolved, so "toy bricks"
   or "compatible bricks" remain a possible safer wording. The word appears in app data, so
   changing it is a separate decision. Do not show LEGO logos or sets as if endorsed.
4. **Concept image:** the PNG is not used at runtime. Remove it from the repository if it is
   not needed for attribution. Removal does not erase it from Git history.
5. **Video content:** the voice-over and video say "LEGO", and the footage shows the printed
   texts "Involve Me", "Give Me Details" and "insights" on the bricks. Confirm that these may be
   shown.
6. **ElevenLabs:** which plan generated the voice-over, and does it cover public and commercial
   use of this voice in the published video? Nothing about the plan is on record.
7. **Remotion:** confirm that the free license applies, or obtain a company license.

<a id="names-and-trademarks"></a>

## ⚖️ Names and trademarks

AssemblyPilot is an independent hackathon project. It claims no partnership, sponsorship or
endorsement by Meta, Microsoft, the LEGO Group or any other company.

| Name | Use here | Not claimed |
| --- | --- | --- |
| Meta, Muse Spark, SAM 3.1 | Factual: the models and API this project calls | Partnership, or that the mascot is official |
| HoloLens | Factual: the device used | Microsoft endorsement |
| LEGO | Factual description of the demo parts | Logo or brand use, or an official relationship |

Until these are answered, the assets are **not** claimed to be Apache-2.0 licensed.

<a id="dependencies"></a>

## 📚 Dependencies

Installed versions from `backend/requirements.txt` and `frontend/package-lock.json`. Licenses
are the packages' own metadata. Transitive npm packages are not listed. The installed
packages include their own license files.

| Package | Version | License metadata |
| --- | --- | --- |
| `meta-sam-parser` | 0.1.0 | **SAM License** (Meta, last updated November 19, 2025; not an OSI license) |
| `fastapi` | 0.162.0 | MIT |
| `uvicorn` | 0.54.0 | BSD-3-Clause |
| `pydantic` | 2.14.1 | MIT |
| `pydantic-settings` | 2.16.1 | MIT |
| `sqlmodel` | 0.0.48 | MIT |
| `sqlalchemy` | 2.0.55 | MIT |
| `httpx` | 0.28.1 | BSD |
| `pillow` | 12.3.0 | MIT-CMU |
| `python-multipart` | 0.0.32 | Apache-2.0 |
| `numpy` | 2.5.4 | BSD-3-Clause and others |
| `opencv-contrib-python-headless` | 4.14.0.94 | Apache-2.0; wheels bundle further native libraries with their own licenses |
| `certifi` | 2026.10.23 | MPL-2.0 |
| `next` | 16.4.3 | MIT |
| `react`, `react-dom` | 19.3.1 | MIT |
| `three` | 0.187.0 | MIT |
| `lucide-react` | 1.61.0 | ISC |
| `tailwindcss` (dev) | 4.3.3 | MIT |
| `typescript` (dev) | 5.9.3 | Apache-2.0 |
| `@playwright/test` (dev) | 1.64.1 | Apache-2.0 |

`meta-sam-parser` is installed from PyPI and is not vendored here. Its license was read from the
installed package on 2026-11-05. It applies to use and redistribution of the package, and it
restricts certain uses, including military and weapons-related ones, and trade-control
violations. Anyone who distributes the package or a derivative must do so under that license
and provide a copy of it. This repository only pins the package by version and hash, so it
distributes no copy. **Open:** repeat this check if the package is ever vendored or bundled.

## External services and tools

- **Meta Model API:** use requires your own account and is governed by Meta's terms.
  `muse-spark-1.3` and `sam-3.1` are hosted, not distributed with this repository.
- **Caddy, uv, Node.js, Whisper:** installed separately under their own licenses.
- **Mixed Reality Capture, ElevenLabs:** used for the demo video only.
- **Remotion:** used in `demo/remotion/`, under its own license. See [Demo video project](#demo-video-project).

<a id="secret-and-privacy-audit"></a>

## 🔐 Secret and privacy audit

Checked on 2026-11-04 with pattern searches over all tracked files and the full Git history.

| Check | Result |
| --- | --- |
| Tracked `.env` files | Only `backend/.env.example` and `frontend/.env.example`, with placeholders |
| API-key-like and private-key patterns in tracked files | None found |
| Same patterns in all branches' history | None found |
| Tracked `.pem`, `.key`, `.db` or `.env` files in history | None found |
| Local databases and uploads | `backend/data/` is ignored; nothing is tracked |
| Local certificates | `.local-https/` is ignored; `.gitignore` now also covers `*.pem`, `*.key`, `*.crt`, `*.p12`, `*.pfx` |
| Personal recordings or photos | None tracked |
| Private IPs | `frontend/next.config.ts` contains two private LAN addresses, which are not reachable from the internet |

A pattern search cannot prove the absence of every secret. Rotate any key that was ever
pasted into a chat, log or screenshot.
