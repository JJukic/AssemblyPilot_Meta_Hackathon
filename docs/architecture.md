# Phase 1 architecture

## Data flow

```text
Browser camera → live video → in-memory JPEG snapshot
Assembly JSON → Next.js server page → manual five-step guide
Browser health polling → FastAPI GET /health
Explicit multipart API request → image validation → HTTP 501 (no inference)
```

`data/assemblies/demo-lego.json` is the single source of assembly instructions. The server page imports it and passes typed serializable data to the client dashboard. No duplicate public JSON copy, database or additional assembly endpoint is needed.

The camera hook owns the MediaStream and request generation counter. Stopping, switching or unmounting invalidates pending permission requests and stops owned tracks. A late stream is immediately stopped. Device enumeration follows permission and updates on `devicechange`. Track `ended` events surface disconnection. The video is never mirrored, so captured frames preserve the build's spatial orientation. The browser stores one JPEG data URL; it does not store images in localStorage, send telemetry or upload frames.

The health client uses a five-second timeout, cancellation on unmount and a ten-second polling interval. It validates the service identity. Camera state is independent of network state.

## Backend boundaries

- `api/`: HTTP contract and error mapping. `/health` reports service availability, not model readiness. `/api/inspect` returns 501 only after successful validation.
- `services/image_processor.py`: bounded input reading at the endpoint, decoded format validation, pixel and dimension limits before full decode, Pillow bomb protection, corruption checks, EXIF normalization, proportional downscaling, alpha compositing, metadata removal.
- `services/meta_client.py`: Meta-only typed integration boundary. Calling it raises `NotImplementedError`; no request is sent and a key is not required.
- `agents/`: diagnosis, planning and verification roles with typed contracts. These are ordinary Python classes, not autonomous agents or external frameworks.
- `core/orchestrator.py`: explicit diagnosis/planning operation and separate verification operation that requires a new image after the human repair. Not connected to the Phase 1 endpoint.

Image decoding runs in a worker thread so it does not block FastAPI's event loop. Images are not persisted by application code. Multipart uploads may be transiently spooled by Starlette; public deployments need an upstream total request-body limit and authenticated/rate-limited access. No wildcard CORS is accepted. Source EXIF and other metadata are not copied to normalized JPEGs.

## Reproducibility

Node 24 and Python 3.12 are the development versions. npm and uv lockfiles pin resolved dependencies. `make install` uses frozen installs; CI runs lint, TypeScript, a production build, pytest and synthetic-camera browser tests. Build requires no remote fonts, model keys or GPU. Live processes must be started again after restoring a cloud snapshot.

## Phase 2: verify before integrating

Muse Spark is the intended future default, **not a verified API model identifier**. The supplied base URL is a configuration placeholder until confirmed through official Meta documentation and account access. The repository makes no assertion about that URL's capabilities. Before implementation:

1. Verify the official endpoint, available model ID, vision support, authentication, content limits and image payload schema.
2. Populate backend-only `MODEL_API_KEY`, `META_API_BASE_URL` and `META_VISION_MODEL` securely.
3. Implement the small Meta client with httpx, TLS verification, finite timeouts, bounded transient retries and Pydantic response parsing.
4. Require explicit user consent/action for uploads. Include the selected assembly instruction and real reference images only when available.
5. Add mocked contract tests and an opt-in real Meta integration test; never invent diagnosis results if the service is unavailable.
6. Expose uncertainty and failure states in the dashboard, then implement correction planning and verification using newly captured evidence.

SAM, Muse Image, smart glasses and autonomous loops remain outside Phase 1.
