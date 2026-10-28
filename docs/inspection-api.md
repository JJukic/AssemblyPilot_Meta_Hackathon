# Phase 3B inspection API

`POST /api/inspect` accepts multipart `image`, `project_id`, `step_id`. The step must belong to that project. The frontend sends no duplicated block specifications or reference URLs; SQLite is authoritative. `GET /api/projects/{project_id}/steps/{step_id}/context` remains a metadata-only endpoint with no inference.

## Response

HTTP 200 returns `InspectionResponse` (the diagnostic fields remain at the top level), with all fields required. Nullable fields must explicitly be null rather than receive manufactured defaults.

| Field | Contract |
| --- | --- |
| `step_id` | Exactly the requested registered step |
| `status` | `correct`, `incorrect`, `uncertain` |
| `confidence` | Finite number 0–1 or null; model estimate, not calibrated probability |
| `visible_blocks` | Array of `{block_id, description, estimated_count}`; registered ID or null, nonnegative integer count or null |
| `issues` | Array of `{type, block_id, description, expected, observed, suggested_fix, bounding_box}` |
| `explanation` | Nonempty bounded text explaining visual evidence |
| `next_action` | Nonempty bounded next action; no automatic step transition |
| `active_vision` | For uncertain only: `{reason, requested_view, instruction}`; otherwise null |
| `analyzed_snapshot` | Backend-owned `{data_url, width, height}`: exact normalized JPEG sent as the current frame to Meta |
| `model` | Configured Meta model ID, supplied by backend |
| `model_latency_ms` | Backend monotonic duration of the adapter call, including retries/backoff, excluding context/image preparation; not provider-only compute time |
| `inspected_at` | Backend UTC timestamp after successful validation |

Issue types: `missing_part`, `misplaced_part`, `wrong_color`, `wrong_orientation`, `unexpected_part`, `unknown`. Boxes are null or `{x,y,width,height}` in camera-image coordinates 0–1, with positive dimensions and `x+width <= 1`, `y+height <= 1`. No default boxes are generated. `missing_part` must use null: an absent component has no observed location. All five discrepancy categories carry distinct expected and observed text. A correct diagnosis cannot contain issues; incorrect must contain at least one. IDs must be among the supplied current-step blocks, or null. Geometric/schema validation cannot prove visual accuracy.

Active Vision view values are `top_down`, `front`, `back`, `left_side`, `right_side`, `close_up`, `other`. The nonempty reason and instruction must explain the missing evidence and a concrete camera move/region to reveal. The prompt asks for unchanged assembly and distinguishes missing reference information from evidence another view can supply. An uncertain response without this request is invalid upstream output, not a reason to fabricate one in Python.

The model receives only the `InspectionResult` JSON schema; the server adds provenance fields after inference. The browser validates the response shape and coordinates again before saving it to history. An image decode/dimension mismatch hides all boxes. Deploy backend/frontend together: Phase 3B adds required structured fields, so a newer frontend rejects a Phase 3A-only backend rather than drawing unverified overlays.

## Failures

Inspection service failures have `{"detail":{"code":"...","message":"..."}}`. Input/lookup validation retains FastAPI's existing string/list detail formats. No diagnosis appears in error responses.

| HTTP | Meaning / action |
| --- | --- |
| 404 | Project or step missing, or step belongs to another project; reload selection |
| 409 | Selected reference record/file unavailable, corrupt or unsafe; replace it |
| 413 | Image or complete encoded request exceeds application limit; reduce references/image size |
| 415 | Unsupported or animated image |
| 422 | Missing/incomplete fields, corrupt or too-small image |
| 429 | Meta rate limit; message and `Retry-After` specify seconds to wait |
| 501 | Legacy image-only request validated; supply both IDs to use actual inspection |
| 502 | Meta authentication/access/billing/request rejection, transport failure or invalid model response; message identifies category |
| 503 | Backend key missing or endpoint configuration invalid; configure and restart backend |
| 504 | Overall timeout or upstream timeout; try fewer references/a simpler view |

Check API access/billing at Meta for `meta_authentication`/`meta_billing`. `meta_request_rejected` can indicate an unavailable model or incompatible parameters. Do not change to another provider. `meta_invalid_response` rejects schema violations, incomplete/refused answers and hallucinated IDs. There are no retries for credential errors, validation errors or invalid diagnostic output. Browser errors never retain a previous successful diagnosis.

## Official protocol verification

