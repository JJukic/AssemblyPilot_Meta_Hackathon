"""Opt-in, billable SAM smoke test with a developer-supplied photograph. Never CI."""

import argparse
import asyncio
import base64
import json
import sys
from io import BytesIO
from pathlib import Path
from time import perf_counter

from PIL import Image, ImageDraw

from app.core.config import Settings
from app.services.image_processor import ImageValidationError, process_image
from app.services.inspection_errors import InspectionError
from app.services.inspection_request import inspection_image_settings
from app.services.sam_client import SamClient, validate_concept


async def run(args) -> int:
    settings = Settings()
    if not settings.model_api_key or not settings.model_api_key.get_secret_value().strip():
        print("SKIPPED: MODEL_API_KEY is not configured in this backend environment.")
        return 77
    if not settings.sam_enabled:
        print("SKIPPED: SAM_ENABLED=false.")
        return 77
    try:
        concept = validate_concept(getattr(args, "concept", "green building block"))
    except InspectionError as exc:
        print(f"FAILED: {exc}")
        return 1
    output = args.output.expanduser().resolve()
    if output.exists() or output == args.image.expanduser().resolve():
        print("FAILED: Choose a new output path; existing files are never overwritten.")
        return 1
    started = perf_counter()
    try:
        with args.image.open("rb") as source:
            image = process_image(
                source.read(settings.max_upload_bytes + 1), inspection_image_settings(settings)
            )
        result = await SamClient(settings).segment(image, concept)
        latency_ms = (perf_counter() - started) * 1000
        annotated = Image.open(BytesIO(image.jpeg_bytes)).convert("RGBA")
        draw = ImageDraw.Draw(annotated)
        # Smoke output labels ALL instances for review, not as an assembly diagnosis.
        for instance in result.instances:
            mask = Image.open(BytesIO(base64.b64decode(instance.mask.data_url.split(",")[1])))
            annotated.alpha_composite(mask, (instance.left, instance.top))
            draw.text((instance.left, instance.top), f"SAM {instance.instance_id}", fill="white")
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("xb") as destination:
            annotated.save(destination, format="PNG")
        print(
            json.dumps(
                {
                    "status": "completed",
                    "model": result.model,
                    "concept": concept,
                    "instances": len(result.instances),
                    "latency_ms": round(latency_ms, 1),
                    "snapshot_id": result.snapshot_id,
                    "output": str(output),
                },
                indent=2,
            )
        )
        return 0
    except (InspectionError, ImageValidationError) as exc:
        print(f"FAILED: {exc} ({(perf_counter() - started) * 1000:.0f} ms)")
        return 1
    except OSError:
        print("FAILED: Could not read the input photograph or write the local output.")
        return 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("data/sam-smoke/annotated.png"))
    parser.add_argument("--concept", type=str, default="green building block")
    return asyncio.run(run(parser.parse_args()))


if __name__ == "__main__":
    sys.exit(main())
