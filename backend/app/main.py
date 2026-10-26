from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health, inspection
from app.core.config import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    application = FastAPI(title="AssemblyPilot API", version="0.1.0")
    application.dependency_overrides[get_settings] = lambda: settings
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    application.include_router(health.router)
    application.include_router(inspection.router)
    return application


app = create_app()
