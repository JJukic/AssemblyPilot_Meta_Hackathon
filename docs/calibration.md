# Phase 4.1A — OpenCV calibration and guided capture

This phase establishes a camera/board coordinate frame. It does **not** measure LEGO
offsets, stud positions, elevated surfaces or physical assembly correctness. A Muse
“correct” / “Step Verified” result is a semantic assessment; SAM masks localize visible
objects. Neither is metrological verification, even after capture guidance passes.

## Integration state

At implementation start, main was `edbdef0`, with SAM PR #5 merged. Phase 4 PR #6
(commit `743ba77`) remained open. The dedicated `feature/opencv-precision-vision`
branch preserves Phase 4 and merges main's SAM implementation. The active
`AssemblyOrchestrator` now runs the existing optional localization service after both
initial diagnosis and fresh-image verification. Each result uses its own JPEG and
snapshot identity. SAM failures retain the Muse diagnosis. No parent PR is silently
merged or closed by this work.

Next.js, FastAPI, Pillow validation, SQLite tables, references, progress/version
checks and camera switching are retained. Calibration adds no database migration.
It makes no Meta requests. Existing inspect/verify calls remain explicit.

## Install and board generation

`uv sync --frozen` installs one OpenCV wheel: **opencv-contrib-python-headless
4.14.0.94**, exposing **cv2 4.14.0** and NumPy. Do not also install opencv-python,
opencv-python-headless or opencv-contrib-python in this environment.

The tested API is `aruco.CharucoBoard`, `getPredefinedDictionary`,
`CharucoBoard.generateImage/getChessboardCorners/getIds`,
`CharucoDetector.detectBoard`, `calibrateCamera`, `solvePnPGeneric(SOLVEPNP_IPPE)`,
`projectPoints`, `Rodrigues` and `undistortPoints`. It uses the current post-4.6
board pattern, not the legacy even-row pattern.

From the repository root:

```sh
mkdir -p backend/data/boards
cd backend
uv run --frozen python scripts/generate_charuco_board.py \
  --output data/boards/charuco-default.pdf
# Use a different stem for a second artifact, since each gets a JSON sidecar:
uv run --frozen python scripts/generate_charuco_board.py \
  --output data/boards/charuco-preview.png --dpi 300
```

The CLI accepts `--squares-x`, `--squares-y`, `--square-mm`, `--marker-mm`,
`--dictionary` and `--dpi`. Supported dictionaries are DICT_4X4_50,
DICT_5X5_100 and DICT_6X6_250. Dimensions, marker margin, dictionary capacity and
output pixel count are validated; existing output/metadata files are not overwritten.

**The API/UI deliberately use only the default server-owned board:** 7 × 5 squares,
20 mm square side, 15 mm marker side, DICT_4X4_50, IDs 0–16. Its outer pattern is
**140 × 100 mm**. Custom CLI boards are for programmatic use with an explicit
`BoardSpec`; uploading one does not configure the running API.

Download the same default PDF from Settings or `GET /api/calibration/board.pdf`.
The PDF page dimensions encode the physical pattern size; PNG has physical DPI
metadata. Print at **100% / actual size**, disable fit-to-page, and retain white
paper margin around all four edges. Never assume a viewer or printer respects DPI.
Do not print a browser screenshot of the board.

Measure both **outer pattern edges**, not the paper. Record width and height,
mount the print flat on a rigid surface, and enter the measured values in the UI.
The MVP rejects deviations beyond 1% of nominal. This only catches gross scaling:
it does not certify print quality, square pitch or dimensional accuracy. Geometry
uses the nominal board dimensions; print scale error remains a corresponding
systematic error in translation and board-plane coordinates.

Board ID is a hash of the configuration, **not a physical serial number**. Show
only this board. Duplicate marker IDs or foreign IDs in the configured dictionary
are rejected as ambiguous. Identical printed copies and boards using the same
visible ID subset cannot always be distinguished, especially under occlusion.
There is no general multi-board identification or arbitrary-dictionary scanner.

