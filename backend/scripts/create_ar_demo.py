"""Create the simple HoloLens AR demo project through the public API (additive only).

Two steps on a baseplate: a red 2x4 brick on a green target, then a second red
2x4 next to it. Nothing existing is read-modified or deleted; every run creates
a NEW project. No Meta request is made.

Usage (backend running):
    uv run python scripts/create_ar_demo.py [--api http://127.0.0.1:8000]
"""

import argparse
import json
import urllib.request

# LEGO 2x4 brick: 31.8 x 9.6 x 15.8 mm, studs 4x2 at 8 mm pitch (measured).
BRICK = {"x_mm": 31.8, "y_mm": 9.6, "z_mm": 15.8}
STUDS = {"x": 4, "z": 2, "pitch_mm": 8.0, "diameter_mm": 4.8, "height_mm": 1.7}
BASEPLATE_TOP_M = 0.0032  # brick bottom sits on a standard baseplate


def call(api: str, method: str, path: str, body: dict | None = None) -> dict:
    request = urllib.request.Request(
        f"{api}{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.loads(response.read() or b"{}")


def placement(block_id: str, x_m: float) -> dict:
    return {
        "target_block_id": block_id,
        "instance": 1,
        "origin": "tabletop_session",
        "method": "manual_authoring",
        "evidence": "measured",
        "confirmed": True,
        "dimensions": BRICK,
        "studs": STUDS,
        "position_m": [x_m, BASEPLATE_TOP_M, 0.0],
        "rotation_deg": [0, 0, 0],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    api = parser.parse_args().api.rstrip("/")
    brick = call(api, "POST", "/api/blocks", {"name": "2x4 brick", "color": "red"})
    project = call(api, "POST", "/api/projects", {"name": "AR demo: red 2×4 brick"})
    steps = [
        ("Place the red 2×4 brick", "Place the red 2×4 brick on the green marker.", 0.0),
        (
            "Place the second 2×4 brick",
            "Place the second red 2×4 brick on the green marker.",
            0.04,
        ),
    ]
    for title, instruction, x_m in steps:
        step = call(api, "POST", f"/api/projects/{project['id']}/steps", {
            "title": title,
            "instruction": instruction,
            "required_blocks": [{"block_id": brick["id"], "required_quantity": 1}],
        })
        call(api, "PUT", f"/api/projects/{project['id']}/steps/{step['id']}/ar-placement",
             placement(brick["id"], x_m))
    print(json.dumps({"project_id": project["id"], "ar_url": f"/ar?project={project['id']}"}))


if __name__ == "__main__":
    main()
