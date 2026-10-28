"""Opt-in two-photo replay against the running local API; never paid inference in CI."""

import argparse
import json
from pathlib import Path

import httpx
from pydantic import ValidationError

from app.models.workflow import VerificationResponse, WorkflowInspectionResponse


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-live", action="store_true")
    parser.add_argument("--project-id")
    parser.add_argument("--step-id")
    parser.add_argument("--before", type=Path)
    parser.add_argument("--after", type=Path)
    args = parser.parse_args()
    if not args.run_live or not all((args.project_id, args.step_id, args.before, args.after)):
        print(
            "SKIPPED: Supply real before/after photos, registered IDs and --run-live. "
            "No requests sent."
        )
        return 77
    try:
        # Bound local reads. The API validates formats, dimensions and normalized identity.
        photos = []
        for path in (args.before, args.after):
            with path.open("rb") as source:
                data = source.read(8 * 1024 * 1024 + 1)
            if not data or len(data) > 8 * 1024 * 1024:
                raise ValueError("Photographs must be nonempty and <=8 MiB")
            photos.append(data)
        if photos[0] == photos[1]:
            raise ValueError("Supply a new after photograph, not the original image")
        ids = {"project_id": args.project_id, "step_id": args.step_id}
        with httpx.Client(
            base_url="http://127.0.0.1:8000", timeout=200, follow_redirects=False
        ) as client:
            initial = client.post(
                "/api/inspect", data=ids, files={"image": ("before.jpg", photos[0])}
            )
            initial.raise_for_status()
            before = WorkflowInspectionResponse.model_validate_json(initial.content)
            print(
                json.dumps(
                    {
                        "stage": "diagnosis",
                        "status": before.status,
                        "inspection_id": before.inspection_id,
                        "latency_ms": before.model_latency_ms,
                        "correction_plan": [item.model_dump() for item in before.correction_plan],
                    }
                )
            )
            if before.status != "incorrect":
                print("INCONCLUSIVE: The before photograph did not establish the intended error.")
                return 2
            reply = client.post(
                "/api/verify",
                data={**ids, "previous_inspection_id": before.inspection_id},
                files={"image": ("after.jpg", photos[1])},
            )
            reply.raise_for_status()
            result = VerificationResponse.model_validate_json(reply.content)
            if (
                result.previous_inspection_id != before.inspection_id
                or result.inspection.step_id != args.step_id
                or result.inspection.specification_id != before.specification_id
                or result.inspection.snapshot_id == before.snapshot_id
            ):
                raise ValueError("Verification does not belong to this fresh observation")
            print(
                json.dumps(
                    {
                        "stage": "verification",
                        "status": result.status,
                        "verification_id": result.verification_id,
                        "latency_ms": result.inspection.model_latency_ms,
                        "explanation": result.inspection.explanation,
                        "next_action": result.inspection.next_action,
                    }
                )
            )
            return 0 if result.status == "verified" else 2
    except httpx.HTTPStatusError as exc:
        print(
            f"FAILED: Local API returned HTTP {exc.response.status_code}. "
            "Check configuration/session and retry."
        )
    except httpx.RequestError:
        print("FAILED: Cannot reach the local backend on port 8000. Start it and retry.")
    except (OSError, ValueError, ValidationError):
        print(
            "FAILED: Invalid/unreadable photographs or incompatible API evidence. "
            "No success claimed."
        )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
