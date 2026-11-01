from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    ar,
    blocks,
    calibration,
    edge_debug,
    faces,
    geometry,
    health,
    inspection,
    media,
    object_localization,
    projects,
    setup,
    steps,
    voice,
)
from app.core.config import Settings, get_settings
from app.db.database import database_engine
from app.services.assembly_orchestrator import InspectionSessions


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        engine = database_engine(settings)
        application.state.engine = engine
        application.state.inspection_sessions = InspectionSessions(
            settings.inspection_session_capacity, settings.inspection_session_ttl_seconds
        )
        settings.upload_path.mkdir(parents=True, exist_ok=True)
        try:
            yield
        finally:
            engine.dispose()

    application = FastAPI(title="AssemblyPilot API", version="0.3.1", lifespan=lifespan)
    application.dependency_overrides[get_settings] = lambda: settings
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type", "X-Voice-Session"],
    )
    application.include_router(health.router)
    application.include_router(voice.router)
    application.include_router(ar.router)
    application.include_router(setup.router)
    application.include_router(inspection.router)
    application.include_router(calibration.router)
    application.include_router(geometry.router)
    application.include_router(faces.router)
    application.include_router(edge_debug.router)
    application.include_router(object_localization.router)
    for router in (blocks.router, projects.router, steps.router, media.router):
        application.include_router(router)
    return application


app = create_app()
