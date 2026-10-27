# Registry API (Phase 2)

The API runs locally on port 8000. No credentials or model calls are needed. JSON bodies are validated with separate Pydantic schemas. Unknown entities return 404; invalid fields return 422; reference/order conflicts return 409. DELETE returns 204. New entities/images return 201. Updates use PUT with the full editable entity fields; IDs and timestamps cannot be supplied by clients.

| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/blocks` | GET, POST | List/search or register blocks |
| `/api/blocks/{id}` | GET, PUT, DELETE | Read/update/delete a reusable block |
| `/api/blocks/{id}/images` | POST | Explicitly upload a block reference photo |
| `/api/projects` | GET, POST | List or create projects |
| `/api/projects/{id}` | GET, PUT, DELETE | Project details (including ordered steps), update or delete |
| `/api/projects/{id}/steps` | GET, POST | List ordered steps or insert a step |
| `/api/projects/{id}/steps/order` | PUT | Atomically replace the complete step order |
| `/api/projects/{id}/steps/{step_id}` | PUT, DELETE | Edit/move/delete a step |
| `/api/projects/{id}/steps/{step_id}/images` | POST | Upload a correct step photo |
| `/api/projects/{id}/steps/{step_id}/reference-image` | PUT | Select an existing photo owned by this step; body `{"image_id":"UUID"}` |
| `/api/projects/{id}/steps/{step_id}/context` | GET | Prepare selected-step inspection metadata (no inference) |
| `/api/media/{image_id}` | GET, DELETE | Retrieve/delete a known registered reference image |
| `/health` | GET | Existing Phase 1 health contract |
| `/api/inspect` | POST | Context-aware Meta inspection; legacy image-only requests return 501 |

## Blocks

Example POST/PUT body:

```json
{
  "name": "Blue 2x4 brick",
  "description": "A reusable base piece",
  "category": "brick",
  "color": "blue",
  "shape": "rectangular",
  "studs_x": 2,
  "studs_y": 4,
  "height_mm": 9.6,
  "default_quantity": 2
}
```

Names and category/color/shape strings cannot be blank. Dimensions are optional and nonnegative; quantities are positive integers. Categories are free text, not a fragile fixed enum. IDs are generated UUID strings. Responses include creation/update timestamps and `reference_images` with public media URLs.

GET supports `?search=blue` (name, color or category substring), `?color=blue` and `?category=brick` (case-insensitive exact filters). Combined filters intersect. The frontend also provides instant filtering of the loaded local collection.

## Projects and steps

Project POST/PUT: `{"name":"Bridge","description":"My repeatable build"}`.

Step POST/PUT:

```json
{
  "title": "Build the base",
  "instruction": "Place two blue bricks side by side.",
  "required_blocks": [{"block_id":"<registered UUID>","required_quantity":2}]
}
```

Steps use contiguous **one-based positions**. POST appends by default; optional `position` inserts at an existing position or the end. PUT preserves position unless supplied. A PUT replaces block assignments; an empty list removes them. Duplicate block IDs are rejected, and invalid references roll the entire operation back. Steps cannot be accessed through another project's URL.

`PUT /api/projects/{id}/steps/order` accepts `{"step_ids":["<first UUID>","<second UUID>"]}`. Supply every current step exactly once. A stale/partial order is rejected with 409 so newly added steps cannot silently disappear. Updates are serialized inside SQLite transactions.

## Photos

Upload multipart field **image**, e.g.:

```sh
curl -F 'image=@/path/to/real-reference.png' http://localhost:8000/api/blocks/BLOCK_ID/images
```

File extensions and uploaded MIME types are not trusted. Existing Pillow validation enforces supported formats, byte/dimension limits and decoding safety. Accepted images are normalized to JPEG with EXIF removed and written under exclusive generated filenames. Original filenames are display metadata only and are stripped of path/control characters.

The response includes `id`, `owner_type`, `owner_id`, `url`, `original_filename`, `mime_type`, `width`, `height`, and `created_at`. GET media only serves a recorded JPEG under the configured upload directory; traversal, absolute paths and symlink escapes are rejected. Block photos use deterministic creation order. Step photos put the selected reference first; the dashboard and inspection use this photo.

Images are not BLOBs in SQLite. The frontend does not receive `storage_path`, database paths or upload-directory locations. No bulk camera upload is introduced.

Step photo lists return the selected image first, then remaining images in creation order.
`PUT .../reference-image` validates project/step ownership and rejects another step's or
block's photo with 404. Selection is persisted in an additive `step_reference_selections`
table; startup creates it for existing databases without modifying their tables or photos.
The workspace, inspection context and actual multimodal image request use the same selected
photo. Without a selection, or after deleting the selected photo, the oldest remaining photo
is used. Changing the selection retains all photos.

## Inspection context

GET context returns project and step identity, title/instruction, the current step's expected blocks with physical definitions and required quantities, their reference metadata, and current step reference metadata/URLs. Unrelated blocks/projects are excluded. `snapshot` and `previous_context` are null on GET.

For optional intermediate context, Python can call `build_inspection_context(session, project_id, step_id, snapshot, previous_context)`. The snapshot is a validated `ProcessedImage`, converted into a typed in-memory `CameraFrame` containing JPEG base64 and dimensions. It is never stored. `PreviousInspection` accepts a previous step ID and bounded notes. The resulting Pydantic schema is an intermediate representation, not a prompt containing ORM objects. Phase 3A uses the metadata resolver plus `build_multimodal_request` to load only permitted reference bytes. `/api/inspect` accepts the camera image and both IDs, then calls Meta; see [inspection API](inspection-api.md).
