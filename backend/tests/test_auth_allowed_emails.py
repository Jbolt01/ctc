from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from src.app.config import settings
from src.db.models import AllowedEmail
from src.db.session import get_db_session


@pytest.fixture
def admin_key(test_app: TestClient) -> str:
    """Register a dedicated admin user and return their API key."""
    admin_email = "admin-allowed@example.com"
    original_admins = settings.admin_emails_raw
    settings.admin_emails_raw = (
        f"{original_admins},{admin_email}" if original_admins else admin_email
    )

    reg = test_app.post(
        "/api/v1/auth/register",
        json={
            "openid_sub": "admin-sub-allowed-emails",
            "email": admin_email,
            "name": "Admin Allowed",
        },
    )
    assert reg.status_code == 200
    key = reg.json()["api_key"]

    # Revert settings
    settings.admin_emails_raw = original_admins
    return key


def _headers(api_key: str) -> dict[str, str]:
    return {"X-API-Key": api_key}


@pytest.fixture(autouse=True)
def _prepare_settings() -> None:
    # Ensure tests run with email checks enabled
    backup = settings.allow_all_emails
    settings.allow_all_emails = False
    yield
    settings.allow_all_emails = backup


async def _add_allowed_email(email: str) -> None:
    async for session in get_db_session():
        session.add(AllowedEmail(email=email.lower()))
        await session.commit()
        break


async def _get_allowed_emails() -> list[str]:
    async for session in get_db_session():
        rows = await session.execute(select(AllowedEmail.email))
        return [row[0] for row in rows]


def test_register_fails_if_not_in_allowed_list(test_app: TestClient) -> None:
    asyncio.run(_add_allowed_email("allowed@example.com"))

    res = test_app.post(
        "/api/v1/auth/register",
        json={
            "openid_sub": "test-sub",
            "email": "not-allowed@example.com",
            "name": "Test",
        },
    )
    assert res.status_code == 403
    assert "not allowed" in res.text


def test_register_succeeds_if_in_allowed_list(test_app: TestClient) -> None:
    asyncio.run(_add_allowed_email("allowed@example.com"))

    res = test_app.post(
        "/api/v1/auth/register",
        json={
            "openid_sub": "test-sub-2",
            "email": "allowed@example.com",
            "name": "Test Allowed",
        },
    )
    assert res.status_code == 200


def test_register_fails_if_list_is_empty(test_app: TestClient) -> None:
    res = test_app.post(
        "/api/v1/auth/register",
        json={
            "openid_sub": "test-sub-3",
            "email": "any@example.com",
            "name": "Test Any",
        },
    )
    assert res.status_code == 403
    assert "not allowed" in res.text


def test_register_succeeds_if_allow_all_is_true(test_app: TestClient) -> None:
    settings.allow_all_emails = True
    res = test_app.post(
        "/api/v1/auth/register",
        json={
            "openid_sub": "test-sub-4",
            "email": "any@example.com",
            "name": "Test Any",
        },
    )
    assert res.status_code == 200


def test_admin_can_register_even_if_not_in_list(test_app: TestClient) -> None:
    # Add an email to the list to ensure it's not empty
    asyncio.run(_add_allowed_email("allowed@example.com"))
    admin_email = next(iter(settings.admin_emails))

    res = test_app.post(
        "/api/v1/auth/register",
        json={
            "openid_sub": "admin-sub-test",
            "email": admin_email,
            "name": "Test Admin",
        },
    )
    assert res.status_code == 200


def test_admin_can_manage_allowed_emails(test_app: TestClient, admin_key: str) -> None:
    # List should be empty initially
    res = test_app.get("/api/v1/admin/allowed-emails", headers=_headers(admin_key))
    assert res.status_code == 200
    assert res.json() == []

    # Add an email
    res = test_app.post(
        "/api/v1/admin/allowed-emails",
        headers=_headers(admin_key),
        json={"email": "new@example.com"},
    )
    assert res.status_code == 200

    # List should now contain the new email
    res = test_app.get("/api/v1/admin/allowed-emails", headers=_headers(admin_key))
    assert res.status_code == 200
    assert res.json() == ["new@example.com"]

    # Delete the email
    res = test_app.delete(
        "/api/v1/admin/allowed-emails/new@example.com", headers=_headers(admin_key)
    )
    assert res.status_code == 200

    # List should be empty again
    res = test_app.get("/api/v1/admin/allowed-emails", headers=_headers(admin_key))
    assert res.status_code == 200
    assert res.json() == []


def test_non_admin_cannot_manage_allowed_emails(test_app: TestClient, api_keys) -> None:
    key_a, _ = api_keys
    res = test_app.get("/api/v1/admin/allowed-emails", headers=_headers(key_a))
    assert res.status_code == 403


def test_reset_users_no_clears_allowed_emails(test_app: TestClient, admin_key: str) -> None:
    asyncio.run(_add_allowed_email("test@example.com"))
    allowed = asyncio.run(_get_allowed_emails())
    assert "test@example.com" in allowed

    res = test_app.post("/api/v1/admin/reset-users", headers=_headers(admin_key))
    assert res.status_code == 200

    allowed = asyncio.run(_get_allowed_emails())
    assert "test@example.com" in allowed


def test_startup_seeding_from_env(test_app: TestClient) -> None:
    from src.app.startup import seed_allowed_emails

    original_allowed = settings.allowed_emails_raw
    settings.allowed_emails_raw = "seed1@example.com,seed2@example.com"

    async def run_seed():
        async for session in get_db_session():
            await seed_allowed_emails(session)

    asyncio.run(run_seed())

    allowed = asyncio.run(_get_allowed_emails())
    assert "seed1@example.com" in allowed
    assert "seed2@example.com" in allowed

    settings.allowed_emails_raw = original_allowed
