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

## Phase 6.1 — Reference photograph, readable panel and hands-free voice

**Hardware update:** the owner has now opened the immersive experience on a real
HoloLens and can see the holographic building block. That single observation is
confirmed. Everything in this section (reference photo in-headset, voice,
readability, anchoring while reading) still requires the personal real-device
checklist at the end of this file. Do not treat automated tests as hardware
validation.

### Expected reference photograph in the panel

- The panel shows the **selected** expected assembly photograph for the viewed
  step: the backend orders a step's images with the explicitly selected
  reference first (`StepReferenceSelection`, chosen in the project editor via
  "select reference"), and the AR workspace uses exactly that first step image
  (`selectedStepReference`). It never substitutes a block-library photograph.
  With no explicit selection, the earliest registered step photo is the
  existing fallback, matching inspection behaviour.
- The image is loaded only from the trusted backend media endpoint
  (`/api/media/{id}`, via `mediaUrl`), drawn into the panel canvas with its
  aspect ratio preserved (letterboxed, never stretched), and labelled
  "EXPECTED REFERENCE". It is guidance only — separate from the real camera
  view and never evidence that the physical build is correct.
- Switching steps immediately clears the previous bitmap (no stale photo),
  closes/disposes the obsolete `ImageBitmap`, and shows a clear placeholder
  ("No reference photo for this step") in an image-free compact layout when
  none is registered. Loading errors show the placeholder plus an error note.
  No reference images are generated or invented.

### Instruction panel

The holographic panel (72 × 45 cm, one fixed 1024 × 640 canvas texture — no
per-frame texture allocation) shows: step *n* of *N*, step title, the full
instruction paginated with a "More text" button (never silently truncated),
the expected reference, required block(s) and quantity/instance, a high-contrast
verified / not verified / uncertain status, listening status and the last
recognized command. Large buttons (≥ 80 px canvas height): Previous, Next,
Verify Step, a red **EXIT AR**, Re-anchor, Recenter, Reference show/hide,
More text and Help. The ghost placement hologram lives in a separate spatial
layer and is not moved by Recenter; Recenter only repositions the panel.
Tap the panel above the buttons to confirm the tabletop origin.

### Voice commands (browser SpeechRecognition)

Voice is **off by default** and starts only after the user checks the consent
box and taps **Enable voice control** on the AR page. Detection checks
`SpeechRecognition`/`webkitSpeechRecognition`, secure context and microphone
errors; desktop support does not prove HoloLens Edge support, and recognition
inside immersive WebXR may be unavailable — an honest unsupported status is
shown and all manual controls remain.

| Spoken (English) | Action |
|---|---|
| Next step / Previous step | Browse steps (never verifies) |
| Verify step | Ends XR and opens the existing camera verification for the current project+step |
| Show reference / Hide reference | Toggle expected photograph |
| Show instructions | Go to the full instruction |
| Read instructions | Text-to-speech, only if the read-aloud toggle is enabled |
| Re-anchor / Recenter | Reset tabletop alignment / recenter panel |
| Help / Show commands | List commands |
| Stop listening | Disable microphone immediately |
| Exit AR | Stop microphone, end XR session cleanly |

German aliases (set Voice language to Deutsch/de-DE): *Nächster Schritt,
Vorheriger Schritt, Schritt prüfen, Referenz anzeigen, Anleitung vorlesen,
AR beenden*. An optional "AssemblyPilot" prefix is accepted. Matching is a
deterministic normalized allowlist (no LLM): only finalized results, exact
phrases; ambiguous, negated, joined or unrelated speech is rejected;
duplicates are debounced and repeats are blocked while an action is pending;
the recognized command is shown on the panel and page.

**Verify step limitation (first deliverable):** saying "Verify step" initiates
the existing inspection workflow only. If the HoloLens cannot capture a
suitable photo during immersive WebXR, the session ends safely, the correct
project/step camera screen opens, and a **fresh real photograph is required**
— use the Mac/iPhone camera workflow on the same project/step; the result
synchronizes back to the HoloLens via server progress polling. The spoken
command never marks a step verified, never reuses a stale snapshot, and never
triggers repeated Meta inference. No cross-device automatic capture is
implemented or claimed.

