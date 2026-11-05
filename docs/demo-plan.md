# Demo record

Status: **published** at <https://youtu.be/QWZPpFY55rc>. The plan below is kept as a record of
how the video was made.

| Item | State |
| --- | --- |
| Final render | `demo/remotion/out/assemblypilot-hackathon-demo.mp4`, 166.9 s, 1920×1080, 30 fps. Local only |
| Evidence for the length | [`CLIP_MAPPING.md`](../demo/remotion/CLIP_MAPPING.md): 5007 frames at 30 fps |
| Limit | At most 180 seconds |
| Public video link | <https://youtu.be/QWZPpFY55rc> |

The Official Rules score Demo at 25% and name "the quality of the demo video". The rules text
checked on 2026-11-04 states no length or format. See the
[submission checklist](submission-checklist.md).

<a id="recordings"></a>

## 🎥 Recordings

| # | Recording | Tool | Shows | Status |
| --- | --- | --- | --- | --- |
| 1 | Browser workflow | macOS screen recording | Setup, capture, verdict, correction | Recorded, local only |
| 2 | HoloLens workflow | Mixed Reality Capture | Field, hologram, guided panel, real parts | Recorded, local only |

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

<a id="editing"></a>

## 🎥 Editing

The clips are combined in the separate Remotion project in `demo/remotion/`. Its
[README](../demo/remotion/README.md) has the commands and file locations. Raw recordings, audio
and renders stay local. `uncertain` does not occur in the recordings, so the video explains it
as a labelled diagram.

## Before recording (historical)

- [ ] Fresh key with model access, and enough credit.
- [ ] Reference photos for every demo step.
- [ ] HoloLens trusts the Caddy root; the current LAN IP is in the Caddy copy.
- [ ] Remove personal data from the desktop, browser tabs and the camera's view.
- [ ] Confirm that the mascot and brick assets may be shown
      ([open questions](assets-and-licenses.md)).

<a id="video-status"></a>

## 🎯 Video status

- [x] Recording 1 and recording 2, edited into the final video.
- [x] Public video link: <https://youtu.be/QWZPpFY55rc>.
