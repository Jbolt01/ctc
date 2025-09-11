from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta

from fastapi.testclient import TestClient


def _headers(api_key: str) -> dict[str, str]:
    return {"X-API-Key": api_key}


def test_symbols_and_orderbook_empty_then_depth(test_app: TestClient, api_keys: tuple[str, str]) -> None:
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


def test_orders_open_filter_and_market_trades(test_app: TestClient, api_keys: tuple[str, str]) -> None:
    key_a, key_b = api_keys
    # Seed opposite orders to create a trade
    # B places bid
    rb = test_app.post(
        "/api/v1/orders",
        headers=_headers(key_b),
        json={"symbol": "AAPL", "side": "buy", "order_type": "limit", "quantity": 10, "price": 100.0},
    )
    assert rb.status_code == 200
    # A sells into it
    ra = test_app.post(
        "/api/v1/orders",
        headers=_headers(key_a),
        json={"symbol": "AAPL", "side": "sell", "order_type": "limit", "quantity": 10, "price": 100.0},
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


def test_auth_create_team_via_api_key(test_app: TestClient) -> None:
    # Register a user to obtain api key
    reg = test_app.post(
        "/api/v1/auth/register",
        json={"openid_sub": "sub-admin", "email": "admin@example.com", "name": "Admin"},
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