### Microphone privacy

No new AI provider is added; Meta remains the exclusive assembly-inference
provider. Browser recognition (notably Microsoft Edge) may transmit audio to
the **browser provider's** cloud speech service — this is disclosed before
consent, cannot be reliably detected per-device, and is not AssemblyPilot
inference. No raw audio is sent to or stored by the AssemblyPilot backend; no
recordings or full transcripts are stored (only the short-lived last command
is displayed). Recognition stops on XR exit, on "Stop listening", on opt-out
and on page unmount; permission denial and errors are shown and never cause
an uncontrolled restart loop. There are **no automatic recognition restarts**;
every retry requires clicking **Enable voice control** again.

### Voice diagnostics on the device

The Voice controls show **Off**, **Starting**, **Listening**, **Stopping**,
**Unsupported** or **Error**, plus the exposed constructor (`SpeechRecognition`,
`webkitSpeechRecognition`, or none). Only the recognition service's `onstart`
event establishes Listening. Startup times out after ten seconds without that
event. Constructor presence and microphone permission do not prove that Edge
can use its speech recognition service.

Errors remain visible after `onend`, including `not-allowed`,
`service-not-allowed`, `audio-capture`, `network`, `language-not-supported`,
`ended-before-start` and `unexpected-end`. Record the displayed code, message
and constructor on the HoloLens; these changes alone do not establish headset
speech compatibility.

**Test microphone access** is a separate, explicit permission request. It calls
`getUserMedia({audio:true})` only when clicked, immediately stops all returned
tracks (including late permission grants), and never records or uploads audio.
A passing test confirms audio capture only. If recognition fails while this
test passes, the reported blocker is in browser speech startup/service access,
not basic microphone access. Browser error codes can identify a denied or
unavailable service but do not always distinguish device limitations from
enterprise policy or network restrictions.

### Exiting AR

Use the large red **EXIT AR** panel button, say "Exit AR", use the large
**Exit AR** button on the page between sessions, or use the HoloLens Start
gesture for the system menu — AssemblyPilot never intercepts system
navigation. Every exit path stops the microphone, closes reference bitmaps,
cancels hit testing/anchors and disposes the renderer.

### Native alternative

