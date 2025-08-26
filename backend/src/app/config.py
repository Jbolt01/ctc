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


settings = Settings()

