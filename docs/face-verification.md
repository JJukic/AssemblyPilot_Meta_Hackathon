# Printed-face verification — Phase 4.1C

Phase 4.1C extends the merged Phase 4.1B baseline (PR #8) with an optional
printed-face rule. Existing projects, stud constraints, calibration profiles,
Muse inspection, SAM overlays and fresh-capture verification remain in place.
There is no automatic frame loop or additional inference provider.

## Register → constrain → inspect → correct

1. Edit a saved block in **Block Library → Printed faces**. Register distinguishable
   faces using stable IDs, a physical label, a name and optional print description.
   Enter the physical width and height of the entire face in millimeters.
2. Upload upright, unmirrored photographs cropped tightly to **one complete flat
   rectangular face**. No folded corners or multiple sides in one reference.
   Multiple photographs are supported (up to eight per face). There is no in-app
   ROI/crop editor yet. The uploaded crop is the reference plane, not the entire
   SAM object mask. Name/description edits and photo upload/deletion are available.
3. In the step editor select the target block, required face and physical board
   direction. This slice supports one face rule and one instance of its target
   per step. Unlabelled blocks do not acquire a default front.
4. Capture the complete printed side with the ChArUco board visible. Use the
   matching calibration profile, native camera resolution and confirmed camera
   configuration. **Inspect with Meta AI** is still an explicit user action.
5. Read semantic, stud geometry and face results separately. The face panel shows
   expected/observed identity, similarity (not probability), the matched reference,
   guidance and a quadrilateral on its own exact analyzed JPEG. No result overlay
   is attached to moving video. The native-resolution face image can differ from
   the downscaled semantic image; each has its own SHA-256 identity.
6. A wrong face requests a physical correction. Unresolved identity/direction
   requests a clearer side view or calibration/frame confirmation. Correct the
   assembly, capture a genuinely fresh image and verify. An initial correct
   inspection never records verified progress.

## Coordinates and physical scope

Block-local face normals: front = −Y, back = +Y, left = −X, right = +X,
top = +Z, bottom = −Z. Labels are registered physical metadata, independent of
camera position. Image right/down axes within an upright face reference define a
local rectangle; its declared width/height establish metric scale for planar pose.
The observed outward normal is chosen to point toward the observing camera.

ChArUco uses its existing board origin and printed-board +X/+Y directions. Given
board-to-camera rotation `R_cb` and face-to-camera rotation `R_cf`, the measured
outward face normal in board coordinates is `R_cb.T @ n_camera`. Equivalently,
for a registered local normal `n_local`, a complete future block pose would give
`n_board = R_board_block @ n_local`. This phase estimates only the visible
face normal; it does not recover a complete block transform from all six labels.

Selectable required directions are board ±X and ±Y. To mean “toward the
operator,” choose the axis that physically points toward the operator at the
workbench. The literal `operator_front` is intentionally unanchored and always
uncertain. Camera-facing never substitutes for operator-facing. Top/bottom
identities can be registered, but board ±Z rules are outside this initial slice.
Text rotated within the same plane remains the same face identity; text reading
roll is not a separate orientation constraint in this version.

## Deterministic pipeline and conservative gates

`services/face_inspection.py` compares only references owned by the constrained
target block. It uses grayscale, ORB features, reciprocal Hamming matching with a
0.65 nearest-neighbor ratio, and MAGSAC robust homography fitting. Projected
reference corners must form a convex, unmirrored quadrilateral entirely inside
the analyzed image. The matching homography rectifies **only that reference
plane**. Gaussian-denoised, median-adaptive Canny edges supply structural support;
normalized template correlation supplies a second appearance check. Canny does
not read logos or text. Convex hulls/contour area validate correspondence spread
and the candidate quad; there is no separate general-purpose face detector.

Current conservative heuristic gates:

| Evidence | Gate |
| --- | --- |
| Reference | At least 48 px per side, luminance standard deviation ≥15, ≥20 ORB keypoints |
| Scene | Laplacian variance ≥30 |
| Correspondences | ≥16 reciprocal ratio matches; ≥14 inliers; ≥80% inliers at 3 px MAGSAC threshold |
| Spatial support | Inlier hull covers ≥25% of reference; projected area ≥1500 px² |
| Rectified structure | ≥100 reference edge pixels; ≥70% supported within a 3×3 edge neighborhood |
| Rectified appearance | Normalized correlation ≥0.70 |
| Identity ambiguity | Another face within 0.12 of best score → uncertain |
| Physical direction | IPPE reprojection RMS ≤1.5 px; every near-best pose (within 0.3 px) aligns within 15° of required board axis |

`FACE_CANNY_SIGMA` defaults to 0.33 and is bounded to [0.1, 0.6]. Other gates are
fixed conservative MVP heuristics, **not calibrated production thresholds**.
Their basis is requiring independent correspondence, spatial, edge and appearance
support. Synthetic regression cases cover rotation, perspective, different/same
artwork, low texture, darkness and heavy occlusion. Tightening the descriptor
ratio from 0.70 to 0.65 excluded ambiguous repeated-feature matches in the
perspective fixture while retaining the inlier gate. This is engineering evidence,
not an empirical accuracy estimate on real blocks. No debug image files are
persisted; the result retains a score, method, quad, reference ID, calibration ID,
exact snapshot and guidance.

If a matching existing SAM issue mask is available, the face centroid is mapped
from native image dimensions to the semantic snapshot/mask and checked against
that mask. Disagreement makes the face uncertain. SAM unavailable/disabled/no
matching issue leaves the independent reference matcher usable. SAM masks are
not treated as planar-face masks. SAM still runs only under its existing bounded
issue-localization policy; this phase introduces no extra SAM requests.

Muse receives the rule, registered IDs/descriptions and first photo per face
within the existing reference/payload caps. These precede assembled-step and
block references; omitted-reference counts remain exposed. Its existing single
inspection/verification call returns nullable `observed_face_id`. Unknown IDs are
rejected. If deterministic identity is unavailable, the existing Muse identity
can be displayed as semantic evidence. It cannot establish metric pose and does
not promote an unresolved required face to correct. There is no second OCR/model
call or autonomous fallback loop. A Meta error remains an API error, never a
fabricated successful inspection.

## Fusion and storage

An incorrect face blocks complete correctness even if Muse and stud geometry say
correct. A required unresolved face blocks correct/verified; existing definite
semantic/geometric defects remain actionable. No face rule returns `not_measured`.
The correction plan adds `face_adjust` or `face_capture`, while keeping existing
semantic and geometric actions and fresh-frame checks. Face definition changes,
reference IDs and constraints participate in the specification fingerprint, so
old verification cannot survive changed reference data. Edits also advance the
parent block revision, preventing edit/revert from resurrecting old progress.

Three additive SQLite tables are created through the existing startup schema
initialization: `block_faces`, `face_references`, `step_face_constraints`. Existing
tables/data are untouched. Face photographs remain ordinary block-owned
`reference_images` and reuse validation, media serving, transactional cleanup and
reference deletion. Face links cascade when an image is deleted. Deleting an
in-use face returns 409; remove the step rule first. Deleting an unused face
removes the label/link, leaving its photographs as ordinary block references.
Back up SQLite, uploads and calibration files together as before.

API additions:

- `GET/POST /api/blocks/{block_id}/faces`
- `PUT/DELETE /api/blocks/{block_id}/faces/{face_id}`
- `POST /api/blocks/{block_id}/faces/{face_id}/images` (multipart `image`)
- Existing step create/update: optional `face_constraint` with `target_block_id`,
  `required_face_id`, `facing_direction`; face must belong to an assigned target.
- Existing workflow response: `face` (schema version 1), with status, expected and
  observed IDs/names, reference ID, method/score, optional calibration ID,
  directional evidence, snapshot hash/image, pixel quadrilateral and guidance.

Old step requests without the optional rule retain prior behavior. References are
served through `/api/media/{image_id}`. Face result validation rejects nonfinite,
out-of-image, unsupported success and contradictory identity evidence. The
browser additionally verifies image bytes and decoded dimensions before overlays.

## Four-Block Color Tower: manual experiment protocol

**Status: not performed.** No real paired user reference/test photographs or
physical camera/board experiment were supplied for this phase. Automated fixtures
are synthetic; model responses in tests are mocked. No live Meta inference was
executed for this change, and this document makes no new successful-inference or
accuracy claim. Earlier validation records are historical, not evidence for this
new face schema.

Use the user's physical tower and blue block, with separate real photographs of
both printed sides. Register their actual names/descriptions (for example the
user's “insights”/“Give Me Details”; neither is hard-coded). Calibrate the physical
camera and board, establish the operator's board axis, and set both the stud rule
and required face. Keep private photos and credentials out of Git.

| Case | Expected behavior | Measured result |
| --- | --- | --- |
| Correct offset, required face toward anchored operator axis | Both supported checks pass; fresh verification eligible | Not run |
| Correct offset, opposite registered face toward that axis | Geometry correct, face incorrect; never verified | Not run |
| Wrong offset, correct face | Geometry incorrect independently of face | Not run |
| Correct assembly, print partly hidden | Uncertain if identity/pose support insufficient; request unobstructed side view | Not run |
| Same physical assembly, changed camera angle | Physical verdict stable when evidence remains adequate; otherwise uncertain | Not run |

For each run record capture time, calibration/profile, actual selected face IDs,
physical ground truth, semantic/geometry/face states, match score, direction
support, model latency and fresh-verification result. Try a corrected fresh image
and an edit/delete of a reference to verify progress invalidation. Record failures
as well as passes. Never replace these empty results with simulated measurements.

## Limitations and HoloLens follow-up

Identical prints on different objects, similar logos, glossy reflections, small
print, partial occlusion, inaccurate cropping/dimensions and planar pose ambiguity
can defeat identification. A registered print is not a unique physical serial
number: one-target-instance validation cannot prove scene uniqueness. The strict
heuristics may reject valid real photos and cannot guarantee zero false positives.
Reference matching assumes a flat rectangular face and correct metadata; it is
not a general cuboid detector. SAM centroid consistency is a limited association
check, not proof of ownership. Physical threshold tuning and false-positive
measurement must follow the manual experiment.

HoloLens still needs an independently anchored workbench/operator frame, full
block pose where required, device/world transforms, uncertainty propagation and
hardware validation. No WebXR, depth processing, device integration or
millimeter-accurate hologram registration is implemented here.

Optional [inspection contour overlays](contour-overlays.md) add independently selectable SAM
boundaries, raw ROI Canny edges and verified reference feature pairs on their
exact snapshots. New contours are disabled by default and make no additional AI calls.
