# Meta-first printed-side recognition — Phase 4.1E

This extends the unmerged PR #9 branch `feature/logo-face-orientation-verification`:
printed-face geometry, contour overlays and independent Canny debug remain its
prerequisites. Main currently contains Phase 4.1B / PR #8. No duplicate migration,
provider, OCR service, continuous capture or autonomous loop is introduced.

## Configure once, inspect new captures

1. In **Block Library → Printed faces**, register a physical side (name, label,
   width and height), enable automatic print recognition and choose **Meta Auto**.
   Enter expected text, for example `Involve Me`, and optional alternative labels,
   one per line, for example `insights`. No photograph or manually taught contour
   is required for this text mode. Existing face dimensions remain required by
   the registry for compatibility; they are not evidence of recognition.
2. For a complex logo, use **Meta + References** with a logo description and
   reusable upright reference photographs of that side. The expected side's
   first reference follows the selected assembly reference within the image cap. Other
   registered-side photos help distinguish alternatives. Uploads remain reusable
   across views; the software does not require per-view registration.
3. A step selects one target block (required quantity one) and a required printed
   side. Choose **Print identity only (no physical direction)** to check the
   visible print, or a physical board axis for directional requirements.
   `operator_front` alone remains unanchored. A camera-facing surface is never
   assumed to be the physical front.
4. Capture, then explicitly inspect. **Printed Text & Logo Inspection** displays
   the expected text, literal observed text, separate logo interpretation,
   registered side if supported, method, quality, recognition and direction,
   reference photo when supplied, suggested action and exact analyzed snapshot.
   An optional model-supplied region is validated and drawn only on that image.
5. Correct any defect and use **Capture & Verify**. Identical, stale and
   superseded snapshots remain rejected; changing specifications invalidates
   progress. An initial correct result is not verified progress.

| Mode | Evidence used for printed identity |
| --- | --- |
| Meta Auto | Visible text in the existing Muse call; reference photo optional |
| Meta + References | Muse text/logo observation plus an actually attached expected-side photo; missing photo stays uncertain |
| Contour Matching | Existing accepted ORB/RANSAC/Canny reference identity; never an invented transcription |
| Hybrid | Muse observation with available deterministic reference identity; disagreement stays uncertain |

Contour Matching still requires sufficient reference evidence. Failed matching
is uncertain, not a wrong-print verdict. Raw Canny debug never changes correctness.
No human face recognition or biometric analysis is implemented.

## Evidence and quality gate

The strict model schema adds nullable `print_observation`. Configured Meta modes
require an observation; no print rule and contour mode require null. It contains
`target_block_id`, `target_identified`, `observed_text`, `observed_logo`,
`observed_registered_side_id`, `evidence_quality`, `logo_comparison`, optional
normalized `bounding_box`, description and suggested action. Invalid target/side
IDs, contradictory IDs/text and invalid regions fail provider validation. Unknown
readable content retains a null registered-side ID.

Server-owned `print_recognition` has `schema_version: 1`, `snapshot_id`,
`target_block_id`, expected/observed print, separate logo interpretation, registered
side ID/name, recognition status/method, evidence quality, known-alternative flag,
reference image ID, optional bounding box, direction requirement/support and
`gate_status`. It is included in inspection and fresh verification responses.
The frontend validates its schema, gate consistency and matching snapshot hash
before rendering. The browser's existing in-memory history retains the result.

Text comparison uses Unicode NFKC, case folding and whitespace normalization;
there is no fuzzy correction, substring acceptance or replacement of visually
similar letters. Partial, unreadable or ambiguous observations stay uncertain.
The target must be identified and reported exactly once; multiple indistinguishable
instances cannot pass. A matching existing SAM object mask may reject a conflicting
print location, but no additional SAM call is triggered for reading text.

Recognition, physical orientation and stud placement remain separate:

- A clear visible mismatch with no direction requirement blocks correctness.
- With a direction requirement, a text region must lie within an independently
  posed planar face facing that direction. Recognition alone, absent localization,
  missing calibration or unsupported direction leaves the print gate uncertain.
- A match cannot promote incorrect/uncertain geometry or face evidence to success.
  An uncertain required print blocks correct/verified results.
- `print_adjust` and `print_capture` actions supplement existing correction plans.
  Transport failure remains a retryable API error, never a physical mismatch.

