from __future__ import annotations

from typing import Annotated, TypedDict

from fastapi import Depends, Header, HTTPException

from src.app.config import settings


class APIKey(TypedDict):
    team_id: str
    is_admin: bool


def require_api_key(x_api_key: str | None = Header(default=None, alias="X-API-Key")) -> APIKey:
    if settings.allow_any_api_key:
        if not x_api_key and not settings.dev_api_key:
            raise HTTPException(status_code=401, detail="Missing X-API-Key header")
        key = x_api_key or settings.dev_api_key or "dev"
        return APIKey(team_id=f"team-{hash(key) & 0xFFFF:X}", is_admin=False)
    # TODO: validate key against database
    if not x_api_key:
        raise HTTPException(status_code=401, detail="Missing X-API-Key header")
    return APIKey(team_id=f"team-{hash(x_api_key) & 0xFFFF:X}", is_admin=False)


RequireAPIKey = Annotated[APIKey, Depends(require_api_key)]

