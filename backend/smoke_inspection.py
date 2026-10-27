"""Explicit, potentially billable smoke test. Never imported by ordinary tests or CI."""

import argparse
import asyncio
import json
from pathlib import Path
from time import perf_counter

from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session

from app.core.config import Settings
from app.db.database import database_engine
from app.services.image_processor import ImageValidationError, process_image
from app.services.inspection_errors import InspectionError
from app.services.inspection_request import build_multimodal_request, inspection_image_settings
from app.services.meta_client import MetaClient


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-id")
    parser.add_argument("--step-id")
    parser.add_argument("--image", type=Path, help="A real photograph of this assembly step")
    args = parser.parse_args()
    settings = Settings()
    if not settings.model_api_key or not settings.model_api_key.get_secret_value().strip():
        print("SKIPPED: MODEL_API_KEY is not configured in the backend. No Meta request sent.")
        return 77
    if not all((args.project_id, args.step_id, args.image)):
        parser.error("--project-id, --step-id and --image are required for a live inspection")
    started = perf_counter()
    engine = None
    try:
        with args.image.open("rb") as file:
            snapshot = process_image(
                file.read(settings.max_upload_bytes + 1), inspection_image_settings(settings)
            )
        engine = database_engine(settings)
        with Session(engine) as session:
            request = build_multimodal_request(
                session, settings, args.project_id, args.step_id, snapshot
            )
        result = asyncio.run(MetaClient(settings).inspect(request))
        print(json.dumps(result.model_dump(), ensure_ascii=True, indent=2))
        return 0
    except InspectionError as exc:
        print(f"FAILED: {exc.code}: {exc}")
        return 1
    except ImageValidationError as exc:
        print(f"FAILED: Invalid photograph: {exc}")
        return 1
    except HTTPException:
        print("FAILED: The registered project, step or reference was not found.")
        return 1
    except (OSError, SQLAlchemyError):
        print("FAILED: Cannot read the photograph, registry or references. Check local paths.")
        return 1
    finally:
        if engine is not None:
            engine.dispose()
        print(f"Duration: {perf_counter() - started:.2f}s")


if __name__ == "__main__":
    raise SystemExit(main())
