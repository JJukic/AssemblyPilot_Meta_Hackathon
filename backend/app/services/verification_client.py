"""Reuse the existing Meta transport with a verification-specific schema and policy."""

import json

from app.models.multimodal import MultimodalInspectionRequest
from app.models.workflow import TrackedIssue, VerificationEvidence
from app.services.inspection_errors import InspectionError
from app.services.meta_client import MetaClient

VERIFICATION_POLICY = """
This is a NEW observation for human-in-the-loop verification, not proof of a repair.
Assess the ENTIRE current image independently against the registered specification and
trusted reference photographs. Previous findings are fallible attention hints only.
A previous diagnosis may itself have been wrong. Never assume a fix was performed or
reuse earlier coordinates. Detect new discrepancies, even if unrelated to the old issue.
For every supplied previous_issue_id return exactly one issue_assessment with a concrete
visual explanation. Use resolved only when NEW visible evidence supports the expected
state (not merely because the old issue was not mentioned). Use unresolved with the
index of the matching CURRENT issue when its block/category and evidence support the
association; do not match by wording alone or claim physical object tracking.
If an important area is hidden, ambiguous, uncalibrated or cannot be compared reliably,
use uncertain, request a specific Active Vision view, and mark affected findings uncertain.
Resolved findings must have current_issue_index=null. Do not reuse an issue index for
multiple prior findings. With uncertain identity, use uncertain and null, not a guess.
A correct assessment requires sufficient current evidence for the expected step and
explicitly resolved prior findings. Hidden connections and mechanical stability are not
certified. No invented measurements, angles, confidence, successful fixes or resolutions.
Return the entire diagnostic schema plus issue_assessments. No tools or further calls.
"""


class VerificationClient(MetaClient):
    """Same endpoint, key, timeout and bounded transport retries as the diagnosis role."""

    def __init__(self, meta: MetaClient, previous: list[TrackedIssue]):
        super().__init__(meta.settings, transport=meta.transport)
        self.previous = [item for item in previous if item.resolution != "resolved"]

    def request_body(self, request: MultimodalInspectionRequest) -> bytes:
        payload = json.loads(super().request_body(request))
        payload["messages"][0]["content"] += VERIFICATION_POLICY
        payload["messages"][1]["content"].insert(
            0,
            {
                "type": "text",
                "text": json.dumps(
                    {
                        "previous_findings": [
                            {
                                "previous_issue_id": item.issue_id,
                                "block_id": item.original.block_id,
                                "type": item.original.type,
                                "expected": item.original.expected,
                                "previous_observation": item.original.observed,
                                "previous_evidence": item.evidence,
                            }
                            for item in self.previous
                        ]
                    },
                    ensure_ascii=False,
                ),
            },
        )
        schema = VerificationEvidence.model_json_schema()
        schema["properties"]["print_observation"] = payload["response_format"]["json_schema"][
            "schema"
        ]["properties"]["print_observation"]
        payload["response_format"]["json_schema"].update(
            name="assembly_verification", schema=schema
        )
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode()
        if len(body) > self.settings.meta_max_request_bytes:
            raise InspectionError(
                "inspection_payload_too_large", "Verification context is too large.", 413
            )
        return body

    def parse_response(
        self, data: bytes, request: MultimodalInspectionRequest
    ) -> VerificationEvidence:
        try:
            envelope = json.loads(data)
            # Validate the same completed/refusal/ID/diagnostic contract as ordinary inspection.
            content = envelope["choices"][0]["message"]["content"]
            result = VerificationEvidence.model_validate_json(content)
            envelope["choices"][0]["message"]["content"] = json.dumps(
                result.model_dump(exclude={"issue_assessments"})
            )
            sanitized = MetaClient.parse_response(json.dumps(envelope).encode(), request)
            # Keep any discarded printed-side claim from the validated copy;
            # the locally parsed evidence still holds the raw model claim.
            result.print_observation = sanitized.print_observation
            result.observed_face_id = sanitized.observed_face_id
            previous = {item.issue_id: item for item in self.previous}
            ids = [item.previous_issue_id for item in result.issue_assessments]
            if len(ids) != len(set(ids)) or set(ids) != set(previous):
                raise ValueError("Every prior finding needs exactly one assessment")
            used_indices = set()
            for assessment in result.issue_assessments:
                index = assessment.current_issue_index
                if index is None:
                    continue
                if index >= len(result.issues) or index in used_indices:
                    raise ValueError("Invalid or ambiguous current issue reference")
                used_indices.add(index)
                old, new = previous[assessment.previous_issue_id].original, result.issues[index]
                if old.block_id != new.block_id or old.type != new.type:
                    raise ValueError("Finding association contradicts block/category evidence")
            return result
        except (ValueError, TypeError, KeyError, IndexError, AttributeError):
            raise InspectionError(
                "meta_invalid_verification",
                "Meta did not return valid verification evidence. "
                "Its response was incomplete, malformed or inconsistent with prior findings. "
                "Retry verification; this does not establish poor image quality.",
            ) from None
