from __future__ import annotations

import hashlib
from typing import Annotated, TypedDict
from datetime import datetime

from fastapi import Depends, Header, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.config import settings
from src.db.models import APIKey as APIKeyModel
from src.db.session import get_db_session


class APIKey(TypedDict):
    team_id: str
    is_admin: bool
    key_hash: str


async def require_api_key(
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    session: AsyncSession = Depends(get_db_session)
) -> APIKey:
    if not x_api_key:
        raise HTTPException(status_code=401, detail="Missing X-API-Key header")

    if settings.allow_any_api_key:
        # Fallback mode for development - use hash but make it more unique
        key = x_api_key or settings.dev_api_key or "dev"
        # Use SHA-256 for better distribution and avoid collisions
        key_hash = hashlib.sha256(key.encode()).hexdigest()
        return APIKey(team_id=key_hash[:16], is_admin=False, key_hash=key_hash)

    # Production mode: validate against database
    key_hash = hashlib.sha256(x_api_key.encode()).hexdigest()

    # Look up API key in database and ensure active
    api_key_record = await session.scalar(
        select(APIKeyModel).where(APIKeyModel.key_hash == key_hash)
    )

    if not api_key_record or not api_key_record.is_active:
        raise HTTPException(status_code=401, detail="Invalid API key")

    # Update last_used timestamp (best-effort)
    try:
        await session.execute(
            update(APIKeyModel)
            .where(APIKeyModel.id == api_key_record.id)
            .values(last_used=datetime.utcnow())
        )
        await session.commit()
    except Exception:
        # Ignore telemetry errors
        pass

    return APIKey(
        team_id=str(api_key_record.team_id),
        is_admin=api_key_record.is_admin,
        key_hash=key_hash
    )


RequireAPIKey = Annotated[APIKey, Depends(require_api_key)]


async def require_admin(api_key: APIKey = Depends(require_api_key)) -> APIKey:
    if not api_key["is_admin"]:
        raise HTTPException(status_code=403, detail="Admin access required")
    return api_key

RequireAdmin = Annotated[APIKey, Depends(require_admin)]
