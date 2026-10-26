from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: Literal["assemblypilot-backend"] = "assemblypilot-backend"
    version: Literal["0.1.0"] = "0.1.0"


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()