## Browser workflow

1. Open **Settings** beside **Projects** (`/settings`). Start/select the camera
   using the camera controls, then open **Camera Calibration & Precision Capture**.
2. Download, print, measure and flatten the board.
3. Enter a lens identification and record focus/zoom/crop/stabilization settings.
   A browser label does not uniquely identify a physical camera or its optics.
4. Capture 12–20 sharp images. Cover different image locations including edges;
   vary distance, rotation, and moderate tilt in both axes. Keep the same lens,
   resolution and effective camera configuration throughout.
5. Each capture uploads only on its button press. Detection shows provisional
   accepted/rejected feedback and exact analyzed-snapshot corners. Remove individual
   samples or clear the batch. Batch calibration additionally checks diversity.
6. Confirm configuration consistency and enter measured pattern width/height.
   **Calibrate & save profile** estimates and validates intrinsics and saves a
   versioned local JSON profile. No photograph is permanently stored by the backend.
7. Choose your assembly project and step in **Workspace**. Return to **Settings**
   and open **Precision Capture**, select a profile, and confirm that its camera
   configuration still matches. Capture an image containing the board.
8. Read marker count, fraction of detected internal corners, blur guidance, pose
   residual and approximate viewing angle. If necessary, adjust the camera and
   explicitly capture again.
9. **Use this capture for AI inspection** publishes that static frame to the existing
   workspace without making an AI call. Return to **Workspace**;
   **Inspect with Meta AI** then performs Muse
   diagnosis and optional SAM localization. Geometry warnings do not overwrite the
   model's diagnosis, and passing capture guidance does not verify block placement.

There is no continuous analysis, AI inference, upload or camera movement. Profiles
are loaded from the local backend. Samples and overlays remain in browser memory;
stopping/switching/restarting the camera clears unsaved calibration state and aborts
pending UI requests. AI operations retain the existing independent workflow.

## Validity and quality policy

Calibration uses Pillow-validated, EXIF-oriented, metadata-free JPEG images at
**native resolution**. It intentionally bypasses media/Meta thumbnail resizing.
The browser captures the full unmirrored video frame. Geometry coordinates must not
be copied onto a resized Meta image or live video without an explicit transform.

Profiles include schema version, UUID, UTC timestamp, OpenCV version, camera label,
lens label, image size, recorded configuration, board specification/ID, measured
print size, 3×3 camera matrix, five distortion coefficients, accepted view count,
aggregate and per-view pixel RMS, image coverage and board-normal angular spread.

The current camera model is a conventional pinhole lens with radial/tangential
distortion [k1, k2, p1, p2, k3], with k3 fixed to zero. Fisheye/extreme wide-angle
lenses are not supported. Quality thresholds are conservative MVP heuristics:

- 12–20 views, same native dimensions, at least 12 internal corners and 1.5% image
  hull coverage per accepted sample.
- Board-region Laplacian variance >=50; this is dependent on resolution, exposure
  and texture, not a calibrated sharpness unit.
- Exact canonical JPEG duplicates rejected; views with >=8 shared corners and
  less than 5 px RMS motion rejected as near duplicates.
- Combined corner hull covers >=15% of image; estimated normals span >=15°.
- Aggregate reprojection RMS <=2 px, every view <=3 px; finite plausible focal
  lengths, principal point, near-square pixels and bounded distortion.
- Pose requires >=8 spread, sharp corners, positive depth and <=2 px residual.
  Materially different IPPE solutions with residual separation <0.1 px are rejected.
- Top-down capture guidance additionally requires >=12 corners, centered board
  evidence and <=25° viewing angle. These are capture heuristics, not dimensional
  acceptance criteria.

