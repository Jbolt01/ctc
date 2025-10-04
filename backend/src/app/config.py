from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env",), case_sensitive=False)

    api_title: str = "Cornell Trading Competition API"
    api_version: str = "0.1.0"

    database_url: str = Field(
        default="postgresql+asyncpg://trading_user:devpassword@localhost:5432/trading_competition",
        alias="DATABASE_URL",
    )
    redis_url: str = Field(default="redis://localhost:6379", alias="REDIS_URL")

    allow_any_api_key: bool = Field(default=True, alias="ALLOW_ANY_API_KEY")
    dev_api_key: str | None = Field(default=None, alias="DEV_API_KEY")

    # Google Identity (frontend passes NEXT_PUBLIC_GOOGLE_CLIENT_ID)
    google_client_id: str | None = Field(default=None, alias="NEXT_PUBLIC_GOOGLE_CLIENT_ID")
    admin_emails_raw: str | None = Field(default=None, alias="ADMIN_EMAILS")
    seed_on_startup: bool = Field(default=False, alias="SEED_ON_STARTUP")

    # Email registration controls
    allow_all_emails: bool = Field(default=False, alias="ALLOW_ALL_EMAILS")
    allowed_emails_raw: str | None = Field(default=None, alias="ALLOWED_EMAILS")

    @property
    def admin_emails(self) -> set[str]:
        # Default admins
        default = {"cornellquantfund@gmail.com", "vrs29@cornell.edu"}
        if not self.admin_emails_raw:
            return default
        parts = [p.strip() for p in self.admin_emails_raw.split(",") if p.strip()]
        return {p.lower() for p in parts} or default

    @property
    def allowed_emails(self) -> set[str]:
        if not self.allowed_emails_raw:
            return set()
        parts = [p.strip() for p in self.allowed_emails_raw.split(",") if p.strip()]
        return {p.lower() for p in parts}


settings = Settings()
