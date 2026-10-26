from functools import lru_cache

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

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
