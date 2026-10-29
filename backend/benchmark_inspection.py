"""Opt-in evaluation of user-labelled real photos; no bundled images or model results."""

import argparse
import asyncio
import hashlib
import json
from pathlib import Path
from statistics import mean
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session

from app.core.config import Settings
from app.db.database import database_engine
from app.models.multimodal import MultimodalInspectionRequest
from app.services.image_processor import ImageValidationError, process_image
from app.services.inspection_errors import InspectionError
from app.services.inspection_request import build_multimodal_request, inspection_image_settings
from app.services.inspection_service import inspect_with_metadata
from app.services.meta_client import MetaClient
from app.services.sam_client import SamClient


class BenchmarkCase(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=100)
    project_id: str = Field(min_length=1)
    step_id: str = Field(min_length=1)
    image: str = Field(min_length=1)
    expected_status: Literal["correct", "incorrect", "uncertain"]
    expected_issue_types: list[
        Literal[
            "missing_part",
            "misplaced_part",
            "wrong_color",
            "wrong_orientation",
            "unexpected_part",
            "unknown",
        ]
    ] = Field(max_length=6)

    @model_validator(mode="after")
    def consistent_labels(self):
        if len(set(self.expected_issue_types)) != len(self.expected_issue_types):
            raise ValueError("Issue type labels must be unique")
        if self.expected_status == "correct" and self.expected_issue_types:
            raise ValueError("Correct cases cannot expect discrepancies")
        if self.expected_status == "incorrect" and not self.expected_issue_types:
            raise ValueError("Incorrect cases need an expected issue type")
        return self


class BenchmarkManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cases: list[BenchmarkCase] = Field(min_length=1, max_length=10)

    @model_validator(mode="after")
    def unique_cases(self):
        if len({case.id for case in self.cases}) != len(self.cases):
            raise ValueError("Case IDs must be unique")
        return self


def summarize(rows: list[dict]) -> dict:
    completed = [row for row in rows if "diagnosis" in row]
    return {
        "cases": len(rows),
        "completed": len(completed),
        "failed": len(rows) - len(completed),
        # Include failed requests in the denominator; never silently inflate accuracy.
        "status_accuracy": sum(row.get("status_match", False) for row in rows) / len(rows)
        if rows
        else None,
        "issue_type_exact_match": sum(row.get("issue_types_match", False) for row in rows)
        / len(rows)
        if rows
        else None,
        "mean_model_latency_ms": mean(row["model_latency_ms"] for row in completed)
        if completed
        else None,
        "localization_accuracy": None,
        "localization_note": (
            "Boxes need human comparison with the recorded input; "
            "no spatial ground truth is supplied."
        ),
    }


async def evaluate(
    prepared: list[tuple[BenchmarkCase, MultimodalInspectionRequest]], client: MetaClient
) -> dict:
    rows = []
    for case, request in prepared:
        row = {
            "case_id": case.id,
            "expected_status": case.expected_status,
            "expected_issue_types": case.expected_issue_types,
            "snapshot_sha256": hashlib.sha256(request.images[0].image.jpeg_bytes).hexdigest(),
            "reference_count": len(request.images) - 1,
        }
        try:
            # Preserve this benchmark's Muse-only cost/latency and image-free report.
            sam = SamClient(client.settings.model_copy(update={"sam_enabled": False}))
            result = await inspect_with_metadata(client, request, sam)
            actual_types = {issue.type for issue in result.issues}
            row.update(
                diagnosis=result.model_dump(
                    mode="json",
                    exclude={"analyzed_snapshot", "model_latency_ms", "inspected_at", "model"},
                ),
                model_latency_ms=result.model_latency_ms,
                inspected_at=result.inspected_at.isoformat(),
                status_match=result.status == case.expected_status,
                issue_types_match=actual_types == set(case.expected_issue_types),
            )
        except InspectionError as error:
            row.update(error_code=error.code)
        rows.append(row)
    return {"model": client.settings.meta_vision_model, "summary": summarize(rows), "results": rows}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--output", type=Path, default=Path("data/benchmark-results.json"))
    parser.add_argument(
        "--run-live", action="store_true", help="Explicitly send up to 10 cases to Meta (billable)"
    )
    args = parser.parse_args()
    if not args.run_live or not args.manifest:
        print("SKIPPED: Supply a real-photo manifest and --run-live. No Meta requests sent.")
        return 77
    settings = Settings()
    if not settings.model_api_key or not settings.model_api_key.get_secret_value().strip():
        print("SKIPPED: MODEL_API_KEY is not configured. No Meta requests sent.")
        return 77
    engine = None
    try:
        # Validate every input before starting any paid inference.
        with args.manifest.open("rb") as file:
            manifest = BenchmarkManifest.model_validate_json(file.read(1024 * 1024))
        if args.output.exists():
            print("FAILED: Output already exists. Choose a new report path.")
            return 1
        engine = database_engine(settings)
        prepared = []
        with Session(engine) as session:
            for case in manifest.cases:
                image_path = args.manifest.resolve().parent / case.image
                with image_path.open("rb") as file:
                    snapshot = process_image(
                        file.read(settings.max_upload_bytes + 1),
                        inspection_image_settings(settings),
                    )
                request = build_multimodal_request(
                    session, settings, case.project_id, case.step_id, snapshot
                )
                prepared.append((case, request))
        result = asyncio.run(evaluate(prepared, MetaClient(settings)))
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("x", encoding="utf-8") as file:
            json.dump(result, file, indent=2, ensure_ascii=True)
        print(json.dumps(result["summary"], indent=2))
        return 1 if result["summary"]["failed"] else 0
    except (
        OSError,
        ValidationError,
        HTTPException,
        ImageValidationError,
        InspectionError,
        SQLAlchemyError,
    ):
        print(
            "FAILED: Check the manifest, labelled cases, image files, registry and output path. "
            "No fabricated scores produced."
        )
        return 1
    finally:
        if engine is not None:
            engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
