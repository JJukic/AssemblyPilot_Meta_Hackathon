"""Meta Model API transport. Official protocol sources: docs/inspection-api.md."""

import asyncio
import base64
import json
import math
import random
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit

import httpx
from pydantic import ValidationError

from app.core.config import Settings
from app.models.diagnosis import InspectionResult
from app.models.inspection import Diagnosis
from app.models.multimodal import MultimodalInspectionRequest
from app.prompts.inspection import INSPECTION_POLICY, inspection_task_data
from app.services.image_processor import ProcessedImage
from app.services.inspection_errors import InspectionError

MAX_RESPONSE_BYTES = 1024 * 1024


def retry_after_seconds(value: str | None) -> int | None:
    if not value:
        return None
    try:
        seconds = float(value)
        if not math.isfinite(seconds):
            return None
    except ValueError:
        try:
            seconds = (parsedate_to_datetime(value) - datetime.now(UTC)).total_seconds()
        except (ValueError, TypeError, OverflowError):
            return None
    return max(0, math.ceil(seconds))


def upstream_error(status: int, retry_after: int | None) -> InspectionError:
    if status in (401, 403):
        return InspectionError(
            "meta_authentication",
            "Meta rejected the API credentials or model access. Check backend configuration.",
        )
    if status == 402:
        return InspectionError("meta_billing", "Check billing in the Meta Model API dashboard.")
    if status == 429:
        wait = retry_after if retry_after is not None else 5
        return InspectionError(
            "meta_rate_limited", f"Meta rate limit reached. Retry after {wait} seconds.", 429, wait
        )
    if status in (408, 504):
        return InspectionError(
            "meta_timeout", "Meta inspection timed out. Try a simpler view.", 504
        )
    if status == 413:
        return InspectionError(
            "meta_payload_too_large", "Meta rejected the image payload size. Reduce references."
        )
    if status in (400, 404, 422):
        return InspectionError(
            "meta_request_rejected",
            "Meta rejected the request. Check the configured model and API compatibility.",
        )
    return InspectionError(
        "meta_unavailable",
        "Meta inspection is unavailable. Please try again later.",
        retry_after=retry_after,
    )


