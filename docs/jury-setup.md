# Jury-ready assembly setup (Phase 5)

Open **Try AssemblyPilot with Your Own Blocks → Quick custom project**, or
**Projects → New project**. Existing projects and the five-step practice demo are
still available. The ready-made two-block template is a manually editable example,
not an inspected assembly or a fabricated reference photograph.

## Five steps

1. **Describe**: name the project, describe the intended visible arrangement,
   optionally supply one instruction per line and a finished-build photograph.
   Choose Meta-assisted or manual setup. Both paths next collect your inventory.
2. **Your blocks**: select reusable library blocks or add custom names, colors and
   quantities. Optionally photograph/upload individual blocks and add print/logo
   notes. These notes do not activate a correctness rule. Unknown dimensions and
   shape remain unspecified; basic inspection needs no ChArUco board.
3. **Assembly steps**: explicitly request **Generate Assembly Plan with Meta AI**,
   or continue manually. Reorder steps and edit every title, instruction, assigned quantity, text
   rule, reference suggestion and limitation. Select actual reference photos for
   individual steps. The finished-build photo is used only for the final step,
   unless you supply a separate final-step photo. Reference suggestions are text,
   never generated photographs. Quantities describe the blocks needed to inspect
   a step; include earlier parts when their appearance is relevant.
4. **Inspection mode**: Simple is the default. It uses existing semantic inspection,
   configured print recognition, requested/applicable SAM localization, correction
   guidance and fresh-image verification. Advanced exposes the existing precision
   setup paths after confirmation: project step editors for stud constraints and
   tolerances; Block Library for measured faces and references; camera workspace
   for ChArUco and guided capture. Selecting Advanced does **not** enable an
   unconfigured measurement. Canny, SAM outlines and supported Reference Match
   remain available on inspected snapshots.
5. **Review & launch**: review all steps, selected photos, active rules and limits.
   Explicitly confirm activation, then create the project. **Start Inspection**
   opens the real camera workspace with that project and its first step selected.
   Start the camera, capture, and choose **Inspect with Meta AI**. Correcting a
   finding and verifying it still requires a fresh image and explicit action.

Draft fields/photos remain in browser memory. Keep the page open; reload discards
an unsaved draft. Photo capture stops the camera when saved into the draft or
closed. Photos are uploaded only by explicit generation or confirmed creation.
A failed Meta request keeps the draft editable and offers manual continuation.

## Persistence and API

- `POST /api/setup/draft`: multipart `payload` (`SetupDescription` JSON) and optional
  `photos` files named by their local photo keys. Read-only, one Meta Muse Spark
  request (including a selected existing block’s default reference when no new
  photo is supplied), strict JSON schema plus ID/quantity validation. No project, block,
  image, measurement or rule is persisted. Structured measurement/direction fields,
  unknown IDs, excessive quantities, incomplete responses and unsupported expected
  text are rejected. The only provider is the configured Meta endpoint/model.
- `POST /api/setup/projects`: same multipart format, with `SetupCommit`: reviewed
  plan, mode, source, UUID `request_id`, `confirmed: true`, and optional step-photo
  mapping. One SQLite write transaction creates all new rows and stores images
  using the existing image validation/storage service. A failed write rolls back
  database rows and removes new files. Existing blocks are reused, never renamed
  or given invented measurements. New reference photos on existing blocks are
  appended; their existing first reference remains the inspection default.
- Identical retries of the same request UUID return the same project. Reusing the
  UUID with a different payload is rejected with 409. After an ambiguous network
  failure, retry unchanged; check Existing project before starting a new setup.
- Limits: 20 block types, 20 steps, quantities 1–1000 per type, one optional print
  target per step, 41 uploaded photos, 24 MiB total uploads plus existing per-image
  checks. The existing Meta request-size limit also applies to draft generation.

The additive `setup_receipts` and `step_simple_print_rules` tables preserve old
SQLite rows and stored media; no destructive migration is used. Legacy APIs remain
available. `simple_print` adds a text-only constraint to existing step APIs without
creating a physical face or placeholder millimeter measurements. Older clients
omitting that field preserve it; changing/removing its assigned target without
updating the rule is rejected. Explicit null removes it. It cannot coexist with
an advanced physical-face rule on the same step. The existing step editor can edit
or remove it before configuring physical orientation.

The print rule feeds the existing Meta observation, conservative text gate,
correction and fresh-image verification. Partial/unreadable text stays uncertain.
The rule is included in the specification fingerprint, invalidating stale progress
when edited. Legacy steps omit absent simple rules in serialization, preserving
compatibility. SAM does not certify correctness; Canny edges remain raw evidence.

## Known limits

This release does not infer hidden mechanical connections, stability, calibrated
measurements, stud offsets or physical facing direction from a finished photo.
AI-generated instructions may still be mistaken: review is required. The strict
schema rejects extra structured measurement fields; it cannot prove that all
free-text instructions are physically correct. Logo notes alone do not activate
verified logo matching; use a supported face reference in Advanced setup.

Precision configuration deliberately reuses the existing editors after saving,
rather than generating dimensions or silently activating defaults. Drafts are not
persisted across browser reloads. Saving stores referenced images; it does not run
inspection or mark a step verified. Real camera permissions and Meta account access
must work on the judge's machine. No live inference accuracy is claimed by mocked
automated tests.

## Manual acceptance checklist (requires real blocks and authorized API access)

- [ ] Open the homepage at desktop and phone widths; find Quick custom project,
      demonstration template and Existing project without documentation.
- [ ] Start with an empty library and unfamiliar blocks. Add names/colors/quantities
      without dimensions. Photograph a block; verify camera release on close.
- [ ] Describe a one-step build, optionally upload the correct finished photo, and
      explicitly request a Meta plan. Confirm the real call succeeds and note model
      and latency externally; automated tests do not establish this.
- [ ] Review/edit generated instructions and quantities. Configure the yellow
      block's text as `Involve Me` without adding a physical face or measurements.
- [ ] Confirm no project exists before final confirmation. Save, launch inspection,
      start camera and inspect the actual build. Check the exact analyzed snapshot.
- [ ] Present a wrong printed side/placement; inspect, follow correction guidance,
      capture a fresh corrected image and verify. Compare the actual evidence and
      reference; do not assume that a success label proves hidden connections.
- [ ] Repeat with multiple steps and intermediate reference photos. Confirm the
      finished photo is assigned only to the final step.
- [ ] Disable Meta access: draft generation must fail clearly, retain inputs and
      allow a fully manual project. Re-enable access before live inspection.
- [ ] Select Advanced; follow existing measured geometry/face/calibration editors.
      Confirm missing calibration remains uncertain/not_measured and no precision
      rules activate just from choosing the mode.
- [ ] Retry an unchanged save after a lost response; confirm no duplicate project.
      Open/edit an older project and confirm its images and verification still work.

Checklist intentionally remains unmarked until performed with real hardware/photos.
