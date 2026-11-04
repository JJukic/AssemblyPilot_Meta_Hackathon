# Demo plan

Status: **no recording exists.** This file is a plan, not a record. Add links here and in
the README only after a real recording has been uploaded.

The Official Rules score Demo at 25% and name "the quality of the demo video". The rules
text checked on 2026-11-04 states no length or format. Check the submission form for those
before recording. If the form requires a video, the submission is incomplete until one
exists. See the [submission checklist](submission-checklist.md).

## Recordings

| # | Recording | Tool | Shows | Status |
| --- | --- | --- | --- | --- |
| 1 | Browser workflow | macOS screen recording | Setup, capture, verdict, correction | Not recorded |
| 2 | HoloLens workflow | Mixed Reality Capture | Field, hologram, guided panel, real parts | Not recorded |

Record real, live inference only. Do not use `backend/browser_test_server.py` or a mocked
result, and do not edit a verdict into a clip.

## Storyboard

1. **Problem:** a wrong step in a physical build is easy to miss.
2. **Setup:** a small project with real parts and reference photos.
3. **Correct step:** Check Step, the separate fresh image, then Next Step.
4. **Wrong step:** a wrong part or position, the issue and suggested fix, the highlighted
   area if SAM returns one, then the correction and Check Again.
5. **`uncertain`:** a deliberately poor view. Show that nothing is sent until the user
   selects Check Again.
6. **Finish:** the last step verified by the backend, then Finish.
7. **Completion mascot:** implemented in immersive XR only. Show it in the HoloLens
   recording, and only if it works on the device.
8. **Restart Assembly:** a new run returns to Step 1.
9. **How it works:** the roles of Muse Spark, SAM 3.1 and the local checks.

Each scene needs a real outcome. If a scene does not happen live, re-record it or leave it
out and do not fake it.

## Editing

Combine the clips later with Remotion. No Remotion project is in this repository yet, and no
Python recording script is planned.

## Before recording

- [ ] Fresh key with model access, and enough credit.
- [ ] Reference photos for every demo step.
- [ ] HoloLens trusts the Caddy root; the current LAN IP is in the Caddy copy.
- [ ] Remove personal data from the desktop, browser tabs and the camera's view.
- [ ] Confirm that the mascot and brick assets may be shown
      ([open questions](assets-and-licenses.md)).

## Still missing before submitting

- [ ] Recording 1 and recording 2, edited into the final video.
- [ ] Public or unlisted video link, if the form asks for one.
- [ ] All submission form fields, checked after signing in to the portal.
- [ ] Date and commit shown in the video, noted in `docs/submission-readiness.md`.
