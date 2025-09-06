from __future__ import annotations

import asyncio
import os
import sys
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

_ROOT = os.path.dirname(os.path.dirname(__file__))  # backend/
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)


@pytest.fixture()
def test_app() -> Generator[TestClient, None, None]:
    """Provide a TestClient wired up to an in-memory SQLite DB.

    Patches the app's session factory and startup seeders to use the test DB.
    """
    # Lazily import to avoid premature module init
    from src.app import main as app_mod
    from src.app import startup as startup_mod
    from src.app.config import settings
    from src.db import session as db_session_mod
    from src.db.models import Base
    from src.exchange.manager import ExchangeManager

    # Create an in-memory SQLite database engine
    test_engine: AsyncEngine = create_async_engine(
        "sqlite+aiosqlite:///:memory:", future=True
    )
    test_session_local = async_sessionmaker(
        bind=test_engine, class_=AsyncSession, expire_on_commit=False
    )

    # Create schema
    async def _create_schema() -> None:
        async with test_engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_create_schema())

    # Seed minimal symbols for tests
    async def _seed_symbols() -> None:
        from src.db.models import Symbol

        async with test_session_local() as s:  # type: ignore[name-defined]
            s.add_all(
                [
                    Symbol(symbol="AAPL", name="Apple Inc.", symbol_type="equity"),
                    Symbol(symbol="GOOGL", name="Alphabet Inc.", symbol_type="equity"),
                ]
            )
            await s.commit()

    asyncio.run(_seed_symbols())

    # Patch session factories in both modules that reference them
    db_session_mod.engine = test_engine
    db_session_mod.SessionLocal = test_session_local
    startup_mod.SessionLocal = test_session_local  # used by startup seeders

    # Ensure fresh exchange state per test
    app_mod._exchange = ExchangeManager()

    # Use DB-backed API keys
    settings.allow_any_api_key = False

    client = TestClient(app_mod.app)
    try:
        yield client
    finally:
        # Close client and drop DB
        client.close()
        async def _dispose() -> None:
            await test_engine.dispose()

        asyncio.run(_dispose())


@pytest.fixture()
def api_keys(test_app: TestClient) -> tuple[str, str]:
    """Register two users and return their API keys (A, B)."""
    # Register User A
    res_a = test_app.post(
        "/api/v1/auth/register",
        json={"openid_sub": "user_a_sub", "email": "a@example.com", "name": "Alice"},
    )
    assert res_a.status_code == 200
    key_a = res_a.json()["api_key"]

    # Register User B
    res_b = test_app.post(
        "/api/v1/auth/register",
        json={"openid_sub": "user_b_sub", "email": "b@example.com", "name": "Bob"},
    )
    assert res_b.status_code == 200
    key_b = res_b.json()["api_key"]

    return key_a, key_b
