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
- Tracking problems never delete the placement (see "Spatial field lifecycle"
  below): a dropout holds the field, a sustained loss shows it red as LOST, and only
  an explicit Re-anchor discards it. New steps clear only the previous step
  hologram. Two consecutive failed state polls hide the step hologram (the field
  stays) and remove verified status. Anchors are session-only and deleted on
  Re-anchor/exit; persistence is not claimed.
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

## Voice command execution audit (Previous Step fix)

Transcription is not execution. An audit of the full pipeline
(mic → Whisper → normalize → match → validate → dispatch → action → visible
result) found three root causes for heard-but-not-executed commands:

1. **Stale dispatch closure (main cause).** Voice controllers are created
   once when voice is enabled, and their `onCommand` captured that render's
   action handler — including the step and revision current *at enable
   time*. "Next Step" appeared to work (it moved away from the enable-time
   step), while "Previous Step" computed its target from the stale step,
   hit the boundary or a stale-revision conflict, and returned silently.
   All voice dispatch now goes through a ref refreshed on every render, and
   navigation reads the freshest viewed-step revision from a ref.
2. **Duplicate gate suppressed legitimate repeats.** The same-action
   cooldown also blocked a genuinely new "Previous Step" spoken in the next
   listening window. For local voice, one bounded clip is one utterance
   transcribed exactly once, so duplicate protection is now the
   pending-execution lock plus one-action-per-clip; consecutive legitimate
   commands execute. (Browser speech keeps its cooldown gate.)
