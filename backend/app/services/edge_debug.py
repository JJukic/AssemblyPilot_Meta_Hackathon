"""Camera JPEG → local Canny; no registry, diagnosis, progress, or model dependency."""

import base64
import hashlib
from io import BytesIO
from time import perf_counter

import cv2
import numpy as np
from PIL import Image

from app.models.diagnosis import AnalyzedSnapshot
from app.models.edge_debug import EdgeDebugResult, EdgeOptions, EdgeROI
from app.services.contour_service import layer, simplified_paths
from app.services.image_processor import ImageValidationError, process_image


def extract_edges(data: bytes, snapshot_id: str, options: EdgeOptions, settings) -> EdgeDebugResult:
    started = perf_counter()
    # Reuse decode/size/bomb/format checks, with no rescaling. The normalized JPEG is
    # deliberately not used: this debug endpoint analyzes the exact camera JPEG bytes.
    native = settings.model_copy(update={"resize_max_dimension": settings.max_image_dimension})
    validated = process_image(data, native)
    if hashlib.sha256(data).hexdigest() != snapshot_id:
        raise ImageValidationError("Captured snapshot identity changed. Capture again.", 409)
    with Image.open(BytesIO(data)) as source:
        if source.format != "JPEG" or source.getexif().get(274, 1) != 1:
            raise ImageValidationError(
                "Use an upright JPEG from camera capture for edge debugging."
            )
        scene = np.asarray(source.convert("L"))
    height, width = scene.shape
    if (width, height) != (validated.width, validated.height):
        raise ImageValidationError("Camera snapshot dimensions changed during validation.")
    roi = options.roi or EdgeROI(left=0, top=0, width=width, height=height)
    if roi.left + roi.width > width or roi.top + roi.height > height:
        raise ImageValidationError("Edge ROI extends outside the captured snapshot.")
    # Filter the cropped pixels, never a black-masked full image (which creates false borders).
    crop = scene[roi.top : roi.top + roi.height, roi.left : roi.left + roi.width]
    filtered = cv2.GaussianBlur(crop, (options.blur_kernel, options.blur_kernel), 0)
    edges = cv2.Canny(filtered, options.low_threshold, options.high_threshold)
    complete = np.zeros(scene.shape, np.uint8)
    complete[roi.top : roi.top + roi.height, roi.left : roi.left + roi.width] = edges
    output = BytesIO()
    Image.fromarray(complete).save(output, "PNG")
    if output.tell() > 6 * 1024 * 1024:
        raise ImageValidationError("Edge image is too large. Select a smaller ROI.", 413)
    paths = simplified_paths(edges, (roi.left, roi.top))
    return EdgeDebugResult(
        snapshot_id=snapshot_id,
        analyzed_snapshot=AnalyzedSnapshot(
            data_url="data:image/jpeg;base64," + base64.b64encode(data).decode(),
            width=width,
            height=height,
        ),
        options=options,
        applied_roi=roi,
        edge_image="data:image/png;base64," + base64.b64encode(output.getvalue()).decode(),
        edge_pixel_count=int(np.count_nonzero(edges)),
        contours=layer(
            "canny_edges",
            snapshot_id,
            width,
            height,
            paths,
            "Raw Canny edges; no geometric match or correctness verdict."
            if paths
            else "No raw contours survived filtering. Review the edge image or adjust settings.",
        ),
        processing_ms=(perf_counter() - started) * 1000,
    )
