from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient


def _headers(api_key: str) -> dict[str, str]:
    return {"X-API-Key": api_key}


def test_register_create_unique_team_names(test_app: TestClient, admin_key: str) -> None:
    # First user registers and creates default team
    test_app.post("/api/v1/admin/allowed-emails",
                  headers=_headers(admin_key),
                  json={"email": "u1@ex.com"})
    r1 = test_app.post(
        "/api/v1/auth/register",
        json={"openid_sub": "u1", "email": "u1@ex.com", "name": "Alex"},
    )
    assert r1.status_code == 200
    t1 = r1.json()["teams"][0]
    assert t1["name"].startswith("Alex's Team")

    # Second user requests the same team name explicitly; backend must ensure uniqueness
    test_app.post("/api/v1/admin/allowed-emails",
                  headers=_headers(admin_key),
                  json={"email": "u2@ex.com"})
    r2 = test_app.post(
        "/api/v1/auth/register",
        json={
            "openid_sub": "u2",
            "email": "u2@ex.com",
            "name": "Casey",
            "team_action": "create",
            "team_name": t1["name"],
        },
    )
    assert r2.status_code == 200
    t2 = r2.json()["teams"][0]
    assert t2["name"] != t1["name"]
    assert t2["name"].startswith(t1["name"]) or t2["name"].endswith(")")


def test_register_join_team_via_code(test_app: TestClient, admin_key: str) -> None:
    # Owner registers first
    test_app.post("/api/v1/admin/allowed-emails",
                  headers=_headers(admin_key),
                  json={"email": "owner@ex.com"})
    owner = test_app.post(
        "/api/v1/auth/register",
        json={"openid_sub": "owner", "email": "owner@ex.com", "name": "Owner"},
    )
    assert owner.status_code == 200

    # Admin list teams includes join_code
    teams = test_app.get("/api/v1/admin/teams", headers=_headers(admin_key))
    assert teams.status_code == 200
    payload: list[dict[str, Any]] = teams.json()
    # Find owner's team
    owner_team = next((t for t in payload if t["name"].startswith("Owner's Team")), None)
    assert owner_team and owner_team.get("join_code")
    code = owner_team["join_code"]

    # Joiner uses the join code to register and join as member
    test_app.post("/api/v1/admin/allowed-emails",
                  headers=_headers(admin_key),
                  json={"email": "joiner@ex.com"})
    joiner = test_app.post(
        "/api/v1/auth/register",
        json={
            "openid_sub": "joiner",
            "email": "joiner@ex.com",
            "name": "Joiner",
            "team_action": "join",
            "join_code": code,
        },
    )
    assert joiner.status_code == 200
    team_info = joiner.json()["teams"][0]
    assert team_info["name"].startswith("Owner's Team")
    assert team_info["role"] == "member"

    # Invalid code should 404
    test_app.post("/api/v1/admin/allowed-emails",
                  headers=_headers(admin_key),
                  json={"email": "bad@ex.com"})
    bad = test_app.post(
        "/api/v1/auth/register",
        json={
            "openid_sub": "bad",
            "email": "bad@ex.com",
            "name": "Bad",
            "team_action": "join",
            "join_code": "ZZZZXXXX",
        },
    )
    assert bad.status_code == 404
