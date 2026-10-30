# Optional inspection contours

This extends Phase 4.1C on `feature/logo-face-orientation-verification` while PR #9
is open. Contours visualize existing evidence; they never change face rules,
semantic diagnoses, stud measurements, correction plans or verification progress.
No additional Meta calls, models or dependencies are introduced.

## Controls and evidence

| Control | Source | Appearance and meaning |
| --- | --- | --- |
| Bounding Box | Existing Muse/SAM bounds, or the matched face quadrilateral | Independently hides/shows existing localization |
| SAM Outline / Object Outline | Alpha boundary of the already selected SAM mask | Blue solid paths; visible mask boundaries, including holes |
| Canny Edges / Detected Edges | Exact face JPEG, restricted to a supported planar face ROI | Amber dashed paths; raw visual structure, **not** a verified match |
| Reference Match | Accepted ORB/MAGSAC homography inlier pairs | Green residual lines from projected reference coordinates to observed keypoints; circles mark observed endpoints |

All three new contour modes start **off**. Bounding boxes and the existing filled
SAM-mask control retain their previous defaults. Each control is independent;
“Show original” hides all annotations on the diagnostic image. Unavailable modes
are disabled with an explanation. Toggling a mode performs no network request.

SAM outlines appear on the exact semantic/SAM JPEG. Canny and reference pairs
appear in the separate face panel on its exact (potentially higher-resolution)
JPEG. The panels intentionally do not transfer contours between different image
sizes or hashes. A control can be unavailable on one panel while its evidence is
available on the other. A semantic face ID alone never supplies a face ROI.

## Extraction and bounds

`services/contour_service.py` is a deterministic worker-thread helper:

- SAM: decode the existing validated box-local RGBA mask, extract nonzero-alpha
  contours with `RETR_LIST`, then translate by the mask's exact left/top crop
  offset. Unselected/ambiguous, empty, disabled or failed segmentations yield no
  outline. The whole rectangular mask crop is never substituted for a boundary.
- Canny: require a finite, convex quadrilateral fully inside the exact scene.
  Analyze its bounding crop with Gaussian denoising and median-adaptive Canny.
  Mask the resulting edges to the polygon eroded by two pixels; this excludes
  outside texture and avoids making an artificial edge along the ROI boundary.
  An unsupported/ambiguous face match has no trusted ROI and yields no Canny layer.
- Reference: reuse ORB inliers from the already accepted planar match. Keep only
  finite pairs with ≤3 px residual and both endpoints inside the matched face and
  snapshot. There is no second matching or inference request and no invented
  full outline extrapolated from a few keypoints. A geometric feature match is
  not evidence that the required physical facing direction is satisfied.
- Contours use `CHAIN_APPROX_SIMPLE` and `approxPolyDP`, discarding traces shorter
  than 16 px. Approximation starts at max(0.75 px, 0.1% of perimeter), increasing
  only when necessary to meet the per-path vertex cap. Larger traces have priority.

Each layer has at most 64 paths, 128 points per path and 4096 points total. Payloads
carry finite full-image pixel coordinates, `closed`, mode/status/message, SHA-256
snapshot identity and dimensions. No arbitrary SVG markup is accepted. The
browser builds SVG paths from validated numbers. Layers are optional additive
response fields (`segmentations[].outline` and `face.contours`); old responses
without them remain readable and show unavailable controls. No database migration
or persisted debug images are added.

Backend and frontend validate point budgets, bounds, mode and snapshot provenance.
Available face layers require accepted localization evidence; available SAM layers
require a selected segmentation. The browser verifies JPEG hashes and decoded
image dimensions before rendering. SVGs share the image's native-coordinate
viewBox, transparent fill and non-scaling strokes. Existing cancellation and
fresh-capture behavior removes old active results; history keeps its own original
snapshot rather than attaching evidence to a new capture or live video.

If SAM and face target association disagree, face contours are cleared to an
unavailable state. Failure to extract optional contours does not overwrite a
valid diagnosis or fabricate a replacement shape.

## Validation and limits

Backend synthetic cases cover mask offsets/holes, empty or unavailable SAM,
stale hashes/dimensions, background exclusion, invalid ROIs, point budgets,
feature residual filtering and the actual registered-face matching pipeline.
Playwright checks independent toggles, disabled defaults, distinct raw/matched
styles, desktop/mobile coordinate alignment, capture clearing, unavailable evidence,
and rejection of stale/out-of-bounds/oversized contour responses.

These are visual aids, not metrology. SAM outlines inherit segmentation errors;
alpha thresholds cannot distinguish true occlusion boundaries from mask mistakes.
Canny can still detect unwanted texture **inside** the printed-face ROI and may
miss weak, blurred or reflective edges. Simplification and filtering omit fine
features; outline holes and tiny components can disappear below the size limit.
Reference pairs are sparse correspondence evidence, not a dense contour match or
an accuracy probability. No real-image benchmark or live Meta inference was
performed for this overlay change. Existing physical validation limitations and
the manual tower protocol in [face-verification.md](face-verification.md) apply.

[Independent Edge Detection Debug Mode](edge-debug.md) analyzes the captured camera
JPEG without AI or matching prerequisites. It adds direct rectangular ROI selection,
manual Gaussian/Canny controls, a full-resolution edge image and an optional raw
overlay while preserving existing inspection results.
