from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.core.config import Settings, get_settings
from app.services.voice_commands import match_command
from app.services.voice_service import VoiceError, VoiceSessionStore, WhisperEngine, validate_wav

router = APIRouter(prefix="/api/voice", tags=["voice"])


class VoiceSessionResponse(BaseModel):
    token: str
    expires_in: int


class VoiceStatusResponse(BaseModel):
    available: bool
    engine: str
    model: str
    reason: str


class TranscribeResponse(BaseModel):
    matched: bool
    action: str | None
    phrase: str | None
    language: str | None
    # Transient feedback for the headset only; never stored or logged server-side.
    transcript: str
    duration_seconds: float


def get_engine(settings: Annotated[Settings, Depends(get_settings)]) -> WhisperEngine:
    return WhisperEngine(settings)


def get_sessions(
    request: Request, settings: Annotated[Settings, Depends(get_settings)]
) -> VoiceSessionStore:
    store = getattr(request.app.state, "voice_sessions", None)
    if store is None:
        store = VoiceSessionStore(
            ttl_seconds=settings.voice_session_ttl_seconds,
            per_minute=settings.voice_rate_limit_per_minute,
            max_sessions=settings.voice_max_sessions,
        )
        request.app.state.voice_sessions = store
    return store


def get_transcriber(engine: Annotated[WhisperEngine, Depends(get_engine)]):
    """Indirection so tests can substitute a deterministic local transcriber."""

    def transcribe_audio(data: bytes, language: str) -> str:
        return engine.transcribe(data, language)

    return transcribe_audio


@router.get("/status", response_model=VoiceStatusResponse)
def voice_status(engine: Annotated[WhisperEngine, Depends(get_engine)]):
    available, reason = engine.available()
    return VoiceStatusResponse(
        available=available, engine=engine.kind, model=engine.model_label, reason=reason
    )


@router.post("/session", response_model=VoiceSessionResponse)
def create_session(
    sessions: Annotated[VoiceSessionStore, Depends(get_sessions)],
    settings: Annotated[Settings, Depends(get_settings)],
):
    try:
        token = sessions.create()
    except VoiceError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    return VoiceSessionResponse(token=token, expires_in=settings.voice_session_ttl_seconds)


@router.delete("/session", status_code=204)
def delete_session(
    sessions: Annotated[VoiceSessionStore, Depends(get_sessions)],
    x_voice_session: Annotated[str | None, Header()] = None,
):
    sessions.revoke(x_voice_session)
    return None


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    request: Request,
    audio: Annotated[UploadFile, File(description="Short 16 kHz mono WAV command clip")],
    settings: Annotated[Settings, Depends(get_settings)],
    engine: Annotated[WhisperEngine, Depends(get_engine)],
    sessions: Annotated[VoiceSessionStore, Depends(get_sessions)],
    transcriber: Annotated[object, Depends(get_transcriber)],
    x_voice_session: Annotated[str | None, Header()] = None,
    language: Annotated[str, Form(max_length=10)] = "en",
):
    try:
        sessions.authorize(x_voice_session)
        data = await audio.read(settings.voice_max_audio_bytes + 1)
        info = validate_wav(
            data, settings.voice_max_audio_bytes, settings.voice_max_duration_seconds
        )
        available, reason = engine.available()
        if not available:
            raise VoiceError(503, reason)
        transcript = await run_in_threadpool(transcriber, data, language)
    except VoiceError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    finally:
        await audio.close()
    matched = match_command(transcript)
    return TranscribeResponse(
        matched=matched is not None,
        action=matched["action"] if matched else None,
        phrase=matched["phrase"] if matched else None,
        language=matched["language"] if matched else None,
        transcript=transcript[:200],
        duration_seconds=info["duration_seconds"],
    )
