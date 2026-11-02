"""Local voice endpoint tests. A deterministic fake transcriber replaces the
local Whisper CLI; no audio is stored and no Meta inference is involved."""

import io
import wave

import pytest

from app.api import voice as voice_api
from app.services.voice_commands import match_command, normalize_transcript


def wav_bytes(seconds=1.0, rate=16000, channels=1):
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(b"\x00\x00" * int(rate * seconds) * channels)
    return buffer.getvalue()


@pytest.fixture
def voice_client(client, monkeypatch):
    client.app.dependency_overrides[voice_api.get_transcriber] = lambda: (
        lambda data, lang: "Show result"
    )
    # Engine must report available without a real Whisper install in CI.
    monkeypatch.setattr(
        voice_api.WhisperEngine, "available", lambda self: (True, "fake engine ready")
    )
    return client


@pytest.fixture(autouse=True)
def _clear_overrides(client):
    yield
    client.app.dependency_overrides.pop(voice_api.get_transcriber, None)


def session(client) -> str:
    response = client.post("/api/voice/session")
    assert response.status_code == 200
    return response.json()["token"]


def post_clip(client, token=None, data=None, language="en"):
    headers = {"X-Voice-Session": token} if token else {}
    return client.post(
        "/api/voice/transcribe",
        headers=headers,
        files={"audio": ("clip.wav", data if data is not None else wav_bytes(), "audio/wav")},
        data={"language": language},
    )


def test_status_reports_engine_without_secrets(client):
    body = client.get("/api/voice/status").json()
    assert set(body) == {"available", "engine", "model", "reason"}


def test_transcribe_requires_session_and_matches_command(voice_client):
    assert post_clip(voice_client).status_code == 401
    assert post_clip(voice_client, token="bogus").status_code == 401
    response = post_clip(voice_client, token=session(voice_client))
    assert response.status_code == 200
    body = response.json()
    assert body["matched"] is True
    assert body["action"] == "show-result"
    assert body["phrase"] == "show result"


def test_unknown_and_ambiguous_commands_do_not_match(client, monkeypatch):
    monkeypatch.setattr(
        voice_api.WhisperEngine, "available", lambda self: (True, "fake engine ready")
    )
    for transcript in ["please tidy the room", "next step and previous step", "verify"]:
        client.app.dependency_overrides[voice_api.get_transcriber] = (
            lambda t=transcript: (lambda data, lang: t)
        )
        response = post_clip(client, token=session(client))
        assert response.json()["matched"] is False, transcript
        assert response.json()["action"] is None


def test_navigation_and_verify_are_buttons_only_german_aliases_match():
    # Weiter / Zurück / Bestätigen / Erneut prüfen: HoloLens panel buttons only.
    for phrase in ["Verify again", "Nächster Schritt", "Schritt erneut prüfen", "Schritt prüfen"]:
        assert match_command(phrase) is None, phrase
    assert match_command("Ergebnis anzeigen")["action"] == "show-result"
    assert match_command("AssemblyPilot, exit AR!")["action"] == "exit"
    assert normalize_transcript("  AssemblyPilot NEXT Step. ") == "next step"
    assert match_command("don't verify step") is None


def test_rejects_non_wav_oversized_and_long_clips(voice_client):
    token = session(voice_client)
    assert post_clip(voice_client, token=token, data=b"not-audio").status_code == 415
    assert post_clip(voice_client, token=token, data=wav_bytes(seconds=20)).status_code in (
        413,
        422,
    )
    assert post_clip(voice_client, token=token, data=wav_bytes(rate=44100)).status_code == 415
    assert post_clip(voice_client, token=token, data=wav_bytes(channels=2)).status_code == 415


def test_rate_limit_and_session_revoke(voice_client, monkeypatch):
    store = voice_api.VoiceSessionStore(ttl_seconds=600, per_minute=2)
    voice_client.app.state.voice_sessions = store
    token = session(voice_client)
    assert post_clip(voice_client, token=token).status_code == 200
    assert post_clip(voice_client, token=token).status_code == 200
    assert post_clip(voice_client, token=token).status_code == 429
    voice_client.delete("/api/voice/session", headers={"X-Voice-Session": token})
    assert post_clip(voice_client, token=token).status_code == 401
    del voice_client.app.state.voice_sessions


def test_engine_unavailable_is_honest_503(client, monkeypatch):
    monkeypatch.setattr(
        voice_api.WhisperEngine, "available", lambda self: (False, "No local Whisper CLI found")
    )
    client.app.dependency_overrides[voice_api.get_transcriber] = lambda: (
        lambda data, lang: "Show result"
    )
    response = post_clip(client, token=session(client))
    assert response.status_code == 503
    assert "Whisper" in response.json()["detail"]


def test_voice_endpoints_never_touch_meta_inspection(voice_client, monkeypatch):
    # No MODEL_API_KEY is configured in tests; a successful transcribe proves
    # the voice path is independent of Meta inference.
    response = post_clip(voice_client, token=session(voice_client))
    assert response.status_code == 200
    assert voice_client.get("/health").status_code == 200


def test_command_table_matches_shared_parity_fixture():
    import json
    from pathlib import Path

    fixture = json.loads(
        (Path(__file__).resolve().parents[2] / "frontend/src/lib/ar/voice-commands.json")
        .read_text(encoding="utf-8")
    )
    for phrase, action, language in fixture["accepted"]:
        matched = match_command(phrase)
        assert matched is not None, phrase
        assert matched["action"] == action, phrase
        assert matched["language"] == language, phrase
    for phrase in fixture["rejected"]:
        assert match_command(phrase) is None, phrase


def test_removed_whisper_variants_never_match():
    for phrase in [
        "Previous steps", "Go back", "Back one step", "Next steps", "Go forward",
        "Inspect step", "Inspect again",
    ]:
        assert match_command(phrase) is None, phrase
