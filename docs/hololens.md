# Spatial assembly guidance (Phase 6)

**Hardware status: not validated.** The owner reports that the HoloLens is offline
and disconnected. No device/browser version or successful immersive session was
observed. This implements a WebXR vertical slice, not a claim that the installed
HoloLens Edge build supports it. Desktop tests mock XR poses and the GPU; they
cannot establish stereoscopy, physical scale, tabletop alignment or drift.
PR #10 (the setup wizard) was merged before this work; this feature branches from
main, not from an open wizard branch.

## Start with two real blocks

1. Use **Try AssemblyPilot with Your Own Blocks** to register two blocks and create
   two instructions, for example a base and a second block on the base. Review and
   confirm the plan. Neither AI nor AR infers hidden connections or dimensions.
2. In the project editor, edit a saved step and open **Spatial AR placement**.
   Choose the target/instance; enter your measured rectangular body dimensions,
   an intended position and rotation, then explicitly confirm and save. Dimensions
   are your measurements, not computer-verified measurements. Stud geometry is
   optional and requires registered grid counts and your measured pitch, diameter
   and height. An absent placement has **no exact 3D target**.
3. Open **Spatial AR** from that project or the camera workspace. Access the same
   project URL on the HoloLens over trusted LAN HTTPS (below).
4. Read the capability result. `navigator.xr` and
   `isSessionSupported('immersive-ar')` must succeed. Only clicking **Enter
   immersive AR** requests a real session. Unsupported devices retain an explicitly
   labelled **2D preview**; no ordinary 3D canvas pretends to be mixed reality.
5. A cyan ring indicates a candidate horizontal surface if hit testing is available.
   It is not a semantic guarantee that the surface is your table. Otherwise use
   **Nearer/Farther/Lower/Higher**, head position and manual alignment. Confirm the
   physical table origin using **Confirm origin**, then rotate the origin if needed.
   The ghost is provisional and follows the candidate until confirmation.
6. After confirmation the model uses the tracked world reference, independent of
   head movement. When available, `XRFrame.createAnchor` maintains a session anchor.
   Otherwise a clearly reported local reference-space placement is used; drift
   remains possible. **Re-anchor** resets placement. **Recenter panel** only moves
   the instruction panel back in front of the user; it does not move the assembly.
7. **Previous/Next** browse instructions, never verify them. **Verify Step** ends XR
   and opens the existing camera workspace at the selected project/step. Capture a
   new image and use existing inspection/correction/fresh-image verification.
   If camera access is unavailable on the headset, open the displayed verification
   link on your iPhone/Mac. Return to AR to see server verification status (polled
   every three seconds, without model inference). Re-entering XR requires re-anchoring.

The floating panel accepts WebXR `select` events using the input source's target ray
(e.g. supported hand pinch, controller, or gaze-select). Runtime/browser support is
required; there is no invented hand tracking. Recenter the panel before it leaves
comfortable viewing range. Controls are also exposed on the page between sessions.
The panel is 64 × 32 cm at an initial 85 cm distance with large contrast controls;
long instructions are shortened in XR and remain complete on the page. Real-device
legibility and supported input must be checked before demoing.

## Coordinates, evidence and rendering

- Right-handed local origin: X right, Y up, Z toward the user after manually rotating
  the origin to that convention. It is **not** the phone/Mac ChArUco coordinate
  frame. No ChArUco transforms, camera intrinsics or SAM boxes become XR poses.
- Saved target positions are metres relative to this origin. The pivot is the
  centre of the bottom of the rectangular body. Rotation is XYZ Euler degrees.
  Body dimensions are millimetres, converted exactly by `/ 1000`; scale stays 1.
  Body height excludes studs. Assembly height/contact must be authored, not inferred.
- One target instance is rendered per step. Quantity, instance, actual block color,
  instruction and inspected/unverified state are displayed. The visual itself is
  translucent cyan with an outline and arrow to distinguish it from physical parts.
- Unknown/custom shapes have no invented detailed mesh. An explicitly selected
  **10 cm alignment box (approximate)** is a session-only proxy; it is not saved or
  described as measured. For arbitrary shapes, the editor also supports a confirmed
  approximate bounding proxy. Measured procedural geometry requires a rectangular
  registered block. GLB/glTF imports are deliberately not included in this slice.
- No model or public asset downloads occur. Three.js is bundled; the renderer uses
  the XR compositor's tracked views/projection, a single target, simple unlit
  geometry and low-resolution stud cylinders. No continuous inference or new models.
- Tracking loss, visibility loss, reference-space reset and lost anchor hide the
  target and require fresh confirmation. New steps clear the previous target before
  loading metadata. Failed state polling hides the hologram and removes verified
  status. Anchors are session-only and deleted on reset/exit; persistence is not claimed.
- Virtual placement never supplies physical inspection evidence. Existing Muse Spark,
  SAM 3.1, exact-snapshot identity, OpenCV, Active Vision, corrections and fresh-image
  verification remain authoritative. Viewed steps and verified progress are separate.

## Private LAN HTTPS

The development API is unauthenticated. Keep both servers on loopback; expose only
a TLS proxy bound to the PC's **private** LAN address, restricted by firewall to
trusted devices. Do not use public tunnels, public port forwarding, or expose port
8000. This setup is for a trusted local demo network, not public deployment.

Install Caddy on the serving machine. Copy `deploy/Caddyfile.hololens`, replace both
`192.168.1.50` occurrences with the serving machine's private LAN IP, and keep that
address stable. Build with an **empty** browser API base so requests use HTTPS on
the same origin (this value is baked into the Next.js build):

```sh
cd frontend
NEXT_PUBLIC_API_URL='' npm run build
npx next start --hostname 127.0.0.1 --port 3000
```