Saved JSON is validated on every load. Corrupt, unsupported or OpenCV major/minor
version-mismatched profiles are ignored in status and rejected for use.
Resolution, lens, device label, recorded settings or board mismatch disables pose.
Each capture reads the current browser-exposed track settings; their change makes
the configuration incompatible. Confirmation is required to enable a calibrated
pose. There is **no automatic rescaling of intrinsics**.

Continuity Camera may switch lenses, focus, crop, zoom, stabilization or processing
without exposing enough information through `getSettings()`. EXIF is not a reliable
source and is discarded. Keep the setup fixed, disable changing effects when
possible, and recalibrate after changes or uncertainty. A compatible profile and a
small residual alone cannot prove that hidden physical intrinsics are unchanged.
Repeated real check views and independent ground truth are still needed.

Workspace ↔ Settings navigation keeps the same live camera, unsaved samples,
configuration, selected profile and confirmation in memory. Reloading the page or
leaving these routes releases that session; saved backend profiles remain available.
The existing camera-change reset and explicit confirmation requirements still apply.

## APIs and storage

All routes are under `/api/calibration`:

| Route | Contract |
| --- | --- |
| GET /status | Default board, OpenCV version, validated profiles and invalid count |
| GET /board.pdf | Default board PDF, physical pattern dimensions |
| POST /detect | Multipart image, camera JSON; optional profile_id and configuration_confirmed |
| POST /validate-capture | Same contract and assessment as /detect |
| POST /calibrate | 12–20 multipart images, camera JSON, measured_width_mm, measured_height_mm, configuration_confirmed; returns saved profile (201) |

Camera JSON contains `device_label`, `lens`, `configuration`, `width`, `height`.
The configuration is an explicit user description plus browser settings in the UI.
API callers must supply their own accurate, stable configuration description.
Only UUID profile IDs are accepted, never client filesystem paths. Profiles live in
`backend/data/calibrations`, configurable with backend-only `CALIBRATION_DIR`.
They are bounded to 100 profiles and 64 KiB per loaded JSON; old profiles can be
archived locally with the backend stopped. API responses never expose storage paths.

The API uses the existing per-file 8 MiB, 20-million-pixel, 8192-edge image limits;
calibration batches are additionally limited to 64 MiB and 20 files. Only one
calibration fit runs at a time. CPU work is off the event loop. Multipart parsing
can spool before application checks; this remains an unauthenticated trusted-local
MVP, not a public upload service. Temporary spooled uploads are closed, not archived.

Errors: 413 image/batch too large, 415 unsupported format, 422 invalid image/board
evidence/calibration/profile, 404 unknown profile, 409 declared resolution mismatch
or calibration already running, 503 profile storage unavailable. A well-formed
capture with no board or an incompatible profile returns a typed 200 assessment
with warnings and **no pose**. It does not fabricate intrinsics.

Capture responses contain the exact analyzed JPEG, SHA-256, native image size,
usable corner coordinates in pixels, detection metrics and optional pose. The
frontend checks hash, image dimensions and coordinate bounds before drawing corners.

## Coordinate frames and the next geometry phase

- Image: oriented, unscaled image pixels; origin top-left, x right, y down. These
  are pixel coordinates, distinct from Muse's normalized [0,1] box coordinates.
- Board: origin outer top-left corner, X right along columns, Y down along rows,
  Z normal into the print for the front-facing OpenCV convention. Units: mm.
- Camera: optical center, X right, Y down, Z forward. `rvec` is Rodrigues rotation
  in radians, `translation_mm` is board origin in camera coordinates. The approximate
  viewing angle is between the optical axis and board normal; centering is assessed separately.
- Extrinsic: `X_camera = R_board_to_camera X_board + t_board_to_camera_mm`.
  Homogeneous `T_camera_from_board = [[R,t],[0,0,0,1]]`; invert with
  `R.T` and `-R.T t`. Compose destination-from-source transforms right to left.

