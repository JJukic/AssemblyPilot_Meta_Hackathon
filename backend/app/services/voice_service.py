"""Local speech-to-text on the MacBook backend.

Engine: a locally installed Whisper CLI — whisper.cpp (`whisper-cli`/`main`,
preferred on Apple Silicon via Metal) or openai-whisper (`whisper`). Models
live outside the repository and are never committed. Audio and transcripts
are held only in memory/temp files that are deleted immediately; nothing is
stored or logged.
"""

import io
import shutil
import subprocess
import tempfile
import time
import wave
from collections import deque
from pathlib import Path

from app.core.config import Settings


class VoiceError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code


class VoiceSessionStore:
    """In-memory, expiring voice-session tokens with per-session rate limits."""

    def __init__(self, ttl_seconds: int = 600, per_minute: int = 30):
        self.ttl = ttl_seconds
        self.per_minute = per_minute
        self._sessions: dict[str, dict] = {}

    def create(self) -> str:
        import secrets

        token = secrets.token_urlsafe(32)
        self._sessions[token] = {"expires": time.monotonic() + self.ttl, "hits": deque()}
        return token

    def authorize(self, token: str | None) -> None:
        if not token:
            raise VoiceError(401, "Voice session required. Enable local voice first.")
        session = self._sessions.get(token)
        now = time.monotonic()
        if session is None or session["expires"] < now:
            self._sessions.pop(token, None)
            raise VoiceError(401, "Voice session expired. Enable local voice again.")
        hits: deque = session["hits"]
        while hits and hits[0] < now - 60:
            hits.popleft()
        if len(hits) >= self.per_minute:
            raise VoiceError(429, "Voice rate limit reached. Wait a moment, then try again.")
        hits.append(now)

    def revoke(self, token: str | None) -> None:
        if token:
            self._sessions.pop(token, None)


def validate_wav(data: bytes, max_bytes: int, max_seconds: float) -> dict:
    """Validate a bounded 16 kHz mono WAV clip without storing it."""
    if not data:
        raise VoiceError(422, "Empty audio clip.")
    if len(data) > max_bytes:
        raise VoiceError(413, "Audio clip too large.")
    try:
        with wave.open(io.BytesIO(data), "rb") as wav:
            channels = wav.getnchannels()
            rate = wav.getframerate()
            frames = wav.getnframes()
            width = wav.getsampwidth()
    except (wave.Error, EOFError) as exc:
        raise VoiceError(415, "Audio must be a WAV clip recorded by the app.") from exc
    if channels != 1 or width != 2:
        raise VoiceError(415, "Audio must be mono 16-bit WAV.")
    if rate != 16000:
        raise VoiceError(415, "Audio must be 16 kHz WAV.")
    duration = frames / rate if rate else 0.0
    if duration <= 0.1:
        raise VoiceError(422, "Audio clip too short to recognize.")
    if duration > max_seconds:
        raise VoiceError(422, f"Audio clip too long (max {max_seconds:.0f} seconds).")
    return {"sample_rate": rate, "duration_seconds": round(duration, 3)}


class WhisperEngine:
    """Subprocess adapter for a locally installed Whisper CLI."""

    def __init__(self, settings: Settings):
        self.command = settings.voice_whisper_command.strip()
        self.model = settings.voice_whisper_model.strip() or "tiny"
        self.model_path = settings.voice_whisper_model_path.strip()
        self.timeout = settings.voice_transcribe_timeout_seconds

    def resolved_command(self) -> str | None:
        if self.command:
            return shutil.which(self.command) or (
                self.command if Path(self.command).is_file() else None
            )
        for candidate in ("whisper-cli", "main", "whisper"):
            found = shutil.which(candidate)
            if found:
                return found
        return None

    @property
    def kind(self) -> str:
        resolved = self.resolved_command() or ""
        name = Path(resolved).name
        return "whisper.cpp" if name in ("whisper-cli", "main") else "openai-whisper"

    def available(self) -> tuple[bool, str]:
        if self.resolved_command() is None:
            return False, (
                "No local Whisper CLI found on the backend Mac. Install whisper.cpp "
                "(whisper-cli) or openai-whisper; see docs/hololens.md."
            )
        if self.kind == "whisper.cpp" and self.model_path and not Path(self.model_path).is_file():
            return False, "Configured whisper.cpp model file is missing on the backend Mac."
        return True, f"Local {self.kind} engine ready (model: {self.model_label})."

    @property
    def model_label(self) -> str:
        return Path(self.model_path).name if self.model_path else self.model

    def transcribe(self, wav_bytes: bytes, language: str) -> str:
        command = self.resolved_command()
        if command is None:
            raise VoiceError(503, "Local speech recognition is not installed on the backend Mac.")
        lang = "de" if language.startswith("de") else "en"
        with tempfile.TemporaryDirectory(prefix="assemblypilot-voice-") as directory:
            root = Path(directory)
            audio = root / "clip.wav"
            audio.write_bytes(wav_bytes)
            try:
                if self.kind == "whisper.cpp":
                    args = [command, "-f", str(audio), "-nt", "-np", "-l", lang]
                    if self.model_path:
                        args += ["-m", self.model_path]
                    result = subprocess.run(  # noqa: S603 - fixed argv, no shell
                        args, capture_output=True, text=True, timeout=self.timeout, check=False
                    )
                    if result.returncode != 0:
                        raise VoiceError(502, "Local speech recognition failed on the backend.")
                    return result.stdout.strip()
                args = [
                    command,
                    str(audio),
                    "--model",
                    self.model,
                    "--language",
                    "German" if lang == "de" else "English",
                    "--output_format",
                    "txt",
                    "--output_dir",
                    str(root),
                    "--fp16",
                    "False",
                    "--verbose",
                    "False",
                ]
                result = subprocess.run(  # noqa: S603 - fixed argv, no shell
                    args, capture_output=True, text=True, timeout=self.timeout, check=False
                )
                if result.returncode != 0:
                    raise VoiceError(502, "Local speech recognition failed on the backend.")
                text_file = root / "clip.txt"
                return text_file.read_text(encoding="utf-8").strip() if text_file.exists() else ""
            except subprocess.TimeoutExpired as exc:
                raise VoiceError(504, "Local speech recognition timed out.") from exc
        # Temp directory (audio + transcript) is deleted here; nothing is stored.