3. **Silent failures.** Navigation returned without a trace on boundary,
   offline and revision-conflict cases, and "Listening…" overwrote the
   outcome. Every command now produces an explicit execution outcome:
   the AR page and the holographic panel show the latest transcript, the
   matched action (or "No command matched"), SUCCESS/FAILED/REJECTED, the
   reason (e.g. "Already at first step", "Project state revision
   conflict"), and the resulting step ("Step 3 → 2"). Silent windows never
   overwrite a result. On a 409 revision conflict, navigation reloads the
   server view and retries once before reporting failure.

Safe Whisper variants added (exact phrases only, frontend/backend parity
fixture `voice-commands.json` asserted by tests on both sides):
"previous steps", "go back", "back one step", "next steps", "go forward",
"inspect step", "inspect again". Negated, ambiguous, joined or unrelated
speech still executes nothing. Recording uses the original fixed four-second
window; the premature silence-based cutoff was reverted (see below).

Automated end-to-end tests with mocked Whisper
(`frontend/tests/voice-commands.spec.ts`) assert actual results — step,
reference, instruction, hologram state via the viewed cursor, diagnostics,
exactly one inspection request for Verify Step, and microphone cleanup on
Exit AR — for every command. Real-device retest still required: repeat the
acceptance list above, especially "Previous Step" after "Next Step" and
consecutive "Previous Step" commands.

### Recording regression and restoration

`e7f03b4` added an early stop after a buffer exceeded RMS 0.02 followed by
roughly 700 ms below that threshold. A click, breath or pause between words
could end capture before the command was complete. This was reproduced by
replaying identical generated English/German speech through the recorders
from `4cd9848`, `e7f03b4`, and the correction, then running the actual locally
installed whisper.cpp `ggml-base.bin` model:

| Input after a short initial noise | Original / restored capture (~3.93 s of PCM) | Regressed capture (~0.85 s of PCM) |
| --- | --- | --- |
| Next step | Next step → next | [Music] → rejected |
| Exit A R | Exit AR → exit | [Music] → rejected |
| Nächster Schritt (de) | Nächster Schritt → next | *Klingel* → rejected |

This is generated speech with simulated WebAudio delivery and **real Whisper
inference**, not a physical headset recording. It proves the reproducible
cutoff defect, not general HoloLens recognition accuracy. The Whisper engine,
model selection, resampling and command allowlist are unchanged.

The full four-second recording window is restored. One operation now owns
session creation, capture, transcription and execution; overlapping clicks
cannot capture the same utterance twice. A later intentional utterance remains
valid without a same-action cooldown. Stop cancels capture, revokes late
sessions, and ignores late transcription responses. The shared matcher remains
strict; a backend replacement phrase cannot override rejected raw speech.

Select English for "Next Step" / "Exit AR" and Deutsch for German commands.
The language selector is shared by both voice modes, locked during a local
operation, and applied freshly on the next one-command recording. The page
shows the current recording/processing stage and retains transcript, matched
action, execution result and rejection reason in temporary UI state. Speech
during processing is not captured: wait for the next Listening window.

Physical HoloLens acceptance remains required: Next → Next → Previous,
Next/Previous at boundaries, Exit AR, a command after a breath/pause,
unknown/negated speech (no action), and Stop while processing (no late action).
Confirm one transition per completed command and report the displayed raw
transcript and rejection reason for any failure. Recheck the existing camera
and Meta Inspect flow on the device; no camera/inspection implementation is
changed by this restoration.

## Phase 6.2 — Real Meta Inspect results in the AR panel

After "Verify Step", the result no longer lives only in the desktop-oriented
workspace:

- **Result bridge.** When `/api/inspect` or `/api/verify` returns, the
  response is validated by the existing frontend validators (workflow state,
  specification and snapshot-hash identity). Only then is a bounded
  **summary** handed to the AR page via sessionStorage (30-minute TTL):
  project/step/specification/inspection/snapshot identity, state/status,
  explanation, issues (type, description, expected, observed, suggested
  fix), correction plan, next action and any requested additional view.
  No camera frames, data URLs, SAM masks or full payloads are stored. The
  summary is re-validated on load and dropped when the project, step or
  specification does not match — so stale results cannot appear for another
  step, and a failed or new inspection replaces any previous success as
  "latest". This is the *latest AI assessment*, always shown separately from
  officially verified server progress: a correct first inspection displays
  "Step verified: No — fresh verification required".
- **Camera workspace.** The real result appears immediately (existing
  DiagnosisDetails), followed by a large **Return to AR with result** button.
  WebXR cannot restart without a gesture: return to the AR page, then tap
  **Enter immersive AR** (that tap is the gesture). Tabletop re-anchoring is
  required on every new session; no anchor persistence is claimed.
- **Holographic panel.** The floating panel gains a **Result/Guide** mode
  (button or voice). It shows the status headline first — Correct,
  Incorrect/Correction Required, Uncertain/Another View Needed, Inspecting,
  Verified, or Inspection Failed — then the explanation, every issue with
  expected vs. observed and its fix, the correction plan, the requested
  additional view and the next action, paginated with "More text" (nothing
  critical is truncated). The expected reference remains visible beside the
  result; the tabletop hologram and anchor do not move when switching modes.
  Layout: a status banner (green correct/verified, red incorrect/error, yellow
  uncertain, cyan `Inspecting by Meta…`), labelled result rows (Problem /
  Expected / Observed / Fix / Why uncertain) on the left, and the inspected
  image on the right (408×344 px, aspect preserved). Frame time, resolution,
  source, freshness, model, attempts and latency are not drawn in the panel —
  they stay in the page's *Inspection diagnostics* details and the Camera view.
  The first contextual button is the main action (solid, wider); navigation,
  panel and voice controls are drawn quieter.
- **Guided view.** State banner, the short instruction, the state message and
  the paginated full instruction on the left; the instruction photo on the
  right (388×340 px instead of 358×300, aspect preserved, never under its
  "Expected result" caption). A segmented progress bar under the title shows
  done / current / upcoming steps next to "Step n of N".
- **Finish.** Before the last step a verified step offers **Next Step**. On the
  last step, once the backend progress says it is verified, the panel shows
  "Final step correct" with **Finish** (a verified response alone, Confirm
  Position or any other state never shows it). Finish re-reads server
  progress, requires the last step to be verified, never moves the cursor,
  writes nothing and makes no Meta call; it completes a running Autonomous
  run as before and shows **Assembly complete** with no further actions.
- **Voice.** New deterministic commands (frontend/backend parity-tested):
  "Show result", "Show errors", "Read result", "Read correction",
  "Back to instructions" (German: Ergebnis anzeigen, Fehler anzeigen,
  Ergebnis vorlesen, Korrektur vorlesen, Zurück zur Anleitung). They only
  change what is displayed or read aloud — they never trigger another paid
  inspection. A new inspection always requires an explicit Verify Step or
  Verify Again.

### Real HoloLens acceptance (Phase 6.2, pending personal testing)

1. See the reference photo and hologram. 2. Say "Verify Step". 3. Confirm a
fresh HoloLens frame is captured. 4–5. See the genuine Meta result on the
headset (correct/incorrect/uncertain with the actual issue and correction).
6–7. Return to AR and see the same result in the holographic panel.
8–10. Understand the error, correct the blocks, say "Verify Again".
11–13. See the updated verification result and continue building.
Automated tests mock Meta inference and cover all of these states; they do
not replace this device test.

## Phase 7 — Autonomous Assembly with stable tabletop anchoring

The assembly field (default 0.48 m × 0.32 m, yellow boundary on the
tabletop) is a child of the confirmed field origin. After you tap the
panel to confirm the origin, the field pose comes only from the WebXR
anchor (or, when `createAnchor` is unavailable, the confirmed
session-local pose — the panel says which). Step changes, inspection
results, Guide/Result switching, panel recentering and voice commands
never write the field transform. A transient anchor-pose dropout holds
the last confirmed pose as "tracking degraded"; a sustained dropout or
reference-space reset marks tracking lost instead of adopting a new
tabletop location. Re-anchoring is always deliberate (Re-anchor button).
Anchors do not persist across AR sessions in HoloLens Edge.

To use Autonomous Assembly on the MacBook + HoloLens setup:

1. Open the project AR page on the HoloLens, enter immersive AR, and
   confirm the assembly field on the real table.
2. In "Autonomous Assembly", keep the camera source on HoloLens to probe
   simultaneous camera + WebXR on the device, or use the reliable
   companion path: open the same project page on the MacBook, choose
   "External tabletop camera", list cameras, and start monitoring there.
   The HoloLens follows the server step; its field does not move.
3. Press "Start Autonomous Assembly". Placing blocks triggers one Meta
   inspection after the scene is stable and sharp; a correct result
   still needs a separate fresh verification frame. Only the backend's
   verified progress advances the step — automatically, in the same
   field. Pause keeps the camera open but analyses nothing and makes no
   Meta requests; Stop releases the camera.

Simultaneous HoloLens camera + immersive WebXR reliability, and physical
field stability while walking around the table, remain device checks —
see the Phase 7 acceptance list in PR #11. Automated tests use synthetic
frames and mocked Meta responses only; no paid inference runs in tests.

## Hand ray, panel cursor and Air Tap

In immersive AR each tracked XR input source gets a cyan ray rendered
from its `targetRaySpace` pose. The ray ends at the panel when it hits
it; a ring-and-dot cursor (plus the same ring in the panel texture)
marks the exact intersection, and the button under it highlights with
its label uppercased. Air Tap re-runs the identical ray→UV→pixel→
button hit test, so the activated button is the one you saw targeted;
selects are debounced per hand (300 ms) and a click feedback flash
confirms activation. Pointing away removes ray-end cursor and hover;
losing tracking hides the ray rather than showing a stale position.
Hand interaction never writes the assembly-field transform.

Real-device check (pending): enter AR, confirm the field, extend one
hand and confirm you see the ray; point at the panel and confirm the
cursor sits exactly under your aim; hover Next Step (highlight), Air
Tap, confirm the step changes and the field has not moved; repeat with
Previous and the other hand; point away and confirm hover/cursor
disappear; confirm Exit AR works. If no ray appears, open "XR
interaction diagnostics" on the AR page — it reports sources, tracking,
hover and the last failure reason; no tracking is ever simulated.

## Verify Step inside immersive AR

Verify Step no longer exits AR. Inside immersive AR it first tries a
real camera while the session stays active (live monitor stream, or a
fresh probe whose frame clock must demonstrably advance). A fresh
frame runs the same `/api/inspect` / `/api/verify` pipeline as the
desktop workspace, and the validated result — including print, face
and geometry gates — appears in the holographic result panel. The
anchored field is never touched by capture or results.

If HoloLens Edge provides no advancing camera frames during
`immersive-ar` (the probe reports this honestly), Verify Step instead
files an external capture request: open this project page on the
MacBook/iPhone, enter the pairing code shown in the AR status, and
press "Act as external camera companion". The companion captures the
fresh frame, runs the same inspection, and returns only the validated
summary through `/api/ar-camera`; the HoloLens polls for it and shows
it without leaving AR. Whether native in-XR camera capture works on
HoloLens Edge is a device result, not a code assumption — run the
acceptance scenario in PR #11 and record which path the probe took.

## Draggable and resizable AR panel

The instruction panel is a spatial window (default 85% size). Pinch
the title bar (⠿ AssemblyPilot) and move your hand to drag it — the
grab offset is preserved, so it does not jump; release to drop it. It
keeps that position across steps, results and view switches, and never
follows your head. Pinch the ◢ lower-right corner and move outward or
inward to resize (aspect preserved, 65–140%); the preferred scale is
remembered between sessions, the position is not (recenter instead).
A pinch that begins on the title bar or corner can never fire a
button, and a moved pinch suppresses its click. Losing hand tracking
mid-drag keeps the panel where it was. Dragging/resizing writes only
the panel mesh transform — the anchored assembly field is untouched.
Fallbacks: "Recenter panel" and "Reset panel size" on the AR page.
Real-device manipulation feel (drag smoothness, readable sizes) is a
pending HoloLens check; automated tests use mocked XR inputs.

## Inspection diagnostics: why "Uncertain"?

Every in-AR inspection now records a bounded diagnostic trace whose
correlation ID is the snapshot SHA-256 (the same fingerprint the
backend returns and validates as `snapshot_id`). The Autonomous
Assembly section shows "Inspection diagnostics (latest request)":
camera source, frame size/freshness, whether Meta was actually called
(model, attempts, latency), semantic status, print/face/geometry
gates, the combined state, and — when uncertain — the classified
cause (print / face / geometry / Meta semantic / infrastructure).
"Show Last Sent Frame" displays the exact captured frame (kept in
memory only) with its fingerprint. Black, blank or content-free
frames are rejected before upload and reported as camera failures,
never as Meta uncertainty. A transport/backend failure is an
inspection error, not an uncertain diagnosis.

## Fully autonomous monitoring (head-motion tolerant)

(Superseded by "Phase 7.1" below: change detection is now referenced to
the last inspected scene, and frame selection is a real burst whose
winner is the uploaded frame.) The changed object's bounding box is
estimated locally — if it is tiny in frame, the panel asks you to move
closer instead of spending a Meta call that would return "print not read". The full frame is always the
Meta image (the backend zoom-crops the print server-side); no crop is
fabricated or substituted. One InspectionCoordinator lease serializes
manual Verify, autonomous triggers and companion captures per step,
navigation waits for Meta, and step changes invalidate stale work.
Budgets: 20 s cooldown, 4 automatic calls per step, 12 per session.
Tick "Assess blocks already placed" to allow one controlled initial
inspection of a stable scene. Registration is approximate — the panel
never claims camera pixels and hologram coordinates are identical.

## Phase 7.1 — Spatial field lifecycle and autonomous pipeline repair

### Root cause of the disappearing assembly field (hardware report)

`SpatialSession` treated every XR `visibilitychange` away from `"visible"`
as tracking loss and called `reset()`: the anchor was deleted, the field
un-confirmed and hidden. HoloLens Edge reports `"visible-blurred"` whenever
the 2D Edge page, a camera/microphone permission prompt or system UI takes
focus — exactly what happens when Autonomous Assembly is started from the
2D page (there was no in-AR control) and the camera opens. While blurred,
the frame loop also returned early, so no preview was drawn and panel taps
were rejected: Re-anchor and Confirm could not bring the field back. The
field was also hidden whenever the step hologram was absent.

### Lifecycle now

`unplaced → preview / awaiting_confirmation → anchored ⇄ tracking_degraded
⇄ tracking_lost`, and `reanchoring` only through an explicit Re-anchor.

- `visible-blurred` / `hidden`: rendering and the anchor are kept; input is
  paused; the panel says why.
- Viewer-pose dropout: nothing is reset; tracking resumes in place.
- Anchor-pose dropout: held (orange), then LOST (red) — still drawn at the
  last pose, never relocated, recovers automatically with the same anchor.
- Reference-space reset: a native anchor is re-queried; a session-local pose
  is marked LOST (red) until you Re-anchor.
- Re-anchor: deletes the old anchor and always shows a visible preview —
  surface hit if available, otherwise a gaze-placed preview after ~1.5 s.
- The field is independent of step content; step changes swap only the
  ghost block. Status-only updates no longer rebuild GPU objects.
- **Auto ▶** on the AR panel starts/pauses/resumes Autonomous Assembly
  without touching the 2D page.
- Live diagnostics (2D page, "Monitoring & field diagnostics"): lifecycle,
  native anchor, mesh exists, rendered in the last XR frame, transform valid,
  XR visibility, head tracked, re-anchor pending, step hologram, placement
  mode, head-to-field distance/angle, last lifecycle event.

### Autonomous pipeline now

- Camera health comes from an advancing frame clock (media time; the
  video-frame callback is an extra signal and FPS source). "Monitoring" is
  never shown before frames advance; a stall pauses inspections and
  recovers automatically.
- Change detection (`changeDetector.ts`) compares each stable view with the
  reference view of the last inspected scene after robust translation and
  gain/offset registration. Head motion only re-references (no call); a hand
  passing through without a change clears itself (no call); local activity
  is latched so a placement survives later head motion; "another view
  needed" makes the next clearly different viewpoint qualify (moving closer).
- The monitoring ROI is the image centre. HoloLens Edge exposes no camera
  intrinsics/extrinsics for `getUserMedia` frames, so it is NOT projected
  from the field. Instead an approximate head-gaze gate (field within ~32°
  of head forward and ≤1.6 m) blocks inspections while you look elsewhere.
- Frame selection captures a bounded burst (≤4 full-resolution frames),
  ranks them by Laplacian sharpness, exposure and contrast, rejects only
  reliably broken/stale/duplicate frames, and uploads the winner — the
  full frame (the backend crops the print from face localisation).
- Verification: only after a "correct" inspection, with a newer frame,
  ≥5 s later. After incorrect/uncertain the next call is a fresh inspect.
  Only backend-verified progress advances; the last step stops all calls
  and releases the camera, keeping the hologram.
- Failures are classified (camera, transport, Meta provider, revision
  conflict, stale, rejected, invalid response) and never shown as
  "Uncertain"; they back off exponentially and stop after 3 in a row.
- Results for a step that is no longer current are discarded; a step
  change cancels the in-flight request. A 409 restarts with a fresh inspect.
- Budgets (unchanged values): 20 s between automatic inspections, 4
  automatic calls per step, 12 per session; Inspect Now skips only the
  cooldown. One inspection is not one provider request: Muse may be
  attempted up to 3 times (retries on 429/5xx), and SAM runs only when
  issues are reported (≤2 concepts) — worst case about 5 requests.


## Inspection capture preview in the AR panel

The floating panel has three views: **Guide** (instructions + expected
reference), **Camera** (the inspection capture) and **Result** (Meta
assessment next to the capture that produced it). Tap **Camera** to toggle.

- The Camera view shows ONLY the exact snapshot object handed to the
  inspection pipeline — the same data URL whose JPEG bytes are uploaded
  and hashed (SHA-256 = the trace correlation id). It never shows live
  video, the reference photo or a WebXR screenshot. Autonomous: the burst
  winner. Manual Verify Step: the validated capture.
- A burst where every candidate is rejected shows the best rejected frame
  labelled **NOT SENT TO META** with the reason; it is never uploaded.
- Phases follow real events: FRAME CAPTURED · VALIDATING → IMAGE REJECTED
  or "Inspecting by Meta…" (set when the HTTP request
  starts; the backend reports no intermediate progress, so no separate
  "backend received"/"Meta started" state is claimed) → INSPECTION COMPLETE
  ("Meta response received", attempts and latency as reported by the
  backend) or INSPECTION FAILED (camera / transport / provider / conflict /
  stale / rejected). A title-bar indicator (WATCHING · CAPTURED ·
  INSPECTING · RESULT RECEIVED · ERROR) is visible in every view.
- The backend re-encodes the upload (resized copy, SHA-checked in
  `analyzed_snapshot`) and may add a print crop to the Muse request; that
  crop is not returned, so the panel does not claim to show it.
- At most two decoded images are kept (latest capture, capture behind the
  shown result); replaced bitmaps are closed, late decodes of superseded
  captures are discarded, a step change clears both, session end releases
  all. Nothing is stored or uploaded for the preview.
- Results from the external camera companion arrive without an image on
  the HoloLens (no extra upload is made); the Result view then shows the
  expected reference instead of a capture.
- The preview is panel-only and never touches the field, origin or anchor.

## Guided HoloLens flow (buttons instead of voice commands)

The AR panel shows **Step X of Y**, a coloured state (Ready · Checking… ·
Correct · Try again · Partially correct · Check unavailable · Confirmed), a
short instruction generated from the step data (e.g. "Place the red 2×4 brick
on the green marker." — no camera text recognition) and at most two large
contextual buttons:

| State | Hologram | Buttons |
|---|---|---|
| Ready | transparent ghost + **green** target marker | Check Step |
| Checking… | unchanged | — |
| Try again ("Adjust the brick.") | marker + ghost **red** | Check Again |
| Partially correct / Check unavailable | marker **yellow** | Check Again · Confirm Position |
| Correct ("Step correct.") | **green** | Next Step |
| Confirmed (manual, not AI-checked) | green | Next Step |

Check Step captures a fresh image and inspects it; if it is correct, the
backend verifies a **separate, later** image automatically. Only then does
Next Step appear (no automatic advance unless Autonomous mode is on). Confirm
Position appears only when the check is uncertain or could not run; it never
writes backend verification. Next/Previous/Check/Check Again are deliberately
**not** voice commands; the 2D page shows the same guided card as a fallback.

Demo project (two steps, red 2×4 brick on a baseplate, additive only):
`cd backend && uv run python scripts/create_ar_demo.py` → prints the AR URL.

## Cumulative multi-block step holograms

Each step stores **every block placed in that step** (any number, one entry
per required block instance). The AR view is cumulative: blocks of earlier
steps are drawn **dimmed and neutral grey** (no arrow, never state-coloured);
the blocks of the current step are **highlighted** with one tabletop target
marker each, coloured by the guided state (green ready/correct, red
correction needed, yellow uncertain). Holograms are guidance only: they never
verify a step — verification still requires a fresh camera image and the
existing backend flow.

**Coordinates** (metres, relative to the deliberately confirmed tabletop
origin): X right, Y up, Z toward the user. **Position Y is the bottom face of
the block body** (Y = 0 rests on the tabletop; Y < 0 is rejected on save). The
body top is Y + body height (`dimensions.y_mm`, studs excluded) — that is where
a block stacked on it has its bottom. Rotations pivot about the bottom-centre.

**Editor** (Project → step → *Spatial AR hologram*): numbered block list
(radio group, same numbers as the 2D preview), *Add block* (an explicitly
*approximate* 10 cm proxy), *Duplicate block* (same block type keeps its
authored measurements and height, placed beside it; another type never
inherits measurements), *Remove block*, per-block target/instance, evidence
(measured/approximate), X/Y/Z mm, optional confirmed studs, position, rotation.
The **height help** explains bottom/top, what the block rests on, gaps and
intersections against all authored blocks (this and earlier steps) and offers
"Set bottom Y to the top of …" buttons. Nothing is applied automatically and
no real-world height or dimension is ever guessed; suggestions derived from
approximate blocks are labelled. The 2D preview shows a top view (click to set
X/Z) and a front height view; both stack on narrow screens.

**Storage and migration.** No schema change: the existing
`ar_placements.configuration_json` column holds either a legacy single
placement object (v1) or `{"version": 2, "placements": [...]}`. v1 rows are
read as a one-block hologram and are **not rewritten** until the step is
saved through `PUT /steps/{id}/ar-placements` (lazy migration). The legacy
`/ar-placement` endpoint keeps working for single-block steps and answers 409
for multi-block steps instead of editing them partially.
`GET /steps/{id}/ar-scene` returns the cumulative blocks up to that step; an
earlier step's block that is no longer valid (e.g. its block was removed from
that step) is left out and listed in `excluded`, while an invalid block of the
current step is an explicit 422. Saving guidance changes the step revision
(progress must be re-verified) but never creates verified progress.

**Tracking / Re-anchor.** The whole step hologram is a child of the confirmed
origin: it is hidden while tracking is lost, kept through Re-anchor and drawn
again at the newly confirmed origin. Changing steps removes the previous
step's geometry before the next scene is drawn.

## Autonomous Assembly lifecycle (Start / Pause / Stop)

Inside immersive AR the panel offers **Auto ▶ / Pause / Resume** and, while
Autonomous runs, a separate **■ Stop auto** button next to it — no 2D page is
needed (focusing the 2D slate would blur the immersive session).

- **Pause** keeps the camera open; no frames are analysed and no Meta requests
  are made until Resume.
- **Stop** clears the monitoring timer, stops the controller, aborts the
  browser request Autonomous itself started (a manual Check is not touched),
  and releases the camera tracks. It never ends the XR session and never
  changes the anchored field, the hologram or the current step. A request
  that already reached the backend cannot be cancelled there; its late result
  is ignored and cannot advance, update or restart the stopped run.
- Each run has an epoch: a camera that finishes opening after Stop is released
  immediately, and stale timer/status callbacks are discarded. Nothing restarts
  without a new explicit Start; a second Start while running is ignored.
- **Ending immersive AR stops Autonomous completely** (anchors are
  session-only, so monitoring has no trustworthy field afterwards). Start it
  again after re-entering AR. On a companion device that never enters AR,
  Autonomous is stopped only by Stop.

## AR panel: more text, English UI, HoloLens-style window manipulation

The floating panel is 1024×768 px (0.72 × 0.54 m at scale 1, default scale
0.85) — about 40 % more content height than before, without covering much more
of the workspace.

**Text.** Long step instructions (Guide view: state, short instruction,
message, then the full instruction and required bricks) and complete Meta
results (Result view: wrapped headline plus every line — expected/observed,
fixes, next action) are paginated with **More Text ▶ / ◀ Previous Text**
and a "Text page N of M" indicator. Nothing is silently cut. Pages are kept
per view; a new result starts at its first page.

**Window controls** (top bar, like a HoloLens window):
- **⠿ Move Panel** — pinch the bar and drag. The grabbed point follows your
  hand ray; push your hand forward/back along the ray to move the panel
  farther/closer (×3 gain, 0.3–3 m).
- **⟲ Rotate Panel** — pinch this handle and move your hand left/right to turn
  (yaw) or up/down to tilt (pitch, limited to ±60°). Rotation starts only on
  this handle, never from normal button taps.
- **◢ corner** — resize (unchanged).
- Air-tap fallback (no hand manipulation needed): **⟲ / ⟳ Rotate** (15°) and
  **Reset Panel Position** (upright, facing you, in front of your head).

A pinch that moves or rotates never activates a button. Releasing leaves the
panel where it is in world space (it does not follow your head). Tracking loss
during a gesture ends it at the last transform. The panel transform is
separate from the tabletop field: moving, rotating or resetting the panel never
changes the field, anchor, hologram, step, Autonomous Assembly or camera
monitoring, and Re-anchor no longer moves the panel. The panel pose lasts for
the XR session (no cross-session persistence is claimed).

**Language.** The whole UI is English. German voice aliases remain accepted as
voice input; user-entered names and AI-generated text are shown unchanged.


## Voice mode inside immersive AR + initial assembly-field rotation

### Why voice did not work in AR (root causes)

1. **Wrong recognizer on the device.** The in-AR voice path still fell back to the
   browser `webkitSpeechRecognition`. Edge on HoloLens 2 rejects it with
   `language-not-supported`, so voice silently showed "Off".
2. **No way to start voice inside AR.** Local Whisper voice could only be enabled on
   the 2D page *before* entering AR. Focusing the 2D page blurs the immersive session,
   and the panel's old `voice` action was only a push-to-talk for an already running
   controller — otherwise it returned "Local voice not enabled".
3. **Commands had been removed.** Next/Previous/Check were removed from the voice
   vocabulary (buttons only), so even working capture could not drive the guided flow.
4. **Errors were not visible in AR.** A failed session (backend/Whisper unreachable) or
   a denied microphone only updated a 2D status line.

### What voice does now

- The AR panel has **Start Voice / Stop Voice** (bottom row). Nothing records on AR
  entry. The first tap shows a consent notice in the panel ("short clips go to Whisper
  on your Mac, local, not stored"); **Confirm Voice** starts it. Consent given on the
  2D page before entering AR also works; voice can be started before or after entering AR.
- It always uses the local Whisper controller (`LocalVoiceController`, backend
  `/api/voice/*`), never `webkitSpeechRecognition` and no paid speech API. Audio clips
  are transcribed and discarded; transcripts are not stored.
- One persistent microphone stream for the whole session — the mic is not restarted
  between commands. **Stop Voice**, "Stop Listening", Exit AR and session end release it.
- A status line above the buttons shows the real state: `Voice: Off`, `Voice: Starting…`,
  `Voice: Listening`, `Voice: Processing`, `Heard “Next Step” → Executed: …` /
  `→ Not executed: <reason>`, or `Voice error: <message>` (e.g. backend unreachable,
  microphone permission denied). An error is never shown as a silent Off.
- Commands (English; German aliases exist for a few): Next Step, Previous Step,
  Show Result, Show Instructions, More Text, Previous Text, Check Step, Check Again,
  Start / Pause / Resume / Stop Autonomous, Confirm Assembly Field, Reset Panel Position,
  Stop Listening, Exit AR. They run through the same `handleAction` dispatcher as the
  panel buttons (navigation reads `viewRef`, Autonomous reads the runner), so there is no
  stale React state. Negated ("don't …"), combined ("… and …") and bare fragments
  ("next", "stop") are rejected.
- **Voice never verifies a step.** "Check Step" starts the same fresh-image inspection as
  the button; only an accepted inspection can verify.
- A failing voice command (or a voice failure) never stops rendering or Autonomous.

### Initial assembly-field rotation

- Before the field is confirmed the panel shows a **placement toolbar**:
  ⟲ 5° · ⟲ 1° · ⟳ 1° · ⟳ 5°, **✓ Confirm Assembly Field** and **Reset Rotation**,
  plus a wide **rotation bar** — pinch it and move your hand left/right to turn the
  field directly (10° of hand sweep = 5° of field). The preview turns live; the current
  angle is shown ("Field rotation: 12.0°").
- The field is the parent transform: blocks, ghosts and markers keep their stored
  positions relative to the field; nothing in the database changes.
- The surface hit-test now provides **position only** — the field no longer spins with
  the hit-test frame as you look around. Initially the field front faces you;
  Reset Rotation returns there.
- Confirm keeps the chosen orientation and hides the placement controls. After confirm
  the rotation is locked; **Re-anchor** brings back position + rotation adjustment,
  starting from the last orientation. Tracking loss and step changes keep the rotation.
- Panel move/rotate never turns the field, and the field controls never move the panel.
- The orientation is session-local (local tracking space). It is **not** persisted
  across XR sessions — after re-entering AR you place and rotate the field again.

### Tests (mocked — no HoloLens, no microphone, no real Whisper/Meta calls)

- `unit/voice-continuous.test.cjs` — voice started after XR entry runs all 15 panel
  commands once each on one stream; Stop Voice releases the mic; backend unreachable and
  mic permission denied are explicit errors; consent requires two taps; status texts;
  failing dispatch keeps listening.
- `unit/ar-phase61.test.cjs`, `unit/voice-local.test.cjs`, `backend/tests/test_voice.py`,
  parity fixture `voice-commands.json` — vocabulary, rejection, never a verified flag.
- `unit/panel-manipulation.test.cjs` — rotate before confirm, confirm keeps rotation and
  hides the toolbar, hit-test rotation ignored, block-relative transforms preserved,
  step switch keeps yaw, hand dial turns field not panel, panel rotate never turns the
  field, re-anchor with a different orientation, tracking loss keeps rotation.
- Playwright `voice-commands.spec.ts`, `ar.spec.ts` — voice navigation through the
  shared dispatcher, voice Check Step runs exactly one normal check and never verifies.

### HoloLens checks still to do by hand

1. Start the backend with Whisper on the Mac; enter AR; tap **Start Voice** → consent
   → **Confirm Voice**; Edge must ask for the microphone. Expect `Voice: Listening`.
2. Say "Next Step", "More Text", "Show Result", "Check Step": each shows
   `Heard … → Executed`, and Check Step shows the inspection result (not verified by voice).
3. Start Autonomous, then say "Pause Autonomous" / "Stop Autonomous" while it runs.
4. Stop the backend and tap Start Voice → `Voice error: …` must be visible in the panel.
5. **Stop Voice** → the Edge microphone indicator disappears.
6. Before confirming: rotate with ⟲/⟳ and the pinch bar until the field matches the
   baseplate, confirm, walk around (field must not rotate), use Re-anchor, rotate
   differently and confirm again.

## Autonomous Check Step / Check Again (uncertain hold, incorrect reassessment)

### Uncertain is a hold — Check Again is explicit

An earlier version re-checked `uncertain` automatically (5 s timer, then change or new
viewpoint). That produced repeated paid Meta requests from an unchanged, still
ambiguous view. Now:

- After an `uncertain` inspection **or** verification, `AutonomousMachine.awaitingUserCheck`
  is true and `scheduledRetry()` returns `await_user`. `AutoController.step()` returns
  before any trigger: **no timer, no change/new-view trigger, no automatic request**.
  The panel keeps the uncertain result and shows `UNCERTAIN — CHECK AGAIN`.
- Only an explicit **Check Again** (panel button or voice; in Autonomous also
  *Inspect Now*) starts exactly one new frame selection and one inspection; while it
  runs the panel shows `Inspecting by Meta…`, then the new result. If Meta says
  `correct`, the usual separate verification frame follows. Another `uncertain` → hold again.
- **Confirm Position** stays the visible manual fallback (user-confirmed, never AI-verified).
- The hold ends only with a new non-uncertain verdict, a step change or Stop. Check Again
  still respects single flight, budgets, Pause, tracking/anchor and the step guard.

### Incorrect: one bounded reassessment (unchanged)

- `incorrect` → the correction is normally detected as a change; otherwise one
  reassessment `correctionReassessMs` (60 s) later, at most `maxTimedRetries` (2) times,
  never earlier than the cooldown/back-off (`minIntervalMs`, 20 s).
- A due check still needs a steady view of the field, a **fresh frame newer than the last
  one sent**, the per-step (4) and per-session (12) budgets, single flight and — in AR — an
  anchored field in view. A rejected burst spends nothing and defers the next burst 2 s.
- `correct` → Check Again (`/api/verify`) with a separate fresh frame after
  `verifyDelayMs` (5 s). `verified` (backend) → advance exactly once.

### Panel states

`Inspecting by Meta…` (request running), `UNCERTAIN — CHECK AGAIN` (hold),
`CORRECTION REQUIRED` (with "rechecked in n s" while a reassessment is scheduled),
`CORRECT — PREPARING VERIFICATION`, `VERIFIED — ADVANCING`,
`AUTOMATIC INSPECTION LIMIT REACHED`, `LOOK AT THE FIELD`, `TRACKING LOST`,
`CAMERA ERROR`, `PAUSED`, `AUTONOMOUS OFF`. No countdown is ever shown for uncertain.

### Safety

Pause/Stop/Re-anchor/step change/session end behave as before: paused ticks return
before any decision, Stop bumps the run epoch (late results are ignored), Re-anchor
discards a prepared capture, a step change resets the verdict (and the hold) so nothing
from the old step fires on the new one.

### Tests (mocked camera and Meta — no real calls, not a HoloLens validation)

`unit/auto-retry.test.cjs` (15): uncertain hold (no timer, no change trigger, no request
for 2 min); Check Again = exactly one burst + one request, repeated until correct →
verified → one advance; Check Again refused while one runs; uncertain verification → hold;
another-viewpoint request still waits for Check Again; budget; Pause/Resume during the hold;
Stop in flight; camera stall + tracking loss block Check Again; Re-anchor during a Check
Again frame selection; late result after a step change; incorrect reassessment (bounded,
rejected frame, field out of view). `unit/result-panel.test.cjs`: result view layout.

### HoloLens checks still to do by hand

1. Start Autonomous, place a block so Meta answers `uncertain`; wait ≥ 1 min without and
   with moving the brick: no new request, the panel keeps `UNCERTAIN — CHECK AGAIN`.
2. Air-tap **Check Again**: one `Inspecting by Meta…`, then the new result.
3. Correct placement → `CORRECT — PREPARING VERIFICATION` → `VERIFIED — ADVANCING`,
   exactly one step forward.
4. Pause, Stop and Re-anchor while Check Again runs: no late request or result.
5. Move/rotate the panel while Autonomous runs — field and holograms stay put.
