from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient


def _headers(api_key: str) -> dict[str, str]:
    return {"X-API-Key": api_key}


def place(client: TestClient, key: str, **kwargs: Any) -> None:
    r = client.post("/api/v1/orders", headers=_headers(key), json=kwargs)
    assert r.status_code == 200


def test_websocket_subscription_and_initial_payload(
    test_app: TestClient, api_keys: tuple[str, str]
) -> None:
    key_a, key_b = api_keys

    # Create a simple book and trade so WS can stream initial data
    place(test_app, key_b, symbol="AAPL", side="sell", order_type="limit", quantity=5, price=101.0)
    place(test_app, key_a, symbol="AAPL", side="buy", order_type="limit", quantity=5, price=101.0)

    with test_app.websocket_connect("/ws/v1/market-data") as ws:
        # Subscribe to AAPL for orderbook+quotes+trades
        ws.send_json({
            "action": "subscribe",
            "symbols": ["AAPL"],
            "channels": ["orderbook", "quotes", "trades"],
        })

        got_ack = False
        got_ob = False
        # Receive a handful of frames to gather initial payloads
        for _ in range(10):
            msg = ws.receive_json()
            t = msg.get("type")
            if t == "subscription_ack":
                got_ack = True
            elif t == "orderbook" and msg.get("symbol") == "AAPL":
                got_ob = True
            elif t == "quote" and msg.get("symbol") == "AAPL":
                # basic shape
                assert "bid" in msg and "ask" in msg
            elif t == "trade" and msg.get("symbol") == "AAPL":
                # basic shape
                assert "price" in msg and "quantity" in msg
            if got_ack and got_ob:
                break

        assert got_ack, "Did not receive subscription_ack"
        assert got_ob, "Did not receive initial orderbook"