If Edge on the device exposes no usable `SpeechRecognition` in immersive
WebXR, the documented fallback remains a native Unity/OpenXR client using the
the built-in Windows keyword recognizer, with the UWP microphone capability,
against the same backend APIs (see "Native fallback" above). Map recognized
fixed commands to the existing Next/Previous/Verify/Exit actions; do not send
raw microphone audio to AssemblyPilot. This requires a separate native client;
it is not a browser polyfill and is not implemented by this fix. No paid speech
service is required for that built-in recognizer. See Microsoft's
[MRTK3 speech documentation](https://learn.microsoft.com/en-us/windows/mixed-reality/mrtk-unity/mrtk3-input/packages/input/speech).
Browser voice must not be claimed HoloLens-validated until tested on the
physical device.

## Real HoloLens test checklist — Phase 6.1 (all pending personal testing)

- [ ] A. Expected reference visible in both eyes, correct step, undistorted.
- [ ] B. Readable full step description; "More text" pages long instructions.
- [ ] C. "Next step" works through voice and shows the correct next step.
- [ ] D. "Previous step" works through voice.
- [ ] E. "Verify step" opens the correct project/step inspection; a fresh photo is required.
- [ ] F. "Exit AR" works through voice, the large EXIT AR button, and the Start gesture.
- [ ] G. Microphone stops on session exit (no listening indicator afterwards).
- [ ] H. Physical hologram remains anchored while viewing the reference panel.
- [ ] I. Voice Next/Previous/Verify do not advance verified progress by themselves.

## Local voice control + HoloLens camera verification (Mac backend Whisper)

Confirmed on the owner's HoloLens 2: immersive WebXR works, the microphone is
reachable, but browser `webkitSpeechRecognition` fails with
`language-not-supported` — **the Web Speech API is not usable for commands on
this headset**, and a live camera image already works in the AssemblyPilot
camera workspace on the HoloLens itself. The primary voice path is therefore
local; no Unity app, Windows PC or cloud speech service is involved. (The
earlier browser-speech UI remains only as a legacy fallback and must not be
relied on for HoloLens.)

### How it works

1. On the AR page, check the local-voice consent box and tap **Enable local
   voice control** (or **Record one command (push-to-talk)** for a single
   bounded clip). The HoloLens microphone is captured with `getUserMedia`
   in bounded ~4-second windows (16 kHz mono WAV, encoded in the browser).
   Enable it before entering AR if mic access during immersive WebXR proves
   unreliable on your headset — simultaneous mic/WebXR access must be tested
   on the device and is not assumed.
2. Clips are sent over the existing private HTTPS origin to
   `POST /api/voice/transcribe` with a short-lived voice-session token
   (`POST /api/voice/session`, 10-minute TTL, per-session rate limit, size
   and duration limits). Whisper runs **locally on the MacBook**; temp audio
   and transcript files are deleted immediately. Nothing is stored or logged.
3. The transcript is matched by the same deterministic allowlist as before
   (no LLM): Next Step, Previous Step, Verify Step, **Verify Again**, Show
   Reference, Hide Reference, Re-anchor, Exit AR (plus the earlier panel
   commands and German aliases). Unknown/ambiguous/negated speech is
   rejected, duplicates are suppressed, and each clip triggers at most one
   action. Recognized commands reuse the existing action dispatch.
4. **Verify Step:** voice stops, XR ends safely, and the HoloLens camera
   workspace opens for the current project/step with a voice-verify intent.
   The camera starts automatically, one **new** frame is captured from the
   actual HoloLens video stream (never the WebXR canvas, never a stale
   snapshot — frames older than the voice command are rejected), and it is
   submitted to the existing `/api/inspect` Meta pipeline. The real result
   (correct / correction required / uncertain, with issues and corrective
   guidance) is displayed on the HoloLens. No iPhone/Mac camera satisfies
   this flow.
5. **Verify Again:** after correcting the build, the same flow captures
   another fresh frame and calls the existing `/api/verify` endpoint with
   the previous inspection identity. Verified progress changes only under
   the backend's existing rules; speaking a command never verifies a step.

### Mac setup (Apple Silicon, no Windows)

Preferred engine — whisper.cpp with Metal acceleration:

```sh
brew install whisper-cpp
mkdir -p ~/.local/share/assemblypilot-voice
curl -L -o ~/.local/share/assemblypilot-voice/ggml-base.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
```

Then set in `backend/.env` (see `.env.example`): `VOICE_WHISPER_COMMAND=whisper-cli`
and `VOICE_WHISPER_MODEL_PATH` to that file, and restart the backend.
Measured on the owner's M1 MacBook Air: whisper.cpp `base` transcribed a
1-second command in ~1.5 s with an exact match. openai-whisper (`whisper`,
`VOICE_WHISPER_MODEL=tiny`) also works as a fallback but reloads its model
per clip (~30 s first run; `medium` timed out) and is not recommended.
Models are never committed (`*.bin` is gitignored). Check
`GET /api/voice/status` for engine availability; the AR page shows it too.
Without a local engine the endpoint returns an honest 503 and manual
controls remain fully available.

### Privacy and separation

Microphone clips go only to your own Mac backend over the private LAN
HTTPS origin. They are not sent to Meta (Meta remains the image-inspection
provider only, key server-side), not to any cloud speech service, and are
neither stored nor logged. Voice sessions are explicit, bounded,
rate-limited and revocable; stopping voice, exiting XR or leaving the page
releases the microphone and revokes the session.

## Required HoloLens acceptance test (pending personal testing)

1. Open AssemblyPilot and view the hologram.
2. Enable local voice recognition.
3. Say "Next Step" and confirm correct navigation.
4. Say "Verify Step".
5. Confirm a NEW actual HoloLens camera frame is captured.
6. Confirm it is submitted to the existing Meta inspection backend.
7. Confirm the actual result is displayed on the HoloLens.
8. Correct an intentionally incorrect assembly.
9. Say "Verify Again".
10. Confirm a new image runs fresh-image verification.

Automated tests cover the endpoint, matching, limits, intent freshness,
auto-capture request submission and cleanup with mocked transcription and
no Meta calls. They do not replace this device test.