`image_to_board_plane(points_px, profile, pose, plane_z_mm=0)` undistorts pixel
rays, transforms them into the board frame, and intersects **Z_board=0**. It rejects
mismatched pose/profile identities, out-of-image points, unreliable distortion inversion
(>0.25 px round-trip error), grazing intersections,
negative depth, and extrapolation outside the board footprint. Output is XY in mm.

The caller must establish that each input point physically lies on this plane.
A single pixel coordinate cannot establish this. **Stacked LEGO surfaces are above
the board** and will have parallax. Nonzero plane height is expressly rejected;
do not apply this function to elevated block pixels and call them rectified,
measured or geometrically verified.

The versioned `GeometryEvidence` contract always returns `measurement_status:
not_measured`, `coordinate_frame: charuco_board`, `units: mm`, empty
`measurements`, calibration validity and explicit limitations. No expected versus
observed deviations are filled in.

Future HoloLens use requires its own camera calibration and measured RGB/depth/AR
registration. Convert mm to meters exactly once when needed and explicitly map
handedness/axes before composing `T_world_from_camera T_camera_from_board`.
This profile cannot calibrate a HoloLens or establish its world pose. No WebXR or
device connectivity is implemented.

## Real manual experiment: MacBook Air + iPhone + Four-Block Color Tower

**Status: not performed in this cloud.** No physical camera, measured print,
user calibration photographs or Meta key was available. The user reports successful
local Muse and SAM inference; that is distinct from this branch's live acceptance.

1. On the MacBook, run `make install`, `make dev-backend`, `make dev-frontend`.
   Use the existing backend Meta key; keep it out of browser configuration.
   If it is stored in `.env.backend`, explicitly load that file with
   `uv run --env-file .env.backend`; automatic settings load `backend/.env`.
2. Select the iPhone Continuity Camera (if macOS/browser exposes it). Fix the
   lens/settings, disable changing effects where possible, and record native size.
3. Print the default board at actual size, measure both edges with ruler/caliper,
   mount flat, and record the actual measurements and flatness.
4. Capture 12–20 varied views, calibrate, and record the saved profile ID, accepted
   view count, per-view/aggregate RMS, coverage and normal spread.
5. Keep some independently captured views out of calibration. Select the profile,
   assess those views, and record marker/corner counts, pose and residuals. Test
   near top-down, tilted, off-center, partially obscured and blurred captures.
6. Change resolution or recorded lens/settings: confirm that no calibrated pose is
   returned. Restore the exact setup or recalibrate. Check expiry of UI evidence
   after stopping/switching cameras.
7. Place the Four-Block Color Tower beside the visible board. Select its project
   and current step. Capture, read guidance, explicitly publish the frame and
   inspect with Muse. For a visible discrepancy, check optional SAM segmentation
   on the returned AI snapshot. Record real status, inference latency and failures.
8. Move a top block sideways. Do **not** expect this phase to measure the offset.
   Exercise correction → fresh capture → verification. Record wrong semantic
   positives as limitations; neither the board nor low reprojection error proves
   the top block is correctly aligned.

Record this table with actual observations, leaving unperformed fields blank:

| Measurement | Actual observation |
| --- | --- |
| Date / macOS / browser / iPhone / lens | |
| Native image size and camera configuration | |
| Measured pattern width / height / flatness | |
| Profile UUID / OpenCV version | |
| Accepted views / RMS px / worst view px | |
| Held-out view marker/corner counts / residual px | |
| Top-down / tilted / blur / mismatch guidance | |
| Actual Muse request and optional SAM outcome / latency | |
| Known failures and rejected views | |

Reprojection RMS measures consistency in image pixels, not millimeter accuracy.
Before stud-level measurement, obtain real held-out observations and independently
measured ground truth across the working volume. Then add known brick dimensions,
stud centers, per-layer height constraints, distortion-aware multi-view or height
models, and uncertainty estimates before introducing geometric pass/fail decisions.
