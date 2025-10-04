from __future__ import annotations

from fastapi.testclient import TestClient


def _headers(api_key: str) -> dict[str, str]:
    return {"X-API-Key": api_key}


def test_symbols_and_orderbook_empty_then_depth(
    test_app: TestClient, api_keys: tuple[str, str]
) -> None:
    key_a, _ = api_keys
    # Symbols should include seeded ones
    r = test_app.get("/api/v1/symbols", headers=_headers(key_a))
    assert r.status_code == 200
    symbols = {s["symbol"] for s in r.json()["symbols"]}
    assert {"AAPL", "GOOGL"}.issubset(symbols)

    # Orderbook for a fresh symbol should be empty levels with proper shape
    r2 = test_app.get("/api/v1/orderbook/AAPL", headers=_headers(key_a), params={"depth": 5})
    assert r2.status_code == 200
    data = r2.json()
    assert data["symbol"] == "AAPL"
    assert isinstance(data["last_update"], str)
    assert isinstance(data["bids"], list) and isinstance(data["asks"], list)


def test_orders_open_filter_and_market_trades(
    test_app: TestClient, api_keys: tuple[str, str]
) -> None:
    key_a, key_b = api_keys
    # Seed opposite orders to create a trade
    # B places bid
    rb = test_app.post(
        "/api/v1/orders",
        headers=_headers(key_b),
        json={
            "symbol": "AAPL",
            "side": "buy",
            "order_type": "limit",
            "quantity": 10,
            "price": 100.0,
        },
    )
    assert rb.status_code == 200
    # A sells into it
    ra = test_app.post(
        "/api/v1/orders",
        headers=_headers(key_a),
        json={
            "symbol": "AAPL",
            "side": "sell",
            "order_type": "limit",
            "quantity": 10,
            "price": 100.0,
        },
    )
    assert ra.status_code == 200

    # Open orders should be empty for AAPL
    ro = test_app.get("/api/v1/orders/open", headers=_headers(key_a), params={"symbol": "AAPL"})
    assert ro.status_code == 200
    assert ro.json()["orders"] == []

    # Market trades endpoint should show at least this trade
    rm = test_app.get("/api/v1/trades/market", headers=_headers(key_a), params={"symbol": "AAPL"})
    assert rm.status_code == 200
    trades = rm.json()["trades"]
    assert any(t["symbol"] == "AAPL" and t["price"] == 100.0 for t in trades)


def test_auth_create_team_via_api_key(test_app: TestClient, admin_key: str) -> None:
    # Register a user to obtain api key
    email = "another-admin@example.com"
    res = test_app.post("/api/v1/admin/allowed-emails",
                        headers=_headers(admin_key),
                        json={"email": email})
    assert res.status_code == 200
    reg = test_app.post(
        "/api/v1/auth/register",
        json={"openid_sub": "sub-another-admin", "email": email, "name": "Another Admin"},
    )
    assert reg.status_code == 200
    api_key = reg.json()["api_key"]

    # Create a team via /auth/teams using that API key
    r = test_app.post(
        "/api/v1/auth/teams",
        headers=_headers(api_key),
        json={"name": "My Team"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["id"] and data["role"] == "admin" and data["name"] == "My Team"


def test_place_order_does_not_reload_book(
    test_app: TestClient,
    api_keys: tuple[str, str],
    monkeypatch,
) -> None:
    key_a, _ = api_keys

    from src.app import main as app_mod

    call_count = 0
    original = app_mod._exchange.load_open_orders

    async def _tracking_load(session, symbol_code=None, **kwargs):  # type: ignore[override]
        nonlocal call_count
        call_count += 1
        await original(session, symbol_code=symbol_code, **kwargs)

    monkeypatch.setattr(app_mod._exchange, "load_open_orders", _tracking_load)

    response = test_app.post(
        "/api/v1/orders",
        headers=_headers(key_a),
        json={
            "symbol": "AAPL",
            "side": "buy",
            "order_type": "limit",
            "quantity": 5,
            "price": 120.0,
        },
    )
    assert response.status_code == 200

    # Second order placement should reuse cached book without triggering another load
    response_two = test_app.post(
        "/api/v1/orders",
        headers=_headers(key_a),
        json={
            "symbol": "AAPL",
            "side": "buy",
            "order_type": "limit",
            "quantity": 3,
            "price": 119.5,
        },
    )
    assert response_two.status_code == 200

    assert call_count == 1
