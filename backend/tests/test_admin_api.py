from __future__ import annotations

import asyncio
import hashlib
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from src.db.models import APIKey
from src.db.session import get_db_session


def _headers(api_key: str) -> dict[str, str]:
    return {"X-API-Key": api_key}


async def _promote_to_admin_from_api_key_value(api_key_value: str) -> None:
    key_hash = hashlib.sha256(api_key_value.encode()).hexdigest()
    async for session in get_db_session():
        row = await session.scalar(select(APIKey).where(APIKey.key_hash == key_hash))
        assert row is not None, "API key not found to promote"
        row.is_admin = True
        session.add(row)
        await session.commit()
        break


@pytest.fixture()
def admin_key(test_app: TestClient) -> str:
    # Register a dedicated admin user and promote their key
    reg = test_app.post(
        "/api/v1/auth/register",
        json={"openid_sub": "admin-sub", "email": "admin@ex.com", "name": "Admin"},
    )
    assert reg.status_code == 200
    key = reg.json()["api_key"]
    asyncio.run(_promote_to_admin_from_api_key_value(key))
    return key


def test_admin_symbols_crud_and_controls(test_app: TestClient, admin_key: str) -> None:
    # Create a new symbol
    r = test_app.post(
        "/api/v1/admin/symbols",
        headers=_headers(admin_key),
        json={
            "symbol": "TSLA",
            "name": "Tesla",
            "symbol_type": "equity",
            "tick_size": 0.01,
            "lot_size": 1,
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert data["symbol"] == "TSLA" and data["name"] == "Tesla"

    # List symbols with admin status
    r2 = test_app.get("/api/v1/admin/symbols", headers=_headers(admin_key))
    assert r2.status_code == 200
    symbols = r2.json()
    assert any(s["symbol"] == "TSLA" for s in symbols)

    # Pause all, then start TSLA only
    r3 = test_app.post(
        "/api/v1/admin/symbols/pause", headers=_headers(admin_key), json={}
    )
    assert r3.status_code == 200 and r3.json()["status"] == "paused"
    r4 = test_app.post(
        "/api/v1/admin/symbols/start", headers=_headers(admin_key), json={"symbol": "TSLA"}
    )
    assert r4.status_code == 200 and r4.json()["status"] == "started"

    # Settle TSLA
    r5 = test_app.post(
        "/api/v1/admin/symbols/settle",
        headers=_headers(admin_key),
        json={"symbol": "TSLA", "price": 150.25},
    )
    assert r5.status_code == 200 and r5.json()["status"] == "settled"

    # Delete TSLA
    r6 = test_app.delete("/api/v1/admin/symbols/TSLA", headers=_headers(admin_key))
    assert r6.status_code == 200 and r6.json()["status"] == "deleted"


def test_admin_limits_and_hours_crud(test_app: TestClient, admin_key: str) -> None:
    # Ensure a symbol exists (AAPL seeded)
    rl = test_app.post(
        "/api/v1/admin/limits",
        headers=_headers(admin_key),
        json={
            "symbol": "AAPL",
            "max_position": 1000,
            "max_order_size": 250,
            "applies_to_admin": False,
        },
    )
    assert rl.status_code == 200
    gl = test_app.get("/api/v1/admin/limits", headers=_headers(admin_key))
    assert gl.status_code == 200
    limits = gl.json()
    assert any(row["symbol"] == "AAPL" and row["max_order_size"] == 250 for row in limits)

    # Hours
    rh = test_app.post(
        "/api/v1/admin/hours",
        headers=_headers(admin_key),
        json={
            "symbol": "AAPL",
            "day_of_week": 1,
            "open_time": "09:30",
            "close_time": "16:00",
            "is_active": True,
        },
    )
    assert rh.status_code == 200
    gh = test_app.get("/api/v1/admin/hours", headers=_headers(admin_key))
    assert gh.status_code == 200
    rows = gh.json()
    assert any(r["symbol"] == "AAPL" and r["day_of_week"] == 1 for r in rows)


def test_admin_teams_competitions_users_marketdata(test_app: TestClient, admin_key: str) -> None:
    # Teams CRUD
    rt = test_app.post(
        "/api/v1/admin/teams", headers=_headers(admin_key), json={"name": "Gamma"}
    )
    assert rt.status_code == 200
    # Duplicate should 409
    rt2 = test_app.post(
        "/api/v1/admin/teams", headers=_headers(admin_key), json={"name": "Gamma"}
    )
    assert rt2.status_code == 409
    gt = test_app.get("/api/v1/admin/teams", headers=_headers(admin_key))
    assert gt.status_code == 200 and any(t["name"] == "Gamma" for t in gt.json())

    # Competition
    rc = test_app.post(
        "/api/v1/admin/competitions",
        headers=_headers(admin_key),
        json={
            "name": "Fall",
            "start_time": (datetime.utcnow()).isoformat(),
            "end_time": (datetime.utcnow() + timedelta(days=1)).isoformat(),
            "is_active": True,
        },
    )
    assert rc.status_code == 200
    gc = test_app.get("/api/v1/admin/competitions", headers=_headers(admin_key))
    assert gc.status_code == 200 and any(c["name"] == "Fall" for c in gc.json())

    # Users list and set admin
    gu = test_app.get("/api/v1/admin/users", headers=_headers(admin_key))
    assert gu.status_code == 200
    users = gu.json()
    assert users and {"id", "email", "name", "is_admin"}.issubset(users[0].keys())
    target_id = users[0]["id"]
    su = test_app.post(
        f"/api/v1/admin/users/{target_id}/admin",
        headers=_headers(admin_key),
        json={"is_admin": True},
    )
    assert su.status_code == 200

    # Market data upsert
    md = test_app.post(
        "/api/v1/admin/market-data",
        headers=_headers(admin_key),
        json={"symbol": "AAPL", "close": 123.45},
    )
    assert md.status_code == 200 and md.json()["status"] == "ok"
