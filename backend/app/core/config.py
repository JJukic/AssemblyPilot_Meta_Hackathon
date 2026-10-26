from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_ROOT / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    database_url: str = "sqlite:///./data/assemblypilot.db"
    upload_dir: str = "./data/uploads"

    @property
    def upload_path(self) -> Path:
        path = Path(self.upload_dir).expanduser()
        return (path if path.is_absolute() else BACKEND_ROOT / path).resolve()

    model_api_key: SecretStr | None = None
    meta_api_base_url: str = "https://api.meta.ai/v1"
    meta_vision_model: str = ""
    frontend_origin: str = "http://localhost:3000"
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
