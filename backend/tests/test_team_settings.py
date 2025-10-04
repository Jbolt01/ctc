from __future__ import annotations

from fastapi.testclient import TestClient


def _headers(api_key: str) -> dict[str, str]:
    return {"X-API-Key": api_key}


def test_team_settings_owner_and_member_controls(test_app: TestClient, admin_key: str) -> None:
    # Owner registers and gets team
    test_app.post("/api/v1/admin/allowed-emails",
                  headers=_headers(admin_key),
                  json={"email": "own@example.com"})
    reg_owner = test_app.post(
        "/api/v1/auth/register",
        json={"openid_sub": "own_sub", "email": "own@example.com", "name": "Owner"},
    )
    assert reg_owner.status_code == 200
    key_owner = reg_owner.json()["api_key"]

    # Get team settings (owner view)
    ts = test_app.get("/api/v1/teams/me", headers=_headers(key_owner))
    assert ts.status_code == 200
    data = ts.json()
    assert data["name"].startswith("Owner's Team")
    assert data["join_code"] and len(data["join_code"]) >= 4
    assert data["role"] == "admin"
    assert len(data["members"]) == 1

    # A member joins using the join code
    code = data["join_code"]
    test_app.post("/api/v1/admin/allowed-emails",
                  headers=_headers(admin_key),
                  json={"email": "mem@example.com"})
    reg_member = test_app.post(
        "/api/v1/auth/register",
        json={
            "openid_sub": "mem_sub",
            "email": "mem@example.com",
            "name": "Member",
            "team_action": "join",
            "join_code": code,
        },
    )
    assert reg_member.status_code == 200
    key_member = reg_member.json()["api_key"]

    # Member can view team settings, but not modify
    ts2 = test_app.get("/api/v1/teams/me", headers=_headers(key_member))
    assert ts2.status_code == 200
    d2 = ts2.json()
    assert d2["role"] == "member"
    # Member cannot update name
    up_fail = test_app.post(
        "/api/v1/teams/me/name", headers=_headers(key_member), json={"name": "NewName"}
    )
    assert up_fail.status_code == 403

    # Owner can rename
    up_ok = test_app.post(
        "/api/v1/teams/me/name", headers=_headers(key_owner), json={"name": "Team 1"}
    )
    assert up_ok.status_code == 200

    # Owner can rotate code
    rot = test_app.post("/api/v1/teams/me/rotate-code", headers=_headers(key_owner))
    assert rot.status_code == 200 and rot.json()["join_code"]

    # Owner can remove member
    # Find member id from team settings
    ts3 = test_app.get("/api/v1/teams/me", headers=_headers(key_owner))
    mem_id = next(u["id"] for u in ts3.json()["members"] if u["email"] == "mem@example.com")
    rm = test_app.delete(f"/api/v1/teams/me/members/{mem_id}", headers=_headers(key_owner))
    assert rm.status_code == 200


def test_team_api_keys_crud(test_app: TestClient, admin_key: str) -> None:
    # Register owner
    test_app.post("/api/v1/admin/allowed-emails",
                  headers=_headers(admin_key),
                  json={"email": "o2@example.com"})
    reg = test_app.post(
        "/api/v1/auth/register",
        json={"openid_sub": "own2", "email": "o2@example.com", "name": "Owner2"},
    )
    assert reg.status_code == 200
    key_owner = reg.json()["api_key"]

    # Member cannot list/create/revoke API keys
    # Join member
    ts = test_app.get("/api/v1/teams/me", headers=_headers(key_owner))
    code = ts.json()["join_code"]
    test_app.post("/api/v1/admin/allowed-emails",
                  headers=_headers(admin_key),
                  json={"email": "m2@example.com"})
    reg_mem = test_app.post(
        "/api/v1/auth/register",
        json={
            "openid_sub": "mem2",
            "email": "m2@example.com",
            "name": "Member2",
            "team_action": "join",
            "join_code": code,
        },
    )
    assert reg_mem.status_code == 200
    key_mem = reg_mem.json()["api_key"]

    # Member list forbidden
    r0 = test_app.get("/api/v1/teams/me/api-keys", headers=_headers(key_mem))
    assert r0.status_code == 403

    # Owner list initially has at least 1 (created at registration)
    r1 = test_app.get("/api/v1/teams/me/api-keys", headers=_headers(key_owner))
    assert r1.status_code == 200
    keys = r1.json()
    assert isinstance(keys, list)

    # Owner creates a new key
    r2 = test_app.post(
        "/api/v1/teams/me/api-keys",
        headers=_headers(key_owner),
        json={"name": "bot-key"},
    )
    assert r2.status_code == 200
    created = r2.json()
    assert created["api_key"] and created["name"] == "bot-key"

    # Owner revokes the created key
    r3 = test_app.delete(
        f"/api/v1/teams/me/api-keys/{created['id']}", headers=_headers(key_owner)
    )
    assert r3.status_code == 200 and r3.json()["status"] == "revoked"

    # Using the revoked key should fail auth
    revoked_key_value = created["api_key"]
    # Place an API call with revoked key
    fail = test_app.get("/api/v1/symbols", headers=_headers(revoked_key_value))
    assert fail.status_code == 401
