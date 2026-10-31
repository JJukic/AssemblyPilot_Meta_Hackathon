"""Compare Meta-observed print with registered semantics; never infer camera-facing = front."""

import hashlib
import unicodedata

import cv2
import numpy as np

from app.models.prints import PrintRecognitionResult
from app.services.face_inspection import sam_consistent


def normalize_print(text):
    # Deliberately no fuzzy spelling/substring matching or confusable-character substitution.
    return " ".join(unicodedata.normalize("NFKC", text or "").casefold().split())


def configured_side(context):
    rule = context.face_constraint
    return next(
        (
            face
            for face in context.faces
            if rule and face.id == rule.required_face_id and face.print_rule
        ),
        None,
    )


def validate_print_observation(result, request):
    expected = configured_side(request.context)
    observed = result.print_observation
    if not expected or expected.print_rule.recognition_mode == "contour":
        if observed is not None:
            raise ValueError("No Meta print observation was requested")
        return
    if observed is None:
        raise ValueError("Required print observation is missing")
    if observed.target_block_id not in {None, expected.block_id}:
        raise ValueError("Print observation belongs to another target")
    if observed.observed_registered_side_id is not None:
        side = next(
            (
                face
                for face in request.context.faces
                if face.id == observed.observed_registered_side_id
            ),
            None,
        )
        if (
            side is None
            or side.block_id != expected.block_id
            or observed.evidence_quality != "clear"
        ):
            raise ValueError("Unknown or unsupported registered printed side")
        if (
            side.print_rule
            and side.print_rule.expected_text
            and (
                normalize_print(side.print_rule.expected_text)
                != normalize_print(observed.observed_text)
            )
        ):
            raise ValueError("Registered printed-side ID contradicts observed text")
        attached = {item.reference_id for item in request.images if item.reference_id}
        if not (side.print_rule and side.print_rule.expected_text) and not any(
            photo.id in attached for photo in side.references
        ):
            raise ValueError("Registered side has no text or attached reference evidence")
        if result.observed_face_id and result.observed_face_id != side.id:
            raise ValueError("Conflicting registered side identities")


def supported_surface(box, face):
    """An observed text box must lie inside the independently posed planar face."""
    if (
        not box
        or not face.directional_evidence
        or not face.analyzed_snapshot
        or not face.quadrilateral
    ):
        return False
    width, height = face.analyzed_snapshot.width, face.analyzed_snapshot.height
    polygon = np.float32(face.quadrilateral)
    return all(
        cv2.pointPolygonTest(polygon, (x * width, y * height), False) >= 0
        for x, y in [
            (box.x, box.y),
            (box.x + box.width, box.y),
            (box.x + box.width, box.y + box.height),
            (box.x, box.y + box.height),
        ]
    )


def sam_agrees(box, expected, segmentations, diagnosis, image):
    if not box:
        return True
    # Reuse existing selected object masks; never treat their outlines as planar print faces.
    from types import SimpleNamespace

    quad = [
        [box.x * image.width, box.y * image.height],
        [(box.x + box.width) * image.width, box.y * image.height],
        [(box.x + box.width) * image.width, (box.y + box.height) * image.height],
        [box.x * image.width, (box.y + box.height) * image.height],
    ]
    return sam_consistent(
        SimpleNamespace(
            target_block_id=expected.block_id, quadrilateral=quad, analyzed_snapshot=image
        ),
        segmentations,
        diagnosis,
        image,
    )