class MetaClient:
    """Async, stateless, Meta-only inference; injectable HTTP transport for offline tests."""

    def __init__(self, settings: Settings, *, transport: httpx.AsyncBaseTransport | None = None):
        self.settings = settings
        self.transport = transport

    def endpoint(self) -> str:
        try:
            url = urlsplit(self.settings.meta_api_base_url)
            valid = (
                url.scheme == "https"
                and url.hostname == "api.meta.ai"
                and url.port in (None, 443)
                and url.path.rstrip("/") == "/v1"
                and not (url.username or url.password or url.query or url.fragment)
            )
        except ValueError:
            valid = False
        if not valid:
            raise InspectionError(
                "meta_configuration", "META_API_BASE_URL must use https://api.meta.ai/v1.", 503
            )
        return self.settings.meta_api_base_url.rstrip("/") + "/chat/completions"

    def request_body(self, request: MultimodalInspectionRequest) -> bytes:
        content = [{"type": "text", "text": inspection_task_data(request)}]
        for index, item in enumerate(request.images):
            content.append({"type": "text", "text": f"Image {index}: {item.role}"})
            encoded = base64.b64encode(item.image.jpeg_bytes).decode("ascii")
            content.append(
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{encoded}"}}
            )
        payload = {
            "model": self.settings.meta_vision_model,
            "messages": [
                {"role": "developer", "content": INSPECTION_POLICY},
                {"role": "user", "content": content},
            ],
            "max_completion_tokens": 8192,
            "reasoning_effort": "medium",
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "assembly_inspection",
                    "strict": True,
                    "schema": InspectionResult.model_json_schema(),
                },
            },
        }
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        if len(body) > self.settings.meta_max_request_bytes:
            raise InspectionError(
                "inspection_payload_too_large",
                "Inspection payload is too large. Reduce reference images.",
                413,
            )
        return body

    async def inspect(self, request: MultimodalInspectionRequest) -> InspectionResult:
        endpoint = self.endpoint()
        key = self.settings.model_api_key
        if key is None or not key.get_secret_value().strip():
            raise InspectionError(
                "meta_not_configured",
                "Set MODEL_API_KEY in the backend environment to enable inspection.",
                503,
            )
        body = self.request_body(request)
        # Deadline bounds the entire network operation, including all attempts and backoff.
        try:
            async with asyncio.timeout(self.settings.meta_request_timeout):
                async with httpx.AsyncClient(
                    transport=self.transport,
                    timeout=self.settings.meta_request_timeout,
                    follow_redirects=False,
                ) as client:
                    for attempt in range(3):
                        try:
                            async with client.stream(
                                "POST",
                                endpoint,
                                content=body,
                                headers={
                                    "Authorization": f"Bearer {key.get_secret_value()}",
                                    "Content-Type": "application/json",
                                },
                            ) as response:
                                status = response.status_code
                                retry_after = retry_after_seconds(
                                    response.headers.get("retry-after")
                                )
                                if status == 200:
                                    data = bytearray()
                                    async for chunk in response.aiter_bytes():
                                        data.extend(chunk)
                                        if len(data) > MAX_RESPONSE_BYTES:
                                            raise InspectionError(
                                                "meta_invalid_response",
                                                "Meta returned an oversized response.",
                                            )
                                    result = self.parse_response(bytes(data), request)
                                    result._meta_attempt_count = attempt + 1
                                    return result
                                error = upstream_error(status, retry_after)
                                retryable = status in (429, 500, 502, 503)
                        except httpx.TimeoutException:
                            error = InspectionError(
                                "meta_timeout", "Meta inspection timed out. Please retry.", 504
                            )
                            retry_after, retryable = None, True
                        except httpx.TransportError:
                            error = InspectionError(
                                "meta_unavailable",
                                "Cannot reach Meta. Check backend network access.",
                            )
                            retry_after, retryable = None, True
                        # Long Retry-After values go back to the caller; never retry earlier.
                        if (
                            not retryable
                            or attempt == 2
                            or (retry_after is not None and retry_after > 2)
                        ):
                            raise error
                        await asyncio.sleep(
                            max(retry_after or 0, 0.5 * 2**attempt + random.uniform(0, 0.2))
                        )
        except TimeoutError:
            raise InspectionError(
                "meta_timeout", "Meta inspection exceeded its time limit. Please retry.", 504
            ) from None
        raise AssertionError("Retry loop must return or raise")

    @staticmethod
    def parse_response(data: bytes, request: MultimodalInspectionRequest) -> InspectionResult:
        try:
            envelope = json.loads(data)
            choices = envelope["choices"]
            if len(choices) != 1 or choices[0]["finish_reason"] != "stop":
                raise ValueError("Incomplete completion")
            message = choices[0]["message"]
            if message.get("refusal") or message.get("tool_calls"):
                raise ValueError("No diagnostic answer")
            result = InspectionResult.model_validate_json(message["content"])
            if result.observed_face_id is not None and result.observed_face_id not in {
                face.id for face in request.context.faces
            }:
                raise ValueError("Unknown registered face ID")
            from app.services.print_recognition import validate_print_observation

            validate_print_observation(result, request)
            if result.step_id != request.context.step_id:
                raise ValueError("Mismatched step")
            allowed = {block.id for block in request.context.expected_blocks}
            if any(
                item.block_id is not None and item.block_id not in allowed
                for item in [*result.visible_blocks, *result.issues]
            ):
                raise ValueError("Unknown block")
            return result
        except (ValueError, TypeError, KeyError, IndexError, AttributeError, ValidationError):
            # Never echo provider bodies, validation inputs, credentials or image bytes.
            raise InspectionError(
                "meta_invalid_response",
                "Meta did not return a valid diagnosis. Capture a clearer view and retry.",
            ) from None

    async def diagnose(self, image: ProcessedImage, instruction: str) -> Diagnosis:
        # Retain the unused Phase 1 orchestration boundary for future correction/verification work.
        raise NotImplementedError(
            "Context-free diagnosis is not implemented. "
            "Use inspect with a registered project and step."
        )
