"""At most one supported planar crop in the existing Muse request, never another call."""

import base64
import hashlib
from dataclasses import replace
from io import BytesIO

import cv2
import numpy as np
from PIL import Image

from app.models.multimodal import InspectionImage
from app.services.image_processor import ProcessedImage
from app.services.print_recognition import configured_side


def add_print_crop(request, face):
    expected = configured_side(request.context)
    if (
        not expected
        or expected.print_rule.recognition_mode == "contour"
        or face.method != "orb_ransac_canny"
        or not face.analyzed_snapshot
        or len(face.quadrilateral) != 4
    ):
        return request
    try:
        image = face.analyzed_snapshot
        quad = np.float32(face.quadrilateral)
        if (
            not np.isfinite(quad).all()
            or not cv2.isContourConvex(quad)
            or cv2.contourArea(quad, oriented=True) <= 0
            or np.any(quad < 0)
            or np.any(quad >= [image.width, image.height])
        ):
            return request
        width = max(2, int(np.linalg.norm(quad[1] - quad[0])))
        height = max(2, int(np.linalg.norm(quad[3] - quad[0])))
        scale = min(1, 768 / max(width, height))
        width, height = max(2, int(width * scale)), max(2, int(height * scale))
        matrix = cv2.getPerspectiveTransform(
            quad, np.float32([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]])
        )
        data = base64.b64decode(image.data_url.split(",", 1)[1], validate=True)
        if hashlib.sha256(data).hexdigest() != face.snapshot_id:
            return request
        with Image.open(BytesIO(data)) as source:
            if source.size != (image.width, image.height):
                return request
            crop = cv2.warpPerspective(np.asarray(source.convert("RGB")), matrix, (width, height))
        output = BytesIO()
        Image.fromarray(crop).save(output, "JPEG", quality=90)
        supplemental = InspectionImage(
            role="current_print_crop",
            image=ProcessedImage(output.getvalue(), width, height, width, height),
            block_id=expected.block_id,
            source_snapshot_id=hashlib.sha256(request.images[0].image.jpeg_bytes).hexdigest(),
            source_quad=(quad / [image.width, image.height]).tolist(),
        )
        return replace(request, images=(*request.images, supplemental))
    except (ValueError, OSError, cv2.error):
        return request
