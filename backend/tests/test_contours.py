"""Synthetic contour geometry only; no Meta network requests or real accuracy claims."""

import base64
from io import BytesIO

import cv2
import numpy as np
import pytest
from PIL import Image
from pydantic import ValidationError
from test_faces import artwork, photo, setup

from app.models.contours import ContourLayer
from app.models.geometry import GeometryFormContext
from app.models.segmentation import (
    IssueSegmentation,
    MaskPNG,
    SegmentationInstance,
    SegmentationResult,
)
from app.services.contour_service import (
    face_edges,
    reference_matches,
    sam_outline,
    simplified_paths,
)
from app.services.face_inspection import inspect_faces, match_face
from app.services.image_processor import process_image

HASH = "a" * 64


def mask_entry():
    rgba = np.zeros((60, 80, 4), np.uint8)
    rgba[5:55, 10:70, 3] = 90
    rgba[20:40, 30:50, 3] = 0  # Preserve an actual hole, not a filled bounding rectangle.
    output = BytesIO()
    Image.fromarray(rgba).save(output, "PNG")
    mask = MaskPNG(
        width=80,
        height=60,
        data_url="data:image/png;base64," + base64.b64encode(output.getvalue()).decode(),
    )
    result = SegmentationResult(
        snapshot_id=HASH,
        width=400,
        height=200,
        instances=[SegmentationInstance(instance_id="part", left=100, top=50, mask=mask)],
    )
    return IssueSegmentation(
        issue_index=0,
        status="matched",
        message="Synthetic mask",
        selected_instance_id="part",
        result=result,
    )


def test_sam_outline_preserves_crop_offset_holes_and_snapshot():
    outline = sam_outline(mask_entry(), HASH, 400, 200)
    assert outline.status == "available" and len(outline.paths) == 2
    points = np.array([point for path in outline.paths for point in path.points])
    assert tuple(points.min(axis=0)) == (110, 55)
    assert tuple(points.max(axis=0)) == (169, 104)
    assert outline.belongs_to(HASH, 400, 200)
    assert all(path.closed for path in outline.paths)


@pytest.mark.parametrize("failure", ["identity", "dimensions", "missing", "empty"])
def test_no_sam_evidence_never_generates_outline(failure):
    entry = mask_entry()
    digest, width = HASH, 400
    if failure == "identity":
        digest = "b" * 64
    elif failure == "dimensions":
        width = 401
    elif failure == "missing":
        entry = IssueSegmentation(issue_index=0, status="unavailable", message="SAM failed")
    else:
        output = BytesIO()
        Image.new("RGBA", (80, 60), (0, 0, 0, 0)).save(output, "PNG")
        entry.result.instances[0].mask.data_url = (
            "data:image/png;base64," + base64.b64encode(output.getvalue()).decode()
        )
    outline = sam_outline(entry, digest, width, 200)
    assert outline.status == "unavailable" and not outline.paths


def test_canny_roi_excludes_background_texture_and_polygon_boundary():
    scene = np.random.default_rng(7).integers(0, 256, (180, 300), dtype=np.uint8)
    scene[40:141, 80:221] = 180
    quad = np.float32([[80, 40], [220, 40], [220, 140], [80, 140]])
    assert face_edges(scene, quad, HASH, 0.33).status == "unavailable"
    cv2.rectangle(scene, (110, 65), (180, 110), 20, 2)
    result = face_edges(scene, quad, HASH, 0.33)
    assert result.status == "available"
    for path in result.paths:
        assert all(82 <= x <= 218 and 42 <= y <= 138 for x, y in path.points)


@pytest.mark.parametrize(
    "quad",
    [
        [[-1, 10], [70, 10], [70, 70], [10, 70]],
        [[10, 10], [100, 10], [70, 70], [10, 70]],
        [[10, 10], [70, 70], [70, 10], [10, 70]],
        [[float("nan"), 10], [70, 10], [70, 70], [10, 70]],
    ],
)
def test_invalid_face_roi_is_rejected(quad):
    with pytest.raises(ValueError):
        face_edges(np.zeros((100, 100), np.uint8), quad, HASH, 0.33)


def test_contour_budget_and_schema_reject_invalid_or_unavailable_points():
    binary = np.zeros((700, 700), np.uint8)
    for x in range(5, 690, 20):
        for y in range(5, 690, 20):
            cv2.circle(binary, (x, y), 5, 255, 1)
    paths = simplified_paths(binary)
    assert len(paths) == 64 and sum(len(p.points) for p in paths) <= 4096
    data = dict(
        kind="canny_edges",
        snapshot_id=HASH,
        width=100,
        height=100,
        message="Test",
        status="available",
        paths=[{"points": [[5, 5], [20, 20]]}],
    )
    ContourLayer(**data)
    for change in [
        {"status": "unavailable"},
        {"paths": []},
        {"paths": [{"points": [[5, 5], [100, 20]]}]},
        {"paths": [{"points": [[5, 5], [float("inf"), 20]]}]},
        {"paths": data["paths"] * 65},
    ]:
        with pytest.raises(ValidationError):
            ContourLayer(**(data | change))


def test_reference_pairs_only_include_supported_inliers_inside_roi():
    quad = np.float32([[10, 10], [90, 10], [90, 90], [10, 90]])
    result = reference_matches(
        [[20, 20], [30, 30], [2, 2]], [[21, 20], [40, 40], [3, 3]], quad, HASH, 100, 100
    )
    assert len(result.paths) == 1 and result.paths[0].points == [(20.0, 20.0), (21.0, 20.0)]
    assert not result.paths[0].closed


def test_real_face_matching_emits_only_exact_snapshot_evidence(client, settings):
    block, faces, project, step, _ = setup(client)
    client.post(
        f"/api/blocks/{block['id']}/faces/{faces[0]['id']}/images",
        files={"image": ("reference.png", photo(artwork()), "image/png")},
    )
    scene = np.full((600, 700), 240, np.uint8)
    scene[150:390, 150:510] = artwork()
    image = process_image(photo(scene), settings)
    result = inspect_faces(
        client.app.state.engine, settings, project["id"], step["id"], image, GeometryFormContext()
    )
    assert result.status == "uncertain"  # Visual matches do not prove board direction.
    assert {layer.kind for layer in result.contours} == {"canny_edges", "reference_match"}
    assert all(
        layer.status == "available"
        and layer.belongs_to(result.snapshot_id, image.width, image.height)
        for layer in result.contours
    )
    from app.models.faces import FaceResult

    FaceResult.model_validate(result.model_dump())
    result.contours[0].snapshot_id = "b" * 64
    with pytest.raises(ValidationError):
        FaceResult.model_validate(result.model_dump())
    assert match_face(artwork(), artwork(99)) is None
