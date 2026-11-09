"""
App configuration loaded from environment variables.
Using pydantic-settings so every missing var surfaces at startup, not at call time.
"""
import os
import sys
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    paypal_client_id: str = "SANDBOX_CLIENT_ID"
    paypal_client_secret: str = "SANDBOX_CLIENT_SECRET"
    paypal_base_url: str = "https://api-m.sandbox.paypal.com"
    gemini_api_key: str = "GEMINI_KEY"
    gemini_model: str = "gemini-3.6-flash"
    reins_signing_secret: str = ""
    database_url: str = "sqlite:///./reins.db"
    public_base_url: str = "http://localhost:8000"
    frontend_base_url: str = "http://localhost:5173"
    paypal_vault_fallback: bool = False
    demo_mode: bool = False

    @field_validator("reins_signing_secret", mode="after")
    @classmethod
    def validate_signing_secret(cls, v: str) -> str:
        is_testing = (
            os.environ.get("REINS_TEST_MODE") == "1"
            or "pytest" in sys.modules
            or "PYTEST_CURRENT_TEST" in os.environ
            or any("pytest" in arg for arg in sys.argv)
        )
        if os.environ.get("REINS_PROD_TEST") == "1":
            is_testing = False

        if not v or not v.strip():
            if is_testing:
                return "test-signing-secret-placeholder-for-tests-32b"
            raise ValueError(
                "REINS_SIGNING_SECRET is missing. The application refuses to start outside tests without REINS_SIGNING_SECRET set."
            )
        return v.strip()

    @field_validator("public_base_url", "frontend_base_url", mode="after")
    @classmethod
    def ensure_url_scheme(cls, v: str) -> str:
        url = v.strip().rstrip("/")
        if url and not url.startswith("http://") and not url.startswith("https://"):
            return f"https://{url}"
        return url


@lru_cache
def get_settings() -> Settings:
    """Cached so we parse env once."""
    return Settings()
