"""Planar artwork matching; observed identity alone never proves physical direction."""

import base64
import hashlib
from io import BytesIO

import cv2
import numpy as np
from PIL import Image
from sqlmodel import Session, select

from app.db.tables import BlockFace, FaceReference, StepFaceConstraint
from app.models.faces import FaceResult
from app.services.calibration_store import CalibrationStore
from app.services.charuco_vision import detect, estimate_pose
from app.services.contour_service import face_edges, layer, reference_matches
from app.services.inspection_errors import InspectionError
from app.services.inspection_request import load_reference_image


def sam_consistent(face, segmentations, diagnosis, semantic_image):
    """Reuse an available object mask only to reject conflicting face association."""
    for entry in segmentations:
        if entry.status != "matched" or not entry.result:
            continue
        if diagnosis.issues[entry.issue_index].block_id != face.target_block_id:
            continue
        instance = next(
            item
            for item in entry.result.instances
            if item.instance_id == entry.selected_instance_id
        )
        center = np.mean(face.quadrilateral, axis=0)
        x = int(center[0] * semantic_image.width / face.analyzed_snapshot.width) - instance.left
        y = int(center[1] * semantic_image.height / face.analyzed_snapshot.height) - instance.top
        if not (0 <= x < instance.mask.width and 0 <= y < instance.mask.height):
            return False
        encoded = instance.mask.data_url.split(",", 1)[1]
        with Image.open(BytesIO(base64.b64decode(encoded, validate=True))) as mask:
            if mask.getpixel((x, y))[3] == 0:
                return False
    return True


def gray(image):
    with Image.open(BytesIO(image.jpeg_bytes)) as source:
        return np.asarray(source.convert("L"))


def match_face(reference, scene, canny_sigma=0.33):
    """References must be cropped to one complete planar face, upright, unmirrored."""
    if min(reference.shape) < 48 or float(reference.std()) < 15:
        return None
    if cv2.Laplacian(scene, cv2.CV_64F).var() < 30:
        return None
    orb = cv2.ORB_create(nfeatures=1800)
    a, da = orb.detectAndCompute(reference, None)
    b, db = orb.detectAndCompute(scene, None)
    if da is None or db is None or len(a) < 20:
        return None
    pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(da, db, k=2)
    good = [
        pair[0] for pair in pairs if len(pair) == 2 and pair[0].distance < 0.65 * pair[1].distance
    ]
    reverse = {m.queryIdx: m.trainIdx for m in cv2.BFMatcher(cv2.NORM_HAMMING).match(db, da)}
    good = [m for m in good if reverse.get(m.trainIdx) == m.queryIdx]
    if len(good) < 16:
        return None
    src = np.float32([a[m.queryIdx].pt for m in good])
    dst = np.float32([b[m.trainIdx].pt for m in good])
    h, mask = cv2.findHomography(src, dst, cv2.USAC_MAGSAC, 3.0)
    if h is None or mask is None or not np.isfinite(h).all():
        return None
    selected = mask.ravel().astype(bool)
    if selected.sum() < 14 or selected.mean() < 0.8:
        return None
    height, width = reference.shape
    coverage = cv2.contourArea(cv2.convexHull(src[selected])) / (width * height)
    if coverage < 0.25:
        return None
    corners = np.float32([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]])
    quad = cv2.perspectiveTransform(corners[None], h)[0]
    if not np.isfinite(quad).all() or not cv2.isContourConvex(quad):
        return None
    if np.any(quad < 0) or np.any(quad >= [scene.shape[1], scene.shape[0]]):
        return None
    if cv2.contourArea(quad, oriented=True) < 1500:
        return None
    crop = cv2.warpPerspective(scene, np.linalg.inv(h), (width, height))
    # Adaptive Canny provides structural support, never logo semantics.
    median = float(np.median(reference))
    low, high = max(10, (1 - canny_sigma) * median), max(30, (1 + canny_sigma) * median)
    edges = cv2.Canny(cv2.GaussianBlur(reference, (3, 3), 0), low, high)
    observed = cv2.Canny(cv2.GaussianBlur(crop, (3, 3), 0), low, high)
    if np.count_nonzero(edges) < 100:
        return None
    support = np.count_nonzero((edges > 0) & (cv2.dilate(observed, np.ones((3, 3))) > 0))
    support /= np.count_nonzero(edges)
    correlation = float(cv2.matchTemplate(crop, reference, cv2.TM_CCOEFF_NORMED)[0, 0])
    if support < 0.7 or correlation < 0.7:
        return None
    projected = cv2.perspectiveTransform(src[selected][None], h)[0]
    return min(float(selected.mean()), support, correlation), quad, projected, dst[selected]