Inspected on 2026-10-26 before implementing the transport:

- [Quickstart](https://dev.meta.ai/docs/quickstart) and [overview](https://dev.meta.ai/docs/overview): Meta base URL, Bearer authentication and `muse-spark-1.3`.
- [Chat Completions cookbook](https://dev.meta.ai/docs/cookbook/quickstart-chat-completions), [protocol](https://dev.meta.ai/docs/protocols/chat-completions) and [endpoint reference](https://dev.meta.ai/docs/api-reference/chat-completions/create-chat-completion): POST `/v1/chat/completions`, developer/user messages, `max_completion_tokens`, `reasoning_effort`, and `choices[0].message.content` with `finish_reason: stop`.
- [Image understanding](https://dev.meta.ai/docs/image-understanding): user-message content `{type:"image_url",image_url:{url:"data:image/jpeg;base64,..."}}`, multiple images, supported JPEG, 50-image maximum and 50,000,000-byte maximum per inline image. Payload/context limits also apply; the app does not infer an undocumented aggregate provider limit.
- [Structured output cookbook](https://dev.meta.ai/docs/cookbook/structured-output) and [guide](https://dev.meta.ai/docs/structured-output): `response_format:{type:"json_schema",json_schema:{name,strict:true,schema}}`. Strict objects require all properties in `required` and `additionalProperties:false`; nullable `anyOf` and nonrecursive `$defs` are supported. Pydantic supplies the schema and validates the response independently.
- [Error handling](https://dev.meta.ai/docs/error-handling) and [rate limits](https://dev.meta.ai/docs/pricing-rate-limits): status-based handling, error envelopes (not guaranteed for unknown paths), transient backoff/jitter and respecting `Retry-After`. Upstream non-streaming 504 is not blindly retried.

The adapter uses raw httpx, no OpenAI/Anthropic SDK or endpoint. It requests 8192 completion tokens with medium reasoning; reasoning consumes output tokens, so truncated answers are rejected. Default temperature remains the documented default. No tools, streaming, background jobs or provider-state replay are used.

The application's 8 MiB upload, 1280px inspection copy, eight-reference and 10 MiB JSON limits are conservative application choices, not advertised Meta limits. JSON size includes base64 expansion. Registered images stay at their existing registry normalization resolution. Model references use only validated image bytes, never local filenames, filesystem paths or public media URLs. Image roles and an omitted-reference count are supplied explicitly.

Meta's default perception examples use a 0–1000 coordinate grid. This application explicitly requests its own 0–1 x/y/width/height schema and rejects values outside it rather than guessing units or fabricating conversions. `DiagnosticOverlay` renders these validated normalized coordinates only on the returned analyzed JPEG, preserving its aspect ratio. Phase 3C optionally adds SAM instance masks on that same snapshot; no live-video tracking is used. See [SAM protocol and browser contract](segmentation.md).

## Live versus offline validation

`make test` uses HTTP mocks only inside tests and isolated SQLite stores. `make test-browser` uses synthetic camera input and test-only inspection fixtures; its disposable backend explicitly sets the model key to None. Neither command performs paid inference even if the developer environment has a key.

Run `backend/smoke_inspection.py` explicitly with a real registered project/step and real photograph (README command). Missing credentials produce exit 77; failures exit nonzero; successful validated diagnosis exits 0. This verifies access and parsing for that photograph, not recognition reliability across assemblies. Real photos and backend credentials must never be committed.

The optional [real-image benchmark](benchmark.md) runs the same adapter and provenance service. Its classification metrics do not establish localization quality; that still requires comparing reported boxes with real image evidence.

## Phase 3C response additions

`inspection_id` is a server-generated UUID and `snapshot_id` is the SHA-256 of the
normalized JPEG. `segmentations` contains per-issue status, concept/prompt kind,
SAM latency, selected instance ID and validated result (or null). Each result repeats
the snapshot identity/dimensions and model `sam-3.1`; instances use pixel left/top
and box-local PNG dimensions. The browser validates identity, bounds and mask metadata
before rendering. Existing Muse diagnosis fields and `model_latency_ms` retain their
meaning; SAM never changes the overall inspection status. Per-issue SAM failures are
successful inspection responses with localization-unavailable information, not a
replacement diagnosis or a new top-level HTTP error. Correct/uncertain results have
an empty localization list. See [segmentation.md](segmentation.md) for the complete
contract, routing, association, fallbacks and resource limits.
