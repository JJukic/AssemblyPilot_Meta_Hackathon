"""Meta-hosted SAM Responses API; protocol sources and limits: docs/segmentation.md."""

import asyncio
import base64
import hashlib
import json
import logging
import math
import os
import re
import sys
from io import BytesIO

import httpx
from meta_sam_parser import FramePrompt, PromptBox, PromptObject, build_object_prompt
from PIL import Image

from app.core.config import BACKEND_ROOT, Settings
from app.models.diagnosis import BoundingBox
from app.models.segmentation import SegmentationResult
from app.services.image_processor import ProcessedImage
from app.services.inspection_errors import InspectionError
from app.services.meta_client import MetaClient, retry_after_seconds, upstream_error

MAX_STREAM_BYTES = 2 * 1024 * 1024

logger = logging.getLogger(__name__)


class SamProtocolError(ValueError):
    """Safe SAM failure: stage/reason/counts only, never provider output."""

    def __init__(self, stage: str, reason: str, safe: dict | None = None):
        super().__init__(reason)
        self.stage = stage
        self.reason = reason
        self.safe = safe or {}


def _parse_worker_diagnostic(stderr: bytes) -> dict:
    try:
        first = stderr.decode("utf-8", errors="strict").strip().splitlines()[0][:2048]
        value = json.loads(first)
        if not isinstance(value, dict):
            return {}
        stage, reason = value.get("stage"), value.get("reason")
        if not isinstance(stage, str) or not isinstance(reason, str):
            return {}
        if stage not in {
            "http_response_format",
            "sse_framing",
            "parser_completion",
            "worker_termination",
            "mask_decoding",
            "geometry_validation",
            "resource_limits",
        }:
            return {}
        safe: dict = {}
        for key in ("events", "instances", "width", "height", "stdin_bytes"):
            item = value.get(key)
            if isinstance(item, int) and -(10**9) <= item <= 10**9:
                safe[key] = item
        limits = value.get("limits")
        if isinstance(limits, dict):
            safe_limits = {
                key: limits[key]
                for key in ("rlimit_as", "rlimit_cpu")
                if limits.get(key) in {"applied", "unsupported", "unavailable"}
            }
            if safe_limits:
                safe["limits"] = safe_limits
        return {"stage": stage, "reason": reason, "safe": safe}
    except Exception:
        return {}


def snapshot_identity(image: ProcessedImage) -> str:
    return hashlib.sha256(image.jpeg_bytes).hexdigest()


def validate_concept(concept: str) -> str:
    # This is prompt validation, NOT parsing SAM's special-token grammar.
    if not re.fullmatch(r"[a-zA-Z]+(?:[ -][a-zA-Z]+){1,5}", concept) or len(concept) > 80:
        raise InspectionError("sam_invalid_prompt", "Use one short physical object description.")
    words = set(concept.lower().split())
    if words & {"and", "or", "incorrect", "wrong", "thing", "find", "segment", "please", "not"}:
        raise InspectionError("sam_invalid_prompt", "Use one concrete concept, not instructions.")
    return concept


