"""Bounded worker for the official parser, whose codec has no resource quotas.

Only this subprocess receives model event data. No key is passed to it. The parent
kills it on cancellation/deadline; raw provider output never reaches the browser.
"""

import asyncio
import base64
import json
import sys
from io import BytesIO


def limit_resources():
    import resource

    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (30, 30))


async def decode(payload):
    from meta_sam_parser import (
        decode_mask_to_raster,
        image_segmentation_format,
        parse_responses_stream,
    )
    from PIL import Image, ImageChops, ImageFilter, ImageOps

    from app.models.segmentation import MaskPNG, SegmentationInstance, SegmentationResult

    async def events():
        for event in payload["events"]:
            yield event

    parsed = await parse_responses_stream(events(), image_segmentation_format()).final_result()
    if parsed.outcome.status != "completed" or any(
        item.severity == "error" for item in parsed.diagnostics
    ):
        raise ValueError("Incomplete or invalid segmentation")
    instances = []
    for record in parsed.records:
        if record.kind == "text":
            raise ValueError("Unexpected prose")
        if record.kind != "mask":
            continue
        mask, bounds = record.mask, record.bounds
        if record.frame is not None or record.revision != 1:
            raise ValueError("Unexpected frame or repeated instance")
        if not (
            0 <= bounds.left < bounds.right <= payload["width"]
            and 0 <= bounds.top < bounds.bottom <= payload["height"]
            and mask.width == bounds.right - bounds.left
            and mask.height == bounds.bottom - bounds.top
        ):
            raise ValueError("Incompatible mask geometry")
        raster = decode_mask_to_raster(mask)
        if not any(raster):
            raise ValueError("Empty instance mask")
        binary = Image.frombytes("L", (mask.width, mask.height), bytes(v * 255 for v in raster))
        # Padding makes the outside boundary visible even when the mask touches its crop.
        padded = ImageOps.expand(binary, border=1, fill=0)
        eroded = padded.filter(ImageFilter.MinFilter(3)).crop(
            (1, 1, mask.width + 1, mask.height + 1)
        )
        boundary = ImageChops.subtract(binary, eroded)
        alpha = binary.point(lambda v: 90 if v else 0)
        alpha.paste(230, mask=boundary)
        colored = Image.new("RGBA", binary.size, (239, 68, 68, 0))
        colored.putalpha(alpha)
        buffer = BytesIO()
        colored.save(buffer, format="PNG")
        instances.append(
            SegmentationInstance(
                instance_id=record.object_id,
                left=int(bounds.left),
                top=int(bounds.top),
                mask=MaskPNG(
                    width=mask.width,
                    height=mask.height,
                    data_url="data:image/png;base64,"
                    + base64.b64encode(buffer.getvalue()).decode("ascii"),
                ),
            )
        )
        if len(instances) > 32:
            raise ValueError("Too many instances")
    return SegmentationResult(
        snapshot_id=payload["snapshot_id"],
        width=payload["width"],
        height=payload["height"],
        instances=instances,
    )


def main():
    try:
        limit_resources()
        raw = sys.stdin.buffer.read(4 * 1024 * 1024 + 1)
        if len(raw) > 4 * 1024 * 1024:
            raise ValueError("Oversized input")
        result = asyncio.run(decode(json.loads(raw)))
        sys.stdout.write(result.model_dump_json())
    except Exception:
        # Intentionally no exception text: it may include private model output.
        sys.exit(1)


if __name__ == "__main__":
    main()
