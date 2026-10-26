# AssemblyPilot architecture — Phase 2

## Components

```text
Browser camera → live preview → in-memory snapshot (unchanged Phase 1)
Block/project forms → FastAPI → SQLModel/SQLAlchemy → local SQLite
Explicit photo upload → Pillow validation → generated JPEG file + SQLite metadata
Project selector → ordered steps/expected blocks/reference URLs → manual camera guide
Selected step → inspection_context service → typed intermediate schema (no inference)
```

Next.js App Router provides `/`, `/blocks`, `/projects`, and `/projects/[projectId]`. Interactive management components use a typed API client and reusable image uploader. Dynamic route parameters are awaited on the server. Client fetches display loading/error/empty states; project switching does not remount the camera hook. The five-step JSON demo remains a fallback and is not seeded into or synchronized with the database.

## Persistence and ownership

`db/tables.py` contains internal SQLModel tables; external API models live in `models/`. Routes acquire database sessions via dependency injection. The FastAPI lifespan creates missing tables, enables foreign keys and prepares the upload directory. Relative database/upload paths and `.env` always resolve from the backend root. No module import or test collection creates a database.

| Table | Relationships / constraints |
| --- | --- |
| `building_blocks` | UUID ID; nonempty name; physical properties; positive default quantity; timestamps |
| `assembly_projects` | UUID ID; nonempty name; description and timestamps |
| `assembly_steps` | Project FK with cascade delete; unique `(project_id, position)`; positive positions; title/instruction |
| `assembly_step_blocks` | Step FK with cascade delete; block FK with RESTRICT; unique `(step_id, block_id)`; positive required quantity |
| `reference_images` | Exactly one concrete block/step FK (XOR CHECK); cascade delete; unique generated storage filename; display filename, dimensions, MIME, timestamp |

A reference image cannot have no owner, two owners or a nonexistent owner. Foreign keys are enabled on every SQLite connection, including tests. API responses serialize explicit Pydantic schemas; local file paths never leave the backend.

Mutation dependencies begin `BEGIN IMMEDIATE` before reading, serialize SQLite writers, and commit before the HTTP response is sent. Step ordering uses two passes through temporary positive positions to avoid transient unique-index collisions. Failed assignment/reorder mutations roll back. Full entity edits use last-write-wins semantics; this is a local single-user MVP, not collaborative editing.

## Files and deletion

The existing image processor checks encoded size, formats, dimensions, decompression safety and corruption; applies EXIF orientation; resizes proportionately; flattens transparency; and emits metadata-free JPEG bytes. Reference uploads run in synchronous FastAPI worker threads, under bounded reads. Every stored name is a generated UUID with `.jpg`; exclusive creation prevents overwrites.

GET media requires a database record and a safe file under the upload root. Arbitrary paths and symlink escapes are rejected. Original filenames are sanitized display metadata, never storage addresses. The default backend remains loopback-bound with explicit CORS; no authentication/public deployment is provided.

Deleting a project cascades only its steps, assignments and step image records. Reusable blocks and their photos survive. Deleting a referenced block returns 409. Deleting a step also compacts remaining order. Image files are scheduled for removal after a successful database commit; new files are removed on rollback. Crash/IO failure can leave an unreachable orphan file because SQLite and the filesystem cannot commit atomically; failures are logged. There is no automatic orphan scan or destructive startup cleanup. See README for backup/deletion details.

## Future Meta boundary

`services/inspection_context.py` resolves only the selected step's registered definitions, quantities and reference metadata into `models/inspection_context.py`. A normalized camera frame and optional previous context can be attached in memory at inspection time. GET context returns metadata without a snapshot. No API credentials or frames are stored in SQLite. `/api/inspect` preserves Phase 1 behavior: validate an image, then HTTP 501. Meta client/agent interfaces remain explicit unimplemented boundaries.

The next phase is Meta Vision integration, after verifying official endpoint, authentication, vision payload, model ID and response schema. Muse Spark is an intended future model name, not a verified API identifier. No SDK capabilities are assumed. Integrate timeouts, bounded retries, validated responses and explicit user-triggered uploads; verify a repair using a new frame after the human correction. SAM, generation, smart glasses and autonomous loops remain out of scope.

## Testing and local operation

Existing `make install`, `make dev-backend`, `make dev-frontend`, `make lint`, `make test`, and `make build` remain valid. Locked dependencies include SQLModel and SQLAlchemy. Python tests override settings with per-test temporary SQLite databases/uploads and exercise API behavior, DB constraints, persistence after restart, filesystem cleanup, rollback and contextual data scoping.

Playwright starts `backend/browser_test_server.py`, which runs the API with a disposable temporary database and upload directory. It refuses an already-running backend on port 8000 rather than reuse user data. The frontend CI job installs backend dependencies as well. The browser suite preserves all original synthetic-camera tests and adds the complete registry/project workflow against the real isolated API. Physical-camera compatibility still requires local hardware validation.

SQLite `create_all` initializes a new schema; it is not a migration system. Keep database/files outside Git and back up both before future schema changes. No external service, cloud sync or GPU is required.
