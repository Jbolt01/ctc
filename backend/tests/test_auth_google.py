from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from src.app.config import settings


def test_register_and_login_with_id_token_monkeypatch(
    test_app: TestClient, monkeypatch: Any, admin_key: str
) -> None:
    client = test_app

    # Force production-like path for verification but monkeypatch verifier
    allow_backup = settings.allow_any_api_key
    settings.allow_any_api_key = False

    claims = {"sub": "sub-abc", "email": "user@example.com", "name": "Alice"}

    async def fake_verify(_token: str) -> dict[str, Any]:  # type: ignore
        return claims

    monkeypatch.setattr("src.app.main._verify_google_id_token", fake_verify)

    # Add email to allowed list
    res = test_app.post("/api/v1/admin/allowed-emails", headers={"X-API-Key": admin_key}, json={"email": claims["email"]})
    assert res.status_code == 200

    # Register
    r = client.post(
        "/api/v1/auth/register",
        json={"id_token": "dummy"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["api_key"]
    assert data["user"]["email"] == claims["email"]

    # Login (should succeed for same sub)
    r2 = client.post(
        "/api/v1/auth/login",
        json={"id_token": "dummy"},
    )
    assert r2.status_code == 200
    data2 = r2.json()
    assert data2["api_key"]
    assert data2["user"]["email"] == claims["email"]

    settings.allow_any_api_key = allow_backup


def test_login_dev_without_id_token(
    test_app: TestClient, monkeypatch: Any
) -> None:
    client = test_app
    allow_backup = settings.allow_any_api_key
    settings.allow_any_api_key = True
    settings.allow_all_emails = True

    user = {"openid_sub": "dev-sub", "email": "dev@example.com", "name": "Dev"}

    # In dev, register then login with plain fields (no verification)
    r = client.post("/api/v1/auth/register", json=user)
    assert r.status_code == 200
    r2 = client.post("/api/v1/auth/login", json=user)
    assert r2.status_code == 200

    settings.allow_any_api_key = allow_backup
    settings.allow_all_emails = False
