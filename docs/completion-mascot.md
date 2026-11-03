# Completion hologram

The original user-supplied Meshy GLB is stored, unchanged, at
`frontend/public/assets/meta-mascot-animated.glb` (24,597,708 bytes). Its actual
clips are `Running`, `Walking`, `FunnyDancing_02`. It has no Wave or Idle clip.
This asset therefore walks in, dances and rests; missing phases are skipped.
No replacement model or generated animation is used.

Finish remains an explicit action on the final server-verified step. It rechecks
progress, rejects in-flight inspections and changed step/run/session context, and
never invokes Meta. In an active XR session a confirmed assembly origin is required.
GLTFLoader is invoked only by Finish. AnimationMixer drives the supplied clips:
Walk/Running → Wave → Dance/Celebrate/Jump → Idle, using available names. Without
any clips, the loaded original model rotates slowly and floats slightly.

`src/lib/ar/mascot.ts` holds the scale, start/finish positions, rotation speed and
float amplitude. The presentation height is 0.3 metres (a visual choice, not a
measurement). The mascot has an independent child transform beside the default
48 cm assembly field; imported horizontal skeletal root motion is suppressed so
it cannot add uncontrolled travel. The original assembly pose, block transforms,
calibration and verification data are untouched. The unlit cyan material fades
in, uses no additional lights/particles, and the existing panel renders in front.

Restart uses the existing new-run API and Step-1 workflow. It disposes the mascot,
mixer bindings, geometries, original/holographic materials, textures and skeleton
resources. Re-anchor removes the mascot and leaves the existing re-anchor controls
unchanged; mascot cleanup itself never alters the field. Exit XR removes it;
re-entry requires a new Finish. Late loads are disposed using a generation guard.
Load/parse failure keeps XR and Assembly complete visible, with
`Completion hologram unavailable`. Outside XR the existing completion view and
2D assembly preview remain available; no substitute mascot is fabricated.

## Manual HoloLens check (pending)

1. Use trusted LAN HTTPS, confirm the tabletop origin and verify the final step.
   No mascot should load before Finish or while a check is running.
2. Select Finish. Confirm Assembly complete remains readable; the cyan mascot
   walks beside the field, dances, then rests. This asset cannot wave or play Idle.
3. Move your head: assembly blocks and field stay fixed. Check performance and
   first-load delay: the original file is about 24.6 MB and has three PNG textures.
4. Restart: mascot disappears, Step 1 begins and no camera/Meta action starts.
5. Finish again; exit XR during loading and re-enter. No old model may appear.
6. Test a failed asset request and re-anchor: controls, completion state and the
   existing assembly workflow remain usable.

Automated XR/GPU tests do not establish physical alignment or HoloLens frame rate.
No actual HoloLens is attached to this cloud environment.

## Executed checks

- `npm run typecheck`, `npm run lint`, `npm run test:unit` (275 passed),
  `npm run build`: passed.
- Chromium: 14 existing AR/guided-flow cases passed; original GLB decoding with
  textures/skeleton/clips passed after fixing a missing test-only module route.
  The Finish/Restart browser case passed again after the final UI adjustment.
- Uploaded and installed asset SHA-256:
  `99ce193931b3077918fdc663804e44255cc873b519319deab3150a74aa53406c`.
- No paid Meta requests or physical HoloLens validation were performed.
