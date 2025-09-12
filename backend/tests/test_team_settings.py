from __future__ import annotations

from fastapi.testclient import TestClient


def _headers(api_key: str) -> dict[str, str]:
    return {"X-API-Key": api_key}


def test_team_settings_owner_and_member_controls(test_app: TestClient) -> None:
    # Owner registers and gets team
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
