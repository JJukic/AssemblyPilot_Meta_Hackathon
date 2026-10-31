"""Bounded worker for the official parser, whose codec has no resource quotas.

Only this subprocess receives model event data. No key is passed to it. The parent
kills it on cancellation/deadline; raw provider output never reaches the browser.
"""

import asyncio
import base64
import json
import sys
from io import BytesIO


class _WorkerError(ValueError):
    """Safe worker failure: stage/reason/counts only, never provider output."""

    def __init__(self, stage: str, reason: str, safe: dict | None = None):
        super().__init__(reason)
        self.stage = stage
        self.reason = reason
        self.safe = safe or {}


def _emit_diagnostic(payload: dict) -> None:
    try:
        sys.stderr.write(json.dumps(payload, separators=(",", ":"))[:2048] + "\n")
    except OSError:
        pass


def limit_resources() -> dict:
    """Best-effort POSIX limits. Unsupported limits are reported, never fatal.

    macOS rejects RLIMIT_AS; CPU and all byte/count caps still apply.
    Returns only fixed status strings, safe for logs.
    """
    status = {"rlimit_as": "unavailable", "rlimit_cpu": "unavailable"}
    try:
        import resource
    except ImportError:
        return status
    try:
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
        status["rlimit_as"] = "applied"
    except (ValueError, OSError, AttributeError):
        status["rlimit_as"] = "unsupported" if hasattr(resource, "RLIMIT_AS") else "unavailable"
    try:
        # RLIMIT_CPU is an absolute CPU-time deadline for this process, not a
        # duration. The worker main() calls this at startup (usage ~0), but a
        # budget anchored in the past would kill a longer-lived caller, so
        # always grant a fresh 30 CPU-seconds from current usage.
        usage = resource.getrusage(resource.RUSAGE_SELF)
        consumed = int(usage.ru_utime + usage.ru_stime)
        budget = consumed + 30
        resource.setrlimit(resource.RLIMIT_CPU, (budget, budget))
        status["rlimit_cpu"] = "applied"
    except (ValueError, OSError, AttributeError):
        status["rlimit_cpu"] = "unsupported" if hasattr(resource, "RLIMIT_CPU") else "unavailable"
    return status


def _safe_counts(payload) -> dict:
    counts: dict = {}
    try:
        events = payload.get("events") if isinstance(payload, dict) else None
        counts["events"] = len(events) if isinstance(events, list) else -1
    except Exception:
        counts["events"] = -1
    for key in ("width", "height"):
        try:
            value = payload.get(key) if isinstance(payload, dict) else None
            counts[key] = value if isinstance(value, int) else -1
        except Exception:
            counts[key] = -1
    return counts


async def decode(payload):
    from meta_sam_parser import (
        decode_mask_to_raster,
        image_segmentation_format,
        parse_responses_stream,
    )
    from PIL import Image, ImageChops, ImageFilter, ImageOps

    from app.models.segmentation import MaskPNG, SegmentationInstance, SegmentationResult

    try:
        width, height = payload["width"], payload["height"]
        event_list = payload["events"]
        if not isinstance(event_list, list):
            raise _WorkerError("worker_termination", "invalid_payload")
    except (KeyError, TypeError):
        raise _WorkerError("worker_termination", "invalid_payload") from None

    async def events():
        for event in event_list:
            yield event

    try:
        parsed = await parse_responses_stream(events(), image_segmentation_format()).final_result()
    except _WorkerError:
        raise
    except Exception:
        raise _WorkerError(
            "parser_completion", "parser_failed", {"events": len(event_list)}
        ) from None
    if parsed.outcome.status != "completed" or any(
        item.severity == "error" for item in parsed.diagnostics
    ):
        raise _WorkerError(
            "parser_completion",
            "incomplete_segmentation",
            {"events": len(event_list)},
        )
    instances = []
    for record in parsed.records:
        if record.kind == "text":
            raise _WorkerError("parser_completion", "unexpected_prose")
        if record.kind != "mask":
            continue
        mask, bounds = record.mask, record.bounds
        if record.frame is not None or record.revision != 1:
            raise _WorkerError("parser_completion", "unexpected_frame")
        if not (
            0 <= bounds.left < bounds.right <= width
            and 0 <= bounds.top < bounds.bottom <= height
            and mask.width == bounds.right - bounds.left
            and mask.height == bounds.bottom - bounds.top
        ):
            raise _WorkerError(
                "geometry_validation",
                "incompatible_geometry",
                {
                    "width": width if isinstance(width, int) else -1,
                    "height": height if isinstance(height, int) else -1,
                },
            )
        try:
            raster = decode_mask_to_raster(mask)
        except Exception:
            raise _WorkerError("mask_decoding", "mask_decode_failed") from None
        if not any(raster):
            raise _WorkerError("mask_decoding", "empty_mask")
        try:
            binary = Image.frombytes(
                "L", (mask.width, mask.height), bytes(v * 255 for v in raster)
            )
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
        except _WorkerError:
            raise
        except Exception:
            raise _WorkerError("mask_decoding", "mask_encode_failed") from None
        if len(instances) > 32:
            raise _WorkerError(
                "geometry_validation", "too_many_instances", {"instances": len(instances)}
            )
    try:
        return SegmentationResult(
            snapshot_id=payload["snapshot_id"],
            width=width,
            height=height,
            instances=instances,
        )
    except Exception:
        raise _WorkerError(
            "geometry_validation", "result_validation_failed", {"instances": len(instances)}
        ) from None


def main():
    limits = limit_resources()
    payload: dict = {}
    try:
        raw = sys.stdin.buffer.read(4 * 1024 * 1024 + 1)
        if len(raw) > 4 * 1024 * 1024:
            _emit_diagnostic(
                {
                    "stage": "resource_limits",
                    "reason": "oversized_input",
                    "stdin_bytes": len(raw),
                    "limits": limits,
                }
            )
            sys.exit(1)
        try:
            payload = json.loads(raw)
        except Exception:
            _emit_diagnostic(
                {
                    "stage": "worker_termination",
                    "reason": "invalid_payload",
                    "stdin_bytes": len(raw),
                    "limits": limits,
                }
            )
            sys.exit(1)
        result = asyncio.run(decode(payload))
        sys.stdout.write(result.model_dump_json())
        _emit_diagnostic(
            {
                "stage": "resource_limits",
                "reason": "decode_completed",
                **_safe_counts(payload),
                "instances": len(result.instances),
                "limits": limits,
            }
        )
    except _WorkerError as exc:
        _emit_diagnostic(
            {"stage": exc.stage, "reason": exc.reason, **_safe_counts(payload),
             **exc.safe, "limits": limits}
        )
        # Intentionally no exception text: it may include private model output.
        sys.exit(1)
    except Exception:
        _emit_diagnostic(
            {
                "stage": "worker_termination",
                "reason": "decode_failed",
                **_safe_counts(payload),
                "limits": limits,
            }
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