def direction_supported(face, quad, profile, pose, desired):
    # Face pixel order maps to a local rectangle; outward normal points toward the camera.
    obj = np.float64(
        [
            [0, 0, 0],
            [face.width_mm, 0, 0],
            [face.width_mm, face.height_mm, 0],
            [0, face.height_mm, 0],
        ]
    )
    k, d = np.asarray(profile.camera_matrix), np.asarray(profile.distortion)
    solved = cv2.solvePnPGeneric(obj, quad.astype(np.float64), k, d, flags=cv2.SOLVEPNP_IPPE)
    candidates = []
    board_r = cv2.Rodrigues(np.asarray(pose.rvec))[0]
    for r, t in zip(solved[1], solved[2], strict=True):
        rotation = cv2.Rodrigues(r)[0]
        if np.any((obj @ rotation.T + t.reshape(1, 3))[:, 2] <= 0):
            continue
        projected = cv2.projectPoints(obj, r, t, k, d)[0].reshape(-1, 2)
        error = float(np.sqrt(np.mean((projected - quad) ** 2)))
        normal = rotation[:, 2]
        if not np.isfinite(error) or not np.isfinite(normal).all():
            continue
        if np.dot(normal, t.ravel()) > 0:
            normal = -normal
        candidates.append((error, board_r.T @ normal))
    candidates.sort(key=lambda item: item[0])
    if not candidates or candidates[0][0] > 1.5:
        return False
    good = [normal for error, normal in candidates if error <= candidates[0][0] + 0.3]
    return bool(good) and all(
        float(np.dot(normal, desired)) > np.cos(np.deg2rad(15)) for normal in good
    )


def inspect_faces(engine, settings, project_id, step_id, image, context):
    from app.services.project_service import require_step

    digest = hashlib.sha256(image.jpeg_bytes).hexdigest()
    result = FaceResult(
        status="not_measured",
        snapshot_id=digest,
        guidance="This step has no required face.",
        contours=[
            layer(
                kind,
                digest,
                image.width,
                image.height,
                message="Unavailable: no unambiguous, supported printed-face ROI.",
            )
            for kind in ["canny_edges", "reference_match"]
        ],
    )
    with Session(engine) as session:
        require_step(session, project_id, step_id)
        rule = session.get(StepFaceConstraint, step_id)
        if not rule:
            return result
        no_direction = rule.facing_direction == "not_required"
        result.expected_face_id = None if no_direction else rule.required_face_id
        result.target_block_id = rule.target_block_id
        expected_face = session.get(BlockFace, rule.required_face_id)
        result.expected_face_name = expected_face.name if expected_face else None
        result.status = "not_measured" if no_direction else "uncertain"
        result.guidance = (
            "Capture the complete printed side sharply, with the ChArUco board visible."
        )
        if no_direction:
            result.guidance = (
                "No physical direction required; print recognition is evaluated separately."
            )
        scene = gray(image)
        matches = []
        faces = session.exec(
            select(BlockFace).where(BlockFace.block_id == rule.target_block_id)
        ).all()
        for face in faces:
            for link in session.exec(
                select(FaceReference).where(FaceReference.face_id == face.id)
            ).all():
                try:
                    reference = load_reference_image(
                        session, settings, link.image_id, block_id=face.block_id
                    )
                    match = match_face(gray(reference), scene, settings.face_canny_sigma)
                except (InspectionError, cv2.error, ValueError):
                    continue
                if match:
                    matches.append((match[0], face, link.image_id, match[1], match[2], match[3]))
        matches.sort(key=lambda item: item[0], reverse=True)
        if not matches:
            return result
        best = matches[0]
        if any(item[1].id != best[1].id and best[0] - item[0] < 0.12 for item in matches[1:]):
            result.guidance = (
                "Several registered faces match. Capture a closer, unobstructed side view."
            )
            return result
        result.observed_face_id, result.matching_score = best[1].id, best[0]
        result.observed_face_name = best[1].name
        result.matched_reference_image_id = best[2]
        result.quadrilateral = best[3].tolist()
        from app.services.geometric_verification import _snapshot

        result.analyzed_snapshot = _snapshot(image)[1]
        result.method = "orb_ransac_canny"
        try:
            result.contours = [
                face_edges(scene, best[3], digest, settings.face_canny_sigma),
                reference_matches(best[4], best[5], best[3], digest, image.width, image.height),
            ]
        except (ValueError, cv2.error):
            # Optional visualization must not change or manufacture an inspection verdict.
            pass
        result.guidance = (
            "Face identified; direction unresolved. Confirm calibration and a board-axis direction."
        )
        if no_direction:
            result.guidance = (
                "Physical direction is not required; "
                "reference identity does not measure orientation."
            )
            return result
        if not context.profile_id or not context.camera or not context.configuration_confirmed:
            return result
        directions = {
            "board_positive_x": [1, 0, 0],
            "board_negative_x": [-1, 0, 0],
            "board_positive_y": [0, 1, 0],
            "board_negative_y": [0, -1, 0],
        }
        if rule.facing_direction not in directions:
            result.guidance = (
                "Operator front is unanchored. Select the physical board axis facing the operator."
            )
            return result
        try:
            profile = CalibrationStore(settings.calibration_path).load(context.profile_id)
            if profile.camera != context.camera or (image.width, image.height) != (
                profile.camera.width,
                profile.camera.height,
            ):
                return result
            pose = estimate_pose(detect(image, profile.board), profile)
            if not direction_supported(
                best[1], best[3], profile, pose, np.asarray(directions[rule.facing_direction])
            ):
                return result
        except (ValueError, OSError, cv2.error):
            return result
        result.calibration_profile_id = str(profile.id)
        result.directional_evidence = True
        result.status = "correct" if best[1].id == rule.required_face_id else "incorrect"
        result.guidance = (
            "Required printed face matches the configured board direction."
            if result.status == "correct"
            else "Turn the target so the required registered face points toward "
            + rule.facing_direction.replace("_", " ")
            + "; then capture a fresh view."
        )
        return result
