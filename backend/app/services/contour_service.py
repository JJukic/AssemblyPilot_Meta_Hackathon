"""Deterministic, bounded visualization; no inference and no synthetic outlines."""

import base64
from io import BytesIO

import cv2
import numpy as np
from PIL import Image

from app.models.contours import ContourLayer, ContourPath


def layer(kind, snapshot_id, width, height, paths=(), message="No usable evidence available."):
    return ContourLayer(
        kind=kind,
        snapshot_id=snapshot_id,
        width=width,
        height=height,
        paths=list(paths),
        status="available" if paths else "unavailable",
        message=message,
    )


def simplified_paths(binary, offset=(0, 0), *, min_length=16):
    """Keep actual traces including holes; discard speckles, bound wire payload."""
    contours, _ = cv2.findContours(binary, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    paths, remaining = [], 4096
    for contour in sorted(contours, key=lambda c: cv2.arcLength(c, True), reverse=True):
        perimeter = cv2.arcLength(contour, True)
        if perimeter < min_length:
            continue
        epsilon = max(0.75, perimeter * 0.001)
        points = cv2.approxPolyDP(contour, epsilon, True).reshape(-1, 2)
        while len(points) > 128:
            epsilon *= 1.5
            points = cv2.approxPolyDP(contour, epsilon, True).reshape(-1, 2)
        if len(points) < 2 or len(points) > remaining:
            continue
        paths.append(ContourPath(points=(points + offset).tolist(), closed=len(points) >= 3))
        remaining -= len(points)
        if len(paths) == 64 or remaining < 2:
            break
    return paths


def sam_outline(entry, snapshot_id, width, height):
    def unavailable(message):
        return layer("sam_outline", snapshot_id, width, height, message=message)

    if entry.status != "matched" or not entry.result:
        return unavailable("SAM Outline unavailable: " + entry.message[:400])
    result = entry.result
    if (result.snapshot_id, result.width, result.height) != (snapshot_id, width, height):
        return unavailable("SAM Outline unavailable: snapshot identity mismatch.")
    instance = next(
        (item for item in result.instances if item.instance_id == entry.selected_instance_id), None
    )
    if instance is None:
        return unavailable("SAM Outline unavailable: no selected mask.")
    return instance_outline(instance, snapshot_id, width, height)


def instance_outline(instance, snapshot_id, width, height):
    """Extract only the actual returned mask; no association with a diagnosis is implied."""
    try:
        with Image.open(
            BytesIO(base64.b64decode(instance.mask.data_url.split(",", 1)[1], validate=True))
        ) as mask:
            alpha = np.asarray(mask.getchannel("A"))
        binary = np.uint8(alpha > 0) * 255
        paths = simplified_paths(binary, (instance.left, instance.top))
        return layer(
            "sam_outline",
            snapshot_id,
            width,
            height,
            paths,
            "Visible SAM mask boundaries; not a correctness judgment."
            if paths
            else "SAM Outline unavailable: no boundary survived filtering.",
        )
    except (ValueError, OSError, cv2.error):
        return layer(
            "sam_outline",
            snapshot_id,
            width,
            height,
            message="SAM Outline unavailable: mask could not be processed.",
        )


def face_edges(scene, quad, snapshot_id, sigma):
    height, width = scene.shape
    quad = np.asarray(quad, dtype=np.float32)
    if (
        quad.shape != (4, 2)
        or not np.isfinite(quad).all()
        or not cv2.isContourConvex(quad)
        or cv2.contourArea(quad) < 16
        or np.any(quad < 0)
        or np.any(quad >= [width, height])
    ):
        raise ValueError("Edges require a finite convex in-image face ROI")
    left, top = np.floor(quad.min(axis=0)).astype(int)
    right, bottom = np.ceil(quad.max(axis=0)).astype(int)
    crop = scene[top : bottom + 1, left : right + 1]
    roi = np.zeros(crop.shape, np.uint8)
    cv2.fillConvexPoly(roi, np.rint(quad - [left, top]).astype(np.int32), 255)
    # Analyze the actual crop before masking: no artificial polygon-boundary edges.
    # Erosion excludes exterior texture and the boundary's blur footprint.
    roi = cv2.erode(roi, np.ones((5, 5), np.uint8), borderType=cv2.BORDER_CONSTANT, borderValue=0)
    median = float(np.median(crop[roi > 0])) if np.any(roi) else 0
    edges = cv2.Canny(
        cv2.GaussianBlur(crop, (3, 3), 0),
        max(10, (1 - sigma) * median),
        max(30, (1 + sigma) * median),
    )
    paths = simplified_paths(cv2.bitwise_and(edges, roi), (left, top))
    return layer(
        "canny_edges",
        snapshot_id,
        width,
        height,
        paths,
        "Raw ROI edges; not verified reference matches."
        if paths
        else "Canny Edges unavailable: no usable edges in the supported face ROI.",
    )


def reference_matches(projected, observed, quad, snapshot_id, width, height):
    """Only homography inliers from an accepted match, in scene pixel coordinates."""
    paths = []
    for start, end in zip(projected, observed, strict=True):
        points = np.asarray([start, end], dtype=np.float32)
        if (
            not np.isfinite(points).all()
            or np.linalg.norm(points[0] - points[1]) > 3
            or np.any(points < 0)
            or np.any(points >= [width, height])
            or any(cv2.pointPolygonTest(quad, tuple(map(float, p)), False) < 0 for p in points)
        ):
            continue
        paths.append(ContourPath(points=points.tolist()))
        if len(paths) == 64:
            break
    return layer(
        "reference_match",
        snapshot_id,
        width,
        height,
        paths,
        "Verified feature pairs: projected reference to observed keypoint; not physical pose."
        if paths
        else "Reference Match unavailable: no supported feature pairs.",
    )
