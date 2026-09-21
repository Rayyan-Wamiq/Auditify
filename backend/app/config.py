"""
Central application configuration.

All runtime configuration is sourced from environment variables (optionally
loaded from a `.env` file in local development) so the same container image
can be promoted across environments without code changes.
"""
from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Database -----------------------------------------------------
    DATABASE_URL: str = "postgresql+psycopg2://auditify:auditify@localhost:5432/auditify"
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_TIMEOUT: int = 30
    DB_POOL_RECYCLE: int = 1800

    # --- LLM / RAG ------------------------------------------------------
    GROQ_API_KEY: str = ""
    DEFAULT_GROQ_MODEL: str = "openai/gpt-oss-120b"
    CHROMA_PERSIST_DIR: str = "./chroma_store"

    # --- Auth / JWT -----------------------------------------------------
    # HMAC signing key for access/refresh tokens. MUST be overridden in .env
    # (and kept secret) - the value below is a development-only placeholder.
    SECRET_KEY: str = "dev-only-insecure-change-me-in-env"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # --- App --------------------------------------------------------------
    CORS_ORIGINS: str = "http://localhost:3000"
    MAX_UPLOAD_MB: int = 15
    APP_NAME: str = "Auditify - AI Technical Audit & Compliance Engine"

    @property
    def access_token_expire_seconds(self) -> int:
        return self.ACCESS_TOKEN_EXPIRE_MINUTES * 60

    @property
    def is_default_secret_key(self) -> bool:
        """True when SECRET_KEY was never overridden (unsafe for production)."""
        return self.SECRET_KEY == Settings.model_fields["SECRET_KEY"].default

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return self.MAX_UPLOAD_MB * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