async def decode_events(events: list[dict], image: ProcessedImage) -> SegmentationResult:
    # Isolate the official decoder's unbounded allocations and CPU work, off the API loop.
    worker = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "app.services.sam_decode",
        cwd=BACKEND_ROOT,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env={
            name: value
            for name, value in os.environ.items()
            if name in {"PATH", "SYSTEMROOT", "LANG"}
        },
    )
    payload = json.dumps(
        {
            "events": events,
            "width": image.width,
            "height": image.height,
            "snapshot_id": snapshot_identity(image),
        }
    ).encode()
    try:
        async with asyncio.timeout(35):
            output, stderr = await worker.communicate(payload)
        diagnostic = _parse_worker_diagnostic((stderr or b"")[:4096])
        if worker.returncode or len(output) > 3 * 1024 * 1024:
            if diagnostic:
                raise SamProtocolError(
                    diagnostic["stage"],
                    diagnostic["reason"],
                    {
                        **diagnostic["safe"],
                        "returncode": worker.returncode or 0,
                        "stdout_bytes": len(output),
                    },
                )
            raise SamProtocolError(
                "worker_termination",
                "parser_rejected",
                {
                    "events": len(events),
                    "returncode": worker.returncode or 0,
                    "stdout_bytes": len(output),
                },
            )
        try:
            result = SegmentationResult.model_validate_json(output)
        except Exception:
            raise SamProtocolError(
                "geometry_validation",
                "result_validation_failed",
                {"events": len(events), "stdout_bytes": len(output)},
            ) from None
        if diagnostic.get("stage") == "resource_limits":
            logger.debug(
                "SAM worker limits: %s events=%s instances=%s",
                diagnostic["safe"].get("limits", "-"),
                diagnostic["safe"].get("events", "-"),
                len(result.instances),
            )
        return result
    finally:
        if worker.returncode is None:
            worker.kill()
        await worker.wait()


