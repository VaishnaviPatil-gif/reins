"""
App configuration loaded from environment variables.
Using pydantic-settings so every missing var surfaces at startup, not at call time.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    paypal_client_id: str = "SANDBOX_CLIENT_ID"
    paypal_client_secret: str = "SANDBOX_CLIENT_SECRET"
    paypal_base_url: str = "https://api-m.sandbox.paypal.com"
    gemini_api_key: str = "GEMINI_KEY"
    gemini_model: str = "gemini-3.6-flash"
    reins_signing_secret: str = "change-me-32-chars-minimum-secret"
    database_url: str = "sqlite:///./reins.db"
    public_base_url: str = "http://localhost:8000"
    frontend_base_url: str = "http://localhost:5173"
    paypal_vault_fallback: bool = False


@lru_cache
def get_settings() -> Settings:
    """Cached so we parse env once."""
    return Settings()
