# Stud-level geometric verification — Phase 4.1B

## Supported vertical slice

Phase 4.1B adds one conservative measurement mode: the signed longitudinal center
offset between two registered, rectangular, color-distinct 2×4 blocks. Both blocks
must have trusted positive heights, quantity one in the step, and colors among red,
orange, yellow, green and blue. The current implementation requires all eight target
studs and at least one complete, contiguous two-stud column on the partly occluded
reference in one calibrated, board-visible overhead snapshot.

The step owns one optional `relative_stud_offset` constraint. It identifies target
and reference blocks by registry ID and records:

- `positive_direction`: the sign of the reference block's longitudinal axis, chosen
  as ChArUco board `+X` or `+Y`;
- expected signed center offset and tolerance in 8 mm stud pitches;
- the trusted board-frame Z coordinate of each stud surface.

The first mode supports a target directly stacked one block above the reference.
The API checks each supplied surface height against registered block dimensions within
0.5 mm. A photograph is never used to infer an exact intended offset or unknown height.
Steps without a constraint remain valid project data and return `not_measured`; they
are never upgraded to geometrically correct.

The additive `step_spatial_constraints` SQLite table is created by the existing
`create_all` startup and does not alter existing rows or columns. Back up SQLite and
uploads before upgrading. This repository still has no general migration runner.

## Measurement path and coordinate frames

`geometric_verification.py` performs the following deterministic path:

1. Load the explicit step constraint and both registered block specifications.
2. Require the chosen calibration profile, exact stored camera configuration, native
   image resolution, user confirmation and a valid ChArUco board pose.
3. Associate the two blocks by distinct registered HSV color ranges. SAM remains
   available for semantic issue localization but is not repeatedly called for this
   controlled color association.
4. detect all eight target studs and one to four complete, contiguous exposed
   two-stud columns on the reference;
5. intersect each undistorted camera ray with that block's explicit board-parallel
   surface, using calibrated intrinsics and board pose;
6. fit the target 2×4 grid, require an 8 mm pitch within 7.2–8.8 mm, limit grid
   residual to 0.75 mm, then reconstruct the known reference center from its exposed
   end and the validated target axis;
7. compare the signed center displacement with the configured constraint.

Coordinates use the ChArUco board frame: X/Y in the board plane, Z normal to the
board, all in millimeters. Stud evidence contains both board coordinates and pixels
on the exact static analyzed snapshot. The board-coordinate axis is suitable for a
future client transform; the image segment exists only for the current snapshot
overlay. No coordinate is transferred to live video or another camera frame.

`image_to_board_plane` retains its Phase 4.1A Z=0 guard. The new
`image_to_board_surface` helper accepts a finite, trusted Z from 0–200 mm. It does
not estimate height. A board homography is therefore never silently applied to an
elevated brick.

## Status and fusion policy

The result schema version is 1. Numeric observed values exist only when calibration,
pose, feature counts, grid fit and association all pass. Calibration/profile mismatch,
partial visibility, blur, ambiguous patterns or unsupported colors return no observed
number.

Uncertainty in studs conservatively combines both grid residuals and calibration plus
pose reprojection residual, mapped through focal length and camera distance. Acceptance
uses the complete interval:

- `correct` only when `abs(deviation) + uncertainty <= tolerance`;
- `incorrect` only when `abs(deviation) - uncertainty > tolerance`;
- `uncertain` when the interval overlaps the tolerance boundary;
- `not_measured` when the step has no constraint.

This is a practical error bound for the narrow mode, not a calibrated coverage
guarantee. No submillimeter accuracy claim follows from it.

Muse remains the semantic authority for visible assembly content. Geometry is a
separate deterministic check. Semantic `incorrect` or `uncertain` remains blocking.
Semantic `correct` becomes successful only if a configured geometric check is
`correct`; geometric `incorrect` produces a correction action, while missing or
inconclusive geometry produces Active Vision-style capture guidance. SAM segmentation,
Muse boxes and fallbacks remain tied to their own exact semantic snapshot.

`POST /api/geometry/verify` runs only deterministic geometry and makes no model call.
`POST /api/inspect` and `/api/verify` accept optional `geometry_profile_id`, serialized
`geometry_camera` and `geometry_configuration_confirmed` multipart fields. Their
responses include the geometry result alongside the preserved Muse/SAM workflow.

## Manual iPhone / Four-Block Color Tower experiment

This procedure has **not been performed in Codex Cloud**. No physical result or
accuracy claim is recorded here.

1. Print the repository ChArUco PDF at actual size, mount it flat and measure the
   140 × 100 mm outer pattern in both directions.
2. Fix iPhone Continuity Camera, lens choice, resolution, focus, zoom, crop and
   stabilization. Prevent movement after calibration. Record the configuration.
3. Capture 12–20 sharp, varied board views, calibrate, and retain only a profile that
   passes the existing calibration thresholds.
4. Register two color-distinct rectangular 2×4 blocks with actual measured heights.
   Create a step with target/reference IDs, sign direction, expected offset, tolerance
   and surface heights. Use a board direction that is clearly visible in the setup.
5. Keep the ChArUco board and all 16 studs visible. Capture at least five repeats for
   each placement without moving the camera: expected offset, one stud left, one stud
   right. Re-seat the blocks between repeats.
6. Independently establish placement with a physical stud count. If evaluating a
   fractional offset, use an independent fixture or gauge and record its resolution;
   do not use AssemblyPilot's result as ground truth.
7. Record every raw placement, returned offset, uncertainty, status and failure. Do
   not discard uncertain or failed detections from repeatability calculations.

Use this blank result table in a local lab record:

| Placement | Repeats attempted | Numeric results | Mean / range | Status counts | Independent truth | Notes |
| --- | ---: | ---: | --- | --- | --- | --- |
| Expected | Not performed | Not available | Not available | Not available | Stud count required | Cloud has no camera/blocks |
| One stud left | Not performed | Not available | Not available | Not available | Stud count required | Cloud has no camera/blocks |
| One stud right | Not performed | Not available | Not available | Not available | Stud count required | Cloud has no camera/blocks |

Report lighting, camera distance/angle, calibration and pose RMS, failure rate and
repeatability before changing tolerances. The automated synthetic tests validate
math, schemas and failure handling; they do not establish physical accuracy.

## Known limits

- one board-parallel, single-view, direct-stack 2×4 mode only;
- color-based association requires distinct supported colors and controlled lighting;
- all target studs, at least one complete exposed reference column and sufficient
  ChArUco features must be visible;
- no arbitrary rotations, nonparallel surfaces, hidden connections, partial-grid
  reconstruction, 3D reconstruction, video tracking or HoloLens registration;
- calibration can become invalid after unreported camera changes;
- registered dimensions and print measurements are user-supplied trusted inputs;
- no physical experiment, iPhone compatibility or accuracy threshold has been
  validated in this cloud environment.