In separate terminals, from the repository:

```sh
cd backend
uv run --frozen uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```sh
caddy run --config deploy/Caddyfile.hololens --adapter caddyfile
```

Allow the proxy to bind HTTPS with the appropriate OS service privileges. Caddy's
internal CA issues the local certificate. On each client, including HoloLens,
install/trust **only the CA public root certificate** from Caddy's data directory
(`pki/authorities/local/root.crt`); never distribute its private keys. Follow
[Microsoft's HoloLens certificate manager guide](https://learn.microsoft.com/en-us/hololens/certificate-manager).
Open `https://YOUR_PRIVATE_IP` in HoloLens Edge and verify that the certificate is
trusted and `window.isSecureContext` is true. Bypassing a certificate warning is not
a supported setup. If enterprise/device policy prevents certificate trust, use an
approved internal certificate authority instead of disabling TLS checks.

The proxy forwards `/api/*` and `/health` to loopback FastAPI and everything else to
loopback Next.js. The Permissions-Policy allows same-origin XR and camera. Meta
credentials remain in backend configuration only: never in `NEXT_PUBLIC_*`, page
URLs, certificates or frontend environment variables. Use the same HTTPS URL for
the iPhone/Mac verification workflow so state and snapshots are shared.

## Storage/API and rollback

Two additive tables are created idempotently by the existing SQLModel startup
schema mechanism: `ar_placements` (one optional JSON configuration per step) and
`ar_views` (one shared viewed-step cursor per project). No existing columns, photos,
SQLite records or configuration keys are rewritten. Existing projects need no AR
metadata and continue to use the camera workflow. No spatial anchor is stored.

- `GET/PUT/DELETE /api/projects/{project}/steps/{step}/ar-placement`: strict finite
  bounds, assigned block/instance, dimensions, optional stud-grid consistency and
  explicit confirmation. Unknown asset/coordinate fields are rejected. Changing or
  removing guidance touches the existing step revision and invalidates old progress.
- `GET/PUT /api/projects/{project}/ar-view`: viewed step plus optimistic `revision`;
  stale writers receive 409. This cursor never changes verification progress.
- Existing `/api/projects/{project}/progress` supplies verified state. A camera link
  contains both `project` and `step`; AR clients share their viewed cursor. Camera
  browsing remains manual and does not silently move another device's AR target.

Before deployment, stop writers and back up the configured SQLite file and upload
folder. Rollback needs only the previous application code: extra tables are ignored.
If table removal is required, stop all writers, back up the database and explicitly
execute `DROP TABLE ar_views; DROP TABLE ar_placements;` on that backup-tested database.
This discards only AR authoring/cursor data, not projects or images; no automatic
destructive downgrade is provided. Per-step deletion via the API is reversible by
resaving a previously exported placement.

## Native fallback: Unity + OpenXR

If actual HoloLens Edge reports no immersive AR, cannot establish stable world
tracking, or cannot provide usable input, use the 2D view only for planning. Do not
claim WebXR device compatibility. A native fallback is a separate deliverable:

1. Create a HoloLens 2 ARM64 Unity project with Microsoft's supported OpenXR runtime
   and appropriate mixed-reality input components. Validate build/device OS support.
2. Reuse the project, placement, viewed-cursor and progress APIs over trusted private
   HTTPS. Keep inference keys on the backend. Convert the documented coordinate
   convention explicitly to Unity's convention and test scale/orientation on hardware.
3. Replace WebXR hit testing/anchors with platform spatial mapping/anchors and
   native hand/ray UI. Add QR anchoring only through a supported native QR API, with
   consent and an explicitly measured marker-to-origin transform. This WebXR slice
   neither requests QR APIs nor claims automatic QR support.
4. Keep the same manual versus verified distinction and launch/synchronize camera
   verification through the backend. Persistent anchors and native camera streaming
   require separate device validation; neither is inferred from the existing connection.

## Real HoloLens 2 acceptance checklist (all pending)

Record device OS, Edge version, private URL, secure-context/capability results,
input method, optional hit-test/anchor support and any drift. Do not tick a physical
check based on automated mocks.

- [ ] Trusted LAN HTTPS; no certificate warning; API keys absent from browser requests.
- [ ] Actual `immersive-ar` starts only after a gesture; both eyes show a stereoscopic,
      translucent target over the real table, not a flat browser image.
- [ ] Two real registered blocks, two saved steps, measured target dimensions and
      manually confirmed origin. Compare ruler-measured size, pivot and rotation.
- [ ] Move/rotate head, lean sideways and walk around: target stays on the table.
      Record drift over several minutes and working distances.
- [ ] Hit-test surface confirmed on the table; verify manual alignment fallback when
      hit testing is absent. Test native anchor support and reported local-space fallback.
- [ ] Rotate/reposition origin, recenter panel and test every hand/gaze/controller
      button. Check instruction and quantity legibility against bright/dark backgrounds.
- [ ] Previous/Next select correct block/instruction without changing verified progress.
- [ ] Cover tracking cameras/change room lighting: ghost hides on tracking loss and
      demands re-alignment. Reset reference space, remove/reconnect headset, exit/re-enter.
- [ ] Disconnect backend/network: no trusted stale target/verified status; reconnect
      loads current step; changed metadata/removed targets cannot leave old geometry.
- [ ] Place the physical part, explicitly Verify Step, capture a fresh image on a
      supported camera, receive a real inspection/correction, then fresh-image
      verification. Re-enter AR and observe server status. Never substitute the ghost
      for actual evidence. Paid Meta requests here are manual, outside automated tests.
- [ ] Unsupported Edge/browser: clear unavailable state and 2D fallback, no false AR
      success. Decide whether to proceed with the documented native OpenXR implementation.
