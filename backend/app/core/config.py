from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_ROOT / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    database_url: str = "sqlite:///./data/assemblypilot.db"
    upload_dir: str = "./data/uploads"
    calibration_dir: str = "./data/calibrations"

    @property
    def calibration_path(self) -> Path:
        path = Path(self.calibration_dir).expanduser()
        return (path if path.is_absolute() else BACKEND_ROOT / path).resolve()


    @property
    def upload_path(self) -> Path:
        path = Path(self.upload_dir).expanduser()
        return (path if path.is_absolute() else BACKEND_ROOT / path).resolve()

    model_api_key: SecretStr | None = None
    meta_api_base_url: str = "https://api.meta.ai/v1"
    meta_vision_model: str = "muse-spark-1.3"
    meta_sam_model: Literal["sam-3.1"] = "sam-3.1"
    sam_enabled: bool = True
    face_canny_sigma: float = Field(default=0.33, ge=0.1, le=0.6)
    sam_request_timeout: float = Field(default=60, gt=0, le=60)
    sam_max_concepts_per_inspection: int = Field(default=2, ge=0, le=2)
    meta_request_timeout: float = Field(default=60, gt=0, le=180)
    inspection_max_dimension: int = Field(default=1280, ge=256, le=1600)
    meta_max_reference_images: int = Field(default=8, ge=0, le=20)
    meta_max_request_bytes: int = Field(default=10 * 1024 * 1024, gt=0, le=20 * 1024 * 1024)
    inspection_session_capacity: int = Field(default=64, ge=1, le=256)
    inspection_session_ttl_seconds: int = Field(default=1800, ge=60, le=7200)
    frontend_origin: str = "http://localhost:3000"
    # Local voice (Whisper on this Mac). Empty command = auto-detect
    # whisper-cli/main (whisper.cpp) then whisper (openai-whisper).
    voice_whisper_command: str = ""
    voice_whisper_model: str = "tiny"
    voice_whisper_model_path: str = ""
    voice_max_audio_bytes: int = Field(default=1_000_000, gt=0, le=5_000_000)
    voice_max_duration_seconds: float = Field(default=8, gt=0, le=30)
    voice_session_ttl_seconds: int = Field(default=600, ge=60, le=3600)
    voice_rate_limit_per_minute: int = Field(default=30, ge=1, le=120)
    voice_transcribe_timeout_seconds: float = Field(default=60, gt=0, le=180)
    max_upload_bytes: int = Field(default=8 * 1024 * 1024, gt=0)
    max_image_pixels: int = Field(default=20_000_000, gt=0)
    max_image_dimension: int = Field(default=8192, gt=0)
    min_image_dimension: int = Field(default=32, gt=0)
    resize_max_dimension: int = Field(default=1600, gt=0)

    @model_validator(mode="after")
    def validate_limits(self) -> "Settings":
        if self.min_image_dimension > self.max_image_dimension:
            raise ValueError("Minimum image dimension must not exceed maximum")
        if self.frontend_origin == "*":
            raise ValueError("Configure a specific frontend origin; wildcard CORS is not supported")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
