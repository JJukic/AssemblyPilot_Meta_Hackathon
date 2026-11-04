# Assets and licenses

Checked on 2026-11-04. This is a technical inventory, not legal advice.

## Project license

The source code is under the Apache License 2.0 ([LICENSE](../LICENSE)), and GitHub detects
it as such. The file is the unmodified license text. The repository has no `NOTICE` file.

The license covers what the project owner may license. It does not by itself establish
rights in the assets below.

## Bundled assets

| File | SHA-256 (start) | Origin on record | Use | Status |
| --- | --- | --- | --- | --- |
| `frontend/public/assets/meta-mascot-animated.glb` | `99ce1939` | "User-supplied Meshy GLB" (`completion-mascot.md`); 24.6 MB | Completion hologram | **Open** |
| `frontend/public/assets/Meshy_AI_brick_figure_concept.png` | `87a05927` | "Supplied concept image" (commit `5f4d8af`); the file name points to Meshy | Source of `meta-mascot.png`; not referenced by the application | **Open** |
| `frontend/public/assets/meta-mascot.png` | `2868dd1f` | Derived from the concept image (commit `5f4d8af`) | Header brand image | **Open** |

The repository contains no font files and no sample photographs. Reference photos are
created by each user and stored in the ignored `backend/data/`.

## Open questions for the project owner

The Official Rules require that a submission is original, solely owned, and does not violate
third-party rights, including trademarks. They allow open-source components when their
licenses are followed. These points need the owner's confirmation before submitting:

1. **Meshy output:** which Meshy plan and terms applied when the concept image and GLB were
   generated, and do they permit publication under this repository's terms?
2. **"Meta" in the mascot:** the UI labels the image "Meta mascot" (`alt="Meta mascot"` in
   `Brand.tsx`) and the file names use "meta". Does the figure use any Meta brand, and is
   that use permitted? The rules mention the use of name and logo only for the Organizers'
   publicity; they grant participants no trademark right.
3. **LEGO:** "LEGO" is a trademark of the LEGO Group. The repository uses it in
   `data/assemblies/demo-lego.json` ("LEGO Demo Assembly") and in descriptive text. Consider
   "compatible bricks" or "toy bricks" in the UI and video. The word appears in app data, so
   changing it is a separate decision. Do not show LEGO logos or sets as if endorsed.
4. **Concept image:** the PNG is not used at runtime. Remove it from the repository if it is
   not needed for attribution. Removal does not erase it from Git history.

Until these are answered, the assets are **not** claimed to be Apache-2.0 licensed.

## Dependencies

Installed versions from `backend/requirements.txt` and `frontend/package-lock.json`. Licenses
are the packages' own metadata. Transitive npm packages are not listed. The installed
packages include their own license files.

| Package | Version | License metadata |
| --- | --- | --- |
| `meta-sam-parser` | 0.1.0 | **SAM License** (Meta; not an OSI license) |
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

`meta-sam-parser` is installed from PyPI and is not vendored here. Its license applies to
use and redistribution of the package, and it restricts certain uses, including military and
weapons-related ones, and trade-control violations. Anyone redistributing the package must
include its license.

## External services and tools

- **Meta Model API:** use requires your own account and is governed by Meta's terms.
  `muse-spark-1.3` and `sam-3.1` are hosted, not distributed with this repository.
- **Caddy, uv, Node.js, Whisper:** installed separately under their own licenses.
- **Mixed Reality Capture, Remotion:** planned for the demo only and not part of the
  repository. Check Remotion's license for your use before using it.

## Secret and privacy audit

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