class SamClient:
    def __init__(self, settings: Settings, *, transport: httpx.AsyncBaseTransport | None = None):
        self.settings, self.transport = settings, transport

    async def segment(
        self, image: ProcessedImage, concept: str | None = None, *, box: BoundingBox | None = None
    ) -> SegmentationResult:
        if not self.settings.sam_enabled:
            raise InspectionError("sam_disabled", "Segmentation is disabled.", 503)
        # Reuse the exact Meta-only origin guard; never follow redirects or send keys elsewhere.
        endpoint = MetaClient(self.settings).endpoint().removesuffix("/chat/completions")
        key = self.settings.model_api_key
        if key is None or not key.get_secret_value().strip():
            raise InspectionError("sam_not_configured", "SAM requires backend MODEL_API_KEY.", 503)
        try:
            if not (0 < image.width <= 1600 and 0 < image.height <= 1600):
                raise ValueError("Invalid dimensions")
            if len(image.jpeg_bytes) > self.settings.max_upload_bytes:
                raise ValueError("Oversized image")
            with Image.open(BytesIO(image.jpeg_bytes)) as decoded:
                if decoded.format != "JPEG" or decoded.size != (image.width, image.height):
                    raise ValueError("Image metadata mismatch")
                decoded.verify()
        except (ValueError, OSError):
            raise InspectionError(
                "sam_invalid_image", "SAM requires a validated JPEG snapshot."
            ) from None
        if (concept is None) == (box is None):
            raise InspectionError("sam_invalid_prompt", "Supply one concept or one spatial box.")
        try:
            if box is not None:
                box = BoundingBox.model_validate(box.model_dump())
                prompt = build_object_prompt(
                    size=(image.width, image.height),
                    objects=[
                        PromptObject(
                            id=1,
                            prompts=[
                                FramePrompt(
                                    frame=0,
                                    box=PromptBox(
                                        math.floor(box.x * image.width),
                                        math.floor(box.y * image.height),
                                        math.ceil(round((box.x + box.width) * image.width, 10)),
                                        math.ceil(round((box.y + box.height) * image.height, 10)),
                                    ),
                                )
                            ],
                        ),
                    ],
                )
            else:
                prompt = validate_concept(concept)
        except ValueError:
            raise InspectionError(
                "sam_invalid_prompt", "SAM spatial prompt could not be validated."
            ) from None
        body = json.dumps(
            {
                "model": self.settings.meta_sam_model,
                "stream": True,
                "input": [
                    {
                        "type": "message",
                        "role": "user",
                        "content": [
                            {"type": "input_text", "text": prompt},
                            {
                                "type": "input_image",
                                "image_url": "data:image/jpeg;base64,"
                                + base64.b64encode(image.jpeg_bytes).decode("ascii"),
                            },
                        ],
                    }
                ],
            }
        ).encode()
        if len(body) > self.settings.meta_max_request_bytes:
            raise InspectionError("sam_payload_too_large", "SAM snapshot payload exceeds limit.")
        try:
            async with asyncio.timeout(self.settings.sam_request_timeout):
                async with httpx.AsyncClient(
                    transport=self.transport,
                    follow_redirects=False,
                    timeout=self.settings.sam_request_timeout,
                ) as client:
                    for attempt in range(3):
                        retry_after = None
                        try:
                            async with client.stream(
                                "POST",
                                endpoint + "/responses",
                                content=body,
                                headers={
                                    "Authorization": f"Bearer {key.get_secret_value()}",
                                    "Content-Type": "application/json",
                                    "Accept": "text/event-stream",
                                },
                            ) as response:
                                if response.status_code == 200:
                                    if "text/event-stream" not in response.headers.get(
                                        "content-type", ""
                                    ):
                                        raise SamProtocolError(
                                            "http_response_format", "non_sse_response"
                                        )
                                    data = bytearray()
                                    async for chunk in response.aiter_bytes():
                                        data.extend(chunk)
                                        if len(data) > MAX_STREAM_BYTES:
                                            raise SamProtocolError(
                                                "http_response_format",
                                                "oversized_response",
                                                {"stream_bytes": len(data)},
                                            )
                                    events = parse_sse(bytes(data))
                                    return await decode_events(events, image)
                                retry_after = retry_after_seconds(
                                    response.headers.get("retry-after")
                                )
                                error = upstream_error(response.status_code, retry_after)
                                retryable = response.status_code in (429, 500, 502, 503)
                        except httpx.TimeoutException:
                            error = InspectionError("sam_timeout", "SAM request timed out.", 504)
                            retryable = True
                        except httpx.TransportError:
                            error = InspectionError("sam_unavailable", "Cannot reach Meta SAM.")
                            retryable = True
                        if not retryable or attempt == 2 or (retry_after or 0) > 2:
                            raise error
                        await asyncio.sleep(max(retry_after or 0, 0.5 * 2**attempt))
        except TimeoutError:
            raise InspectionError("sam_timeout", "SAM exceeded its time limit.", 504) from None
        except SamProtocolError as exc:
            fields = " ".join(f"{key}={exc.safe[key]}" for key in sorted(exc.safe)[:6])
            logger.warning(
                "Rejected SAM segmentation: stage=%s reason=%s %s",
                exc.stage,
                exc.reason,
                fields or "-",
            )
            raise InspectionError(
                "sam_invalid_response",
                "SAM returned unsupported or invalid segmentation. "
                f"[{exc.stage}:{exc.reason}]",
            ) from None
        except (ValueError, TypeError, KeyError, OSError):
            logger.warning(
                "Rejected SAM segmentation: stage=%s reason=%s",
                "worker_termination",
                "decode_failed",
            )
            raise InspectionError(
                "sam_invalid_response",
                "SAM returned unsupported or invalid segmentation. "
                "[worker_termination:decode_failed]",
            ) from None
        raise AssertionError("Retry loop must return or raise")


def parse_sse(data: bytes) -> list[dict]:
    """SSE framing only; official parser handles every SAM token and terminal event."""
    events, lines = [], []
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        raise SamProtocolError(
            "sse_framing", "invalid_encoding", {"stream_bytes": len(data)}
        ) from None
    for line in text.splitlines() + [""]:
        if line.startswith("data:"):
            lines.append(line[5:].removeprefix(" "))
        elif not line and lines:
            raw = "\n".join(lines)
            lines = []
            if raw == "[DONE]":
                continue
            try:
                event = json.loads(raw)
            except ValueError:
                raise SamProtocolError(
                    "sse_framing",
                    "invalid_event_json",
                    {"stream_bytes": len(data), "events": len(events)},
                ) from None
            if not isinstance(event, dict) or not isinstance(event.get("type"), str):
                raise SamProtocolError(
                    "sse_framing",
                    "unsupported_event",
                    {"stream_bytes": len(data), "events": len(events)},
                )
            events.append(event)
            if len(events) > 10000:
                raise SamProtocolError(
                    "sse_framing", "too_many_events", {"stream_bytes": len(data)}
                )
    return events
