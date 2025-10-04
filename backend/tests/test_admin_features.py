from __future__ import annotations

from fastapi.testclient import TestClient


def _headers(api_key: str) -> dict[str, str]:
    return {"X-API-Key": api_key}


def test_admin_list_users_enhanced(test_app: TestClient, admin_key: str,
                                   api_keys: tuple[str, str]) -> None:
    key_a, key_b = api_keys
    res = test_app.get("/api/v1/admin/users", headers=_headers(admin_key))
    assert res.status_code == 200
    users = res.json()
    assert len(users) >= 2
    user_a = next((u for u in users if u["email"] == "a@example.com"), None)
    assert user_a
    assert user_a["team_name"] is not None
    assert not user_a["is_disabled"]


def test_admin_user_disable_enable(test_app: TestClient, admin_key: str,
                                   api_keys: tuple[str, str]) -> None:
    key_a, _ = api_keys
    res = test_app.get("/api/v1/admin/users", headers=_headers(admin_key))
    user_a = next((u for u in res.json() if u["email"] == "a@example.com"), None)
    assert user_a

    # Disable
    res = test_app.post(f"/api/v1/admin/users/{user_a['id']}/disable", headers=_headers(admin_key))
    assert res.status_code == 200

    res = test_app.get("/api/v1/admin/users", headers=_headers(admin_key))
    user_a_updated = next((u for u in res.json() if u["email"] == "a@example.com"), None)
    assert user_a_updated["is_disabled"]

    # Enable
    res = test_app.post(f"/api/v1/admin/users/{user_a['id']}/enable", headers=_headers(admin_key))
    assert res.status_code == 200

    res = test_app.get("/api/v1/admin/users", headers=_headers(admin_key))
    user_a_updated = next((u for u in res.json() if u["email"] == "a@example.com"), None)
    assert not user_a_updated["is_disabled"]


def test_admin_delete_user(test_app: TestClient, admin_key: str, api_keys: tuple[str, str]) -> None:
    _, key_b = api_keys
    res = test_app.get("/api/v1/admin/users", headers=_headers(admin_key))
    user_b_id = next((u["id"] for u in res.json() if u["email"] == "b@example.com"), None)
    assert user_b_id

    res = test_app.delete(f"/api/v1/admin/users/{user_b_id}", headers=_headers(admin_key))
    assert res.status_code == 200

    res = test_app.get("/api/v1/admin/users", headers=_headers(admin_key))
    assert not any(u["email"] == "b@example.com" for u in res.json())


def test_admin_list_teams_enhanced(test_app: TestClient, admin_key: str,
                                   api_keys: tuple[str, str]) -> None:
    res = test_app.get("/api/v1/admin/teams", headers=_headers(admin_key))
    assert res.status_code == 200
    teams = res.json()
    assert len(teams) >= 2
    team_a = next((t for t in teams if "Alice" in t["name"]), None)
    assert team_a
    assert team_a["member_count"] == 1


def test_admin_get_team_details(test_app: TestClient, admin_key: str,
                                api_keys: tuple[str, str]) -> None:
    res = test_app.get("/api/v1/admin/teams", headers=_headers(admin_key))
    team_a = next((t for t in res.json() if "Alice" in t["name"]), None)
    assert team_a

    res = test_app.get(f"/api/v1/admin/teams/{team_a['id']}", headers=_headers(admin_key))
    assert res.status_code == 200
    details = res.json()
    assert details["name"] == team_a["name"]
    assert len(details["members"]) == 1
    assert details["members"][0]["email"] == "a@example.com"
    assert len(details["api_keys"]) > 0


def test_admin_team_api_key_disable_enable(test_app: TestClient, admin_key: str,
                                           api_keys: tuple[str, str]) -> None:
    res = test_app.get("/api/v1/admin/teams", headers=_headers(admin_key))
    team_a = next((t for t in res.json() if "Alice" in t["name"]), None)
    assert team_a

    res = test_app.get(f"/api/v1/admin/teams/{team_a['id']}", headers=_headers(admin_key))
    api_key_id = res.json()["api_keys"][0]["id"]

    # Disable
    res = test_app.post(f"/api/v1/admin/teams/api-keys/{api_key_id}/disable",
                        headers=_headers(admin_key))
    assert res.status_code == 200

    res = test_app.get(f"/api/v1/admin/teams/{team_a['id']}", headers=_headers(admin_key))
    assert not res.json()["api_keys"][0]["is_active"]

    # Enable
    res = test_app.post(f"/api/v1/admin/teams/api-keys/{api_key_id}/enable",
                        headers=_headers(admin_key))
    assert res.status_code == 200

    res = test_app.get(f"/api/v1/admin/teams/{team_a['id']}", headers=_headers(admin_key))
    assert res.json()["api_keys"][0]["is_active"]