def recognize_print(request, diagnosis, face, segmentations):
    image = request.images[0].image
    digest = hashlib.sha256(image.jpeg_bytes).hexdigest()
    result = PrintRecognitionResult(
        recognition_status="not_applicable",
        recognition_method="none",
        evidence_quality="not_measured",
        description="This step has no automatic print rule.",
        suggested_action="No print check required.",
        snapshot_id=digest,
        gate_status="not_applicable",
    )
    expected = configured_side(request.context)
    if not expected:
        return result
    config = expected.print_rule
    direction_required = request.context.face_constraint.facing_direction != "not_required"
    attached = {item.reference_id for item in request.images if item.reference_id}
    reference_ids = [
        photo.id
        for side in request.context.faces
        for photo in side.references
        if photo.id in attached
    ]
    result.target_block_id = expected.block_id
    result.expected_print = config.expected_text or config.logo_description or expected.name
    result.direction_required = direction_required
    result.reference_image_id = next(
        (photo.id for photo in expected.references if photo.id in attached), None
    )
    result.recognition_status, result.gate_status = "uncertain", "uncertain"
    result.recognition_method = {"contour": "contour_matching", "hybrid": "hybrid"}.get(
        config.recognition_mode, "meta_reference" if reference_ids else "meta_zero_shot"
    )
    result.description = "Printed content has insufficient supported evidence."
    result.suggested_action = (
        "Capture an unobstructed close side view of the target print in diffuse light."
    )
    selected_id = None
    if config.recognition_mode == "contour":
        if (
            face.method != "orb_ransac_canny"
            or not face.matched_reference_image_id
            or not sam_consistent(face, segmentations, diagnosis, image)
        ):
            return result
        selected_id = face.observed_face_id
        result.reference_image_id = face.matched_reference_image_id
        result.recognition_status = "match" if selected_id == expected.id else "mismatch"
        result.evidence_quality = "clear"
        result.description = (
            "Deterministic reference matching identified a registered side; text was not read."
        )
        result.direction_supported = face.directional_evidence
    else:
        observed = diagnosis.print_observation
        if (
            observed is None
        ):  # Defensive fallback; provider adapter rejects missing required output.
            return result
        result.observed_print, result.observed_logo = observed.observed_text, observed.observed_logo
        result.evidence_quality = observed.evidence_quality
        result.description, result.suggested_action = (
            observed.description,
            observed.suggested_action,
        )
        result.bounding_box = observed.bounding_box
        selected_id = observed.observed_registered_side_id
        counts = [
            item.estimated_count
            for item in diagnosis.visible_blocks
            if item.block_id == expected.block_id
        ]
        if (
            not observed.target_identified
            or observed.target_block_id != expected.block_id
            or counts != [1]
        ):
            result.evidence_quality = "ambiguous"
            result.description += " Target instance is not uniquely established."
        if not sam_agrees(observed.bounding_box, expected, segmentations, diagnosis, image):
            result.evidence_quality = "ambiguous"
            result.description += " Print location disagrees with the selected SAM object."
        if result.evidence_quality != "clear":
            return result
        if config.recognition_mode == "meta_references" and result.reference_image_id is None:
            result.description += " The required side has no reference in this request."
            result.suggested_action = (
                "Add a reusable reference photograph or choose Meta Auto for legible text."
            )
            return result
        if config.expected_text:
            if not observed.observed_text or not observed.observed_text.strip():
                return result
            text = normalize_print(observed.observed_text)
            result.recognition_status = (
                "match" if text == normalize_print(config.expected_text) else "mismatch"
            )
            result.known_alternative = text in {
                normalize_print(value) for value in config.alternative_texts
            }
            matching_ids = [
                side.id
                for side in request.context.faces
                if side.print_rule and normalize_print(side.print_rule.expected_text) == text
            ]
            if selected_id is None and len(matching_ids) == 1:
                selected_id = matching_ids[0]
        elif (
            observed.observed_logo
            and result.reference_image_id
            and observed.logo_comparison in {"match", "mismatch"}
        ):
            result.recognition_status = observed.logo_comparison
        else:
            return result
        result.direction_supported = supported_surface(observed.bounding_box, face)
        if (
            config.recognition_mode == "hybrid"
            and face.method == "orb_ransac_canny"
            and sam_consistent(face, segmentations, diagnosis, image)
            and (
                (selected_id and selected_id != face.observed_face_id)
                or (result.recognition_status == "match") != (face.observed_face_id == expected.id)
            )
        ):
            result.recognition_status, result.evidence_quality = "uncertain", "ambiguous"
            result.description += " Meta and deterministic reference identity disagree."
    selected = next((side for side in request.context.faces if side.id == selected_id), None)
    if selected:
        result.observed_registered_side_id = selected.id
        result.observed_registered_side_name = selected.name
    if result.recognition_status in {"match", "mismatch"}:
        if direction_required and not result.direction_supported:
            result.suggested_action = (
                "Print identity is separate from direction. "
                "Capture the printed side and calibrated board together."
            )
        else:
            result.gate_status = "pass" if result.recognition_status == "match" else "fail"
            if result.gate_status == "fail":
                result.suggested_action = (
                    f"Present the registered print “{result.expected_print}” "
                    "on the required surface, then capture a fresh image."
                )
    return PrintRecognitionResult.model_validate(result.model_dump())
