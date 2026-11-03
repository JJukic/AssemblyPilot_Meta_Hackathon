# Independent Edge Detection Debug Mode

The **Settings → Debugging** section (`/settings`) offers **Edge Detection Debug Mode**
for its latest captured camera snapshot, including the practice demo and projects with no successful
inspection. No Muse diagnosis, SAM mask, ORB match, model key or registered face
is needed. The existing evidence-backed contour controls remain available in the
inspection panels.

## Use

1. Start the camera and capture a snapshot in **Workspace** or **Settings**.
2. Open **Settings** beside **Projects** and enable **Edge Detection Debug Mode**
   in the Debugging section. The same latest snapshot is available on both pages.
3. Optionally drag a rectangle directly on **Original captured snapshot**.
   The ROI is expressed in native image pixels, independent of CSS size. Reverse
   drags work; selections must be at least 2×2 pixels. Keyboard users can enter
   left/top/width/height under **ROI pixel coordinates**. **Use full image** resets
   the selection; this is the default.
4. Choose an odd Gaussian kernel from 1–21 (1 means no blur), and Canny low/high
   thresholds with `0 ≤ low < high ≤ 255`.
5. Select **Detect edges**. This explicitly uploads the JPEG to local FastAPI for
   OpenCV processing, without AI requests or image persistence. Changing a control
   clears old edge evidence; it does not send another request automatically.
6. Compare the original JPEG and full-resolution binary edge image side by side
   (stacked on narrow mobile screens). Enable **Raw Canny edges overlay** to show
   transparent amber dashed traces on the original. The optional overlay starts off.

Raw edges are visual structure, not assembly correctness or registered-face
identity. The independent SAM Outline and Reference Match toggles remain on their
own validated inspection snapshots, which can have different hashes/resolutions.
Debug output is never substituted for those layers, and it never updates a
semantic diagnosis, face rule, correction plan, inspection history or verified
progress. It also does not trigger SAM to obtain missing evidence.

Workspace ↔ Settings navigation retains edge settings and evidence in memory.
The mode defaults to off (blur 3, low 50, high 150, full image, overlay off).
A new snapshot or camera source still resets these values as before. No edge
preferences or photographs are written to localStorage or sessionStorage.

## Endpoint and image identity

`POST /api/vision/edges` takes multipart fields:

- `image`: upright camera JPEG, under the existing configured image/upload limits.
- `snapshot_id`: SHA-256 of the **exact uploaded JPEG bytes**.
- `options`: JSON, optionally containing `blur_kernel`, `low_threshold`,
  `high_threshold` and `roi: {left, top, width, height}`. Null/omitted ROI means
  the complete image.

`services/edge_debug.py` reuses the existing Pillow validation with native-size
settings, but deliberately does **not** analyze the validator's re-encoded output.
It decodes the original upright JPEG and returns those original bytes unchanged.
There is no downsampling, EXIF rotation or lossy re-encoding in the debug result;
non-JPEG or EXIF-rotated uploads are rejected with capture guidance. This endpoint
is for camera snapshots, not a second reference-photo import pipeline.

Canny runs on the real ROI crop after Gaussian blur, rather than a black-masked
full image that would introduce false ROI borders. Its binary output is placed at
the original pixel offset in a full-resolution grayscale PNG. All pixels outside
the ROI are zero. The response contains the unchanged analyzed JPEG, hash,
requested settings, applied ROI, edge PNG, count of detected edge pixels, processing
time and the existing bounded `canny_edges` contour-layer contract. A valid blank
edge image is a successful extraction with zero detected pixels; it does not
manufacture an outline.

The transparent vector overlay reuses `contour_service.simplified_paths` and its
64-path / 128-vertex / 4096-total-point bounds. The binary edge image retains all
detected pixels even when small traces are filtered or the overlay budget is
reached. The PNG response is limited to 6 MiB. One debug extraction runs at a time
per backend process; concurrent requests receive a clear retryable 429 message.
No dependency, database table or Meta call is added.

## Stale data and errors

The browser binds results to the uploaded hash, exact JPEG data URL, native image
dimensions, settings and ROI. It validates contour bounds, PNG dimensions/format
and decoded image dimensions before displaying overlays. Changing ROI or controls,
disabling debug mode, switching camera or capturing again aborts the active browser
request and invalidates its generation. Late responses cannot replace current
evidence. A new snapshot resets the optional debug panel. Cancellation may not
stop a native OpenCV operation already running on the backend; it cannot update
the browser after invalidation.

Invalid controls/ROIs, corrupt input, changed snapshot identity, unavailable backend,
OpenCV extraction errors and invalid response evidence produce explicit errors.
Errors do not overwrite previous AI inspection results. Nothing is drawn on live
video and no frame loop runs.

## Validation and limits

Synthetic backend tests cover no-key/no-project use, native resolution above the
ordinary resize limit, byte identity, full-frame and ROI extraction, threshold/blur
response, invalid controls, stale hashes, failure/busy handling and blank results.
Playwright uses the actual isolated OpenCV endpoint for ROI selection, control
changes, responsive overlays and side-by-side images. Delayed-response tests cover
new captures/settings, injected failures cover errors, and a workflow regression
checks that edge debugging preserves the existing correction state.

Manual thresholds use OpenCV's ordinary 8-bit grayscale Canny gradient behavior
(aperture 3, default L1 gradient), not a calibrated quality or matching score.
Full-frame mode intentionally includes background texture; choose a smaller ROI
when that is distracting. Blur can remove useful fine edges; reflections and weak
contrast remain difficult. The original camera JPEG may already contain capture
compression artifacts. No real-camera accuracy benchmark or paid Meta inference
was performed for this debug feature.

## Edges directly on the inspected image

In **Meta AI inspection**, choose **Detect Canny edges** immediately above the
analyzed snapshot. Local OpenCV analyzes that exact returned JPEG (which may be
smaller than the original camera capture), then enables **Canny Edges** on the
same image. It works without SAM or reference matching. The checkbox hides/shows
the amber contours; **Show original** hides all annotations. This shortcut uses
the complete image with Gaussian kernel 3 and Canny thresholds 50/150. The
separate debug workstation retains adjustable thresholds and manual ROI controls.

No additional AI request is made and no diagnosis/progress is changed. Image
identity and contour coordinates pass through the existing edge-response
validation. A new capture or inspection discards the result and aborts pending
extraction; errors and empty evidence never produce fabricated contours.