SAM is optional object evidence, not a planar-face detector. The current SAM
policy localizes existing diagnosis issues only; not every print observation has
an associated mask. No direction-free text rule silently upgrades to a physical
orientation check.

## Request and image handling

The existing Meta Model API `/v1/chat/completions` transport, model configuration,
strict `response_format.json_schema`, image data URLs, limits, timeout and retry
policy are unchanged. One logical Muse inspection/verification call includes the
print observation. `muse_call_count` is one; `meta_attempt_count` exposes existing
bounded transport retries (up to three). No second crop inference or external OCR.

Before that call, existing OpenCV matching may establish one reliable planar quad.
Only then can `print_crop.py` append one perspective-corrected JPEG (maximum edge
768 px) to the same request. It carries the original semantic snapshot SHA-256 and
normalized source quad. All model coordinates still refer to image 0, not to the
crop. The native face JPEG retains its separate SHA-256, size and coordinates.
Absent a supported quad or matching image hash, inspection uses the original
snapshot. An object mask is never warped as a printed plane. Existing request
byte limits also apply to the supplemental image.

## Storage and compatibility

One additive table, `printed_side_rules`, stores validated configuration JSON by
existing `block_faces.id` with cascading deletion. Existing face, reference,
project, progress, calibration and image tables/files are unchanged. Startup
creates the missing table without recreating the database. Face POST/PUT/read
add optional `print_rule` with `expected_text`, `alternative_texts`,
`logo_description`, and `recognition_mode` (`meta_auto`, `meta_references`,
`contour`, `hybrid`). Omission in an older PUT preserves a stored rule; explicit
null disables it, except while a step still requires a print-only check (409).
Step face constraints add `facing_direction: "not_required"`, valid only with a
configured print rule. Configuration edits participate in specification hashes; omitted rules retain
the legacy serialized face shape so deployment alone does not invalidate progress.

## Validation and limitations

Automated tests use synthetic photographs and mocked Meta HTTP responses. They
exercise zero-shot/reference modes, known alternatives, similar words, partial
and unreadable evidence, ambiguous targets, invalid IDs/regions, SAM disagreement,
supported crops, direction association, hybrid conflicts, provider errors, fresh
verification and stale hashes. Playwright covers configuration without photos,
result states, responsive image-region alignment and stale capture clearing.
The existing geometry, SAM, contour and Canny regressions remain required.

No Phase 4.1E live inference or real-image accuracy claim is made. The repository's
older live Meta transport report does not validate this new output schema or print
recognition. No usable user-supplied photographs of the two yellow prints were
available in this workspace for the experiment below. Small lettering, reflections,
blur, occlusion, repeated blocks and oblique surfaces remain failure modes. Model
transcription/localization can be wrong; automated contract tests do not establish
accuracy. Physical direction without a reliably posed face remains uncertain.

HoloLens/WebXR/device calibration are not implemented. Portable block-side IDs,
board-relative directions and exact-frame evidence prepare the data contract;
future moving-camera work still needs device-specific calibration, tracking and
synchronized physical frame registration.

## Real Four-Block Color Tower experiment (pending)

Use the actual yellow block and actual camera images. Configure expected
`Involve Me` and alternative `insights`; first run print-only, then repeat with a
calibrated board-relative direction where supported. Do not replace real pictures
with generated fixtures. Register a reusable reference only in the reference run.

| Case | Capture / change | Result | Attempts / latency / reference |
| --- | --- | --- | --- |
| A | Expected Involve Me, visible Involve Me | Not run | Not measured |
| B | Expected Involve Me, visible insights | Not run | Not measured |
| C | Same print from another angle | Not run | Not measured |
| D | Same print from another distance | Not run | Not measured |
| E | Partly obscured print | Not run | Not measured |
| F | Lower light and mild reflection | Not run | Not measured |
| G | Correct B, then fresh capture and verification | Not run | Not measured |

For each run record the inspection/snapshot IDs, literal observed text, recognition,
physical direction, geometry and final gate separately; `muse_call_count`,
`meta_attempt_count`, `model_latency_ms`, reference ID, uncertain/incorrect readings
and failure reason. Repeat A–F without a reference and with one reusable reference
where useful. Do not infer accuracy from a handful of successful examples. For G,
record both requests and verify that reusing the original snapshot is rejected.
