from __future__ import annotations

from fastapi.testclient import TestClient


def _headers(api_key: str) -> dict[str, str]:
    return {"X-API-Key": api_key}


def place_order(
    client: TestClient,
    *,
    api_key: str,
    symbol: str,
    side: str,
    order_type: str,
    quantity: int,
    price: float | None = None,
) -> dict:
    res = client.post(
        "/api/v1/orders",
        headers=_headers(api_key),
        json={
            "symbol": symbol,
            "side": side,
            "order_type": order_type,
            "quantity": quantity,
            "price": price,
        },
    )
    assert res.status_code == 200, res.text
    return res.json()


def list_orders(
    client: TestClient,
    *,
    api_key: str,
    status: str | None = None,
    symbol: str | None = None,
) -> list[dict]:
    params = {}
    if status:
        params["status"] = status
    if symbol:
        params["symbol"] = symbol
    res = client.get("/api/v1/orders", headers=_headers(api_key), params=params)
    assert res.status_code == 200, res.text
    return res.json()["orders"]


def get_orderbook(client: TestClient, *, api_key: str, symbol: str) -> dict:
    res = client.get(f"/api/v1/orderbook/{symbol}", headers=_headers(api_key))
    assert res.status_code == 200
    return res.json()


def get_positions(client: TestClient, *, api_key: str) -> list[dict]:
    res = client.get("/api/v1/positions", headers=_headers(api_key))
    assert res.status_code == 200
    return res.json()["positions"]


def test_e2e_limit_match_price_priority(test_app: TestClient, api_keys: tuple[str, str]) -> None:
    key_a, key_b = api_keys
    symbol = "AAPL"

    # A: place bid 101 x 100
    place_order(
        test_app,
        api_key=key_a,
        symbol=symbol,
        side="buy",
        order_type="limit",
        quantity=100,
        price=101.0,
    )
    # B: place ask 100 x 80 -> should match at 101, qty 80
    resp = place_order(
        test_app,
        api_key=key_b,
        symbol=symbol,
        side="sell",
        order_type="limit",
        quantity=80,
        price=100.0,
    )
    assert resp["status"] in ("partial", "filled")

    # Orders for A should reflect partial fill (20 remaining)
    orders_a = list_orders(test_app, api_key=key_a, symbol=symbol)
    bid = next(o for o in orders_a if o["side"] == "buy")
    assert bid["filled_quantity"] == 80
    assert bid["status"] == "partial"

    # Orders for B should be fully filled
    orders_b = list_orders(test_app, api_key=key_b, symbol=symbol)
    ask_b = next(o for o in orders_b if o["side"] == "sell")
    assert ask_b["filled_quantity"] == 80
    assert ask_b["status"] == "filled"

    # Orderbook: bid level persists with remaining 20@101
    ob = get_orderbook(test_app, api_key=key_a, symbol=symbol)
    bids = ob["bids"]
    assert bids and bids[0]["price"] == 101.0 and bids[0]["quantity"] == 20


def test_e2e_market_buy_partial_cancel_remainder(
    test_app: TestClient, api_keys: tuple[str, str]
) -> None:
    key_a, key_b = api_keys
    symbol = "GOOGL"

    # Seed asks: B sells 50@100 and 100@101
    place_order(
        test_app,
        api_key=key_b,
        symbol=symbol,
        side="sell",
        order_type="limit",
        quantity=50,
        price=100.0,
    )
    place_order(
        test_app,
        api_key=key_b,
        symbol=symbol,
        side="sell",
        order_type="limit",
        quantity=100,
        price=101.0,
    )

    # A market buy 120 -> trades 50@100 and 70@101; remaining canceled
    resp = place_order(
        test_app,
        api_key=key_a,
        symbol=symbol,
        side="buy",
        order_type="market",
        quantity=120,
    )
    assert resp["status"] in ("cancelled", "filled")

    # Verify book remaining 30@101
    ob = get_orderbook(test_app, api_key=key_a, symbol=symbol)
    asks = ob["asks"]
    assert asks and asks[0]["price"] == 101.0 and asks[0]["quantity"] == 30


def test_e2e_stp_buy_cancels_self_then_trades_others(
    test_app: TestClient, api_keys: tuple[str, str]
) -> None:
    key_a, key_b = api_keys
    symbol = "AAPL"
    # A rests ask 40@150, B rests ask 60@150
    place_order(
        test_app,
        api_key=key_a,
        symbol=symbol,
        side="sell",
        order_type="limit",
        quantity=40,
        price=150.0,
    )
    place_order(
        test_app,
        api_key=key_b,
        symbol=symbol,
        side="sell",
        order_type="limit",
        quantity=60,
        price=150.0,
    )

    # A submits buy 70@151 -> STP cancels 40 of own ask, trades 60 with B, and rests 10 bid
    resp = place_order(
        test_app,
        api_key=key_a,
        symbol=symbol,
        side="buy",
        order_type="limit",
        quantity=70,
        price=151.0,
    )
    assert resp["status"] in ("partial", "pending")

    # A's original ask should be cancelled
    orders_a = list_orders(test_app, api_key=key_a, symbol=symbol)
    own_ask = next(o for o in orders_a if o["side"] == "sell")
    assert own_ask["status"] == "cancelled"
    assert own_ask["filled_quantity"] == own_ask["quantity"]

    # B's ask should be filled
    orders_b = list_orders(test_app, api_key=key_b, symbol=symbol)
    b_ask = next(o for o in orders_b if o["side"] == "sell")
    assert b_ask["status"] == "filled"

    # Orderbook should show A's remaining bid 10@151
    ob = get_orderbook(test_app, api_key=key_a, symbol=symbol)
    bids = ob["bids"]
    assert bids and bids[0]["price"] == 151.0 and bids[0]["quantity"] == 10


def test_e2e_stp_sell_cancels_self_then_trades_others(
    test_app: TestClient, api_keys: tuple[str, str]
) -> None:
    key_a, key_b = api_keys
    symbol = "AAPL"
    # A rests bid 30@149, B rests bid 50@149
    place_order(
        test_app,
        api_key=key_a,
        symbol=symbol,
        side="buy",
        order_type="limit",
        quantity=30,
        price=149.0,
    )
    place_order(
        test_app,
        api_key=key_b,
        symbol=symbol,
        side="buy",
        order_type="limit",
        quantity=50,
        price=149.0,
    )

    # A submits sell 70@148 -> STP cancels 30 of own bid, trades 50 with B, and rests 20 ask
    place_order(
        test_app,
        api_key=key_a,
        symbol=symbol,
        side="sell",
        order_type="limit",
        quantity=70,
        price=148.0,
    )

    # A's original bid should be cancelled
    orders_a = list_orders(test_app, api_key=key_a, symbol=symbol)
    own_bid = next(o for o in orders_a if o["side"] == "buy")
    assert own_bid["status"] in ("cancelled", "partial")

    # B's bid should be filled
    orders_b = list_orders(test_app, api_key=key_b, symbol=symbol)
    b_bid = next(o for o in orders_b if o["side"] == "buy")
    assert b_bid["status"] == "filled"


def test_e2e_no_duplicate_trades_after_consumed_order(
    test_app: TestClient, api_keys: tuple[str, str]
) -> None:
    key_a, key_b = api_keys
    symbol = "AAPL"
    # A rests ask 100@155
    place_order(
        test_app,
        api_key=key_a,
        symbol=symbol,
        side="sell",
        order_type="limit",
        quantity=100,
        price=155.0,
    )
    # B market buy 100 -> consumes it
    place_order(
        test_app,
        api_key=key_b,
        symbol=symbol,
        side="buy",
        order_type="market",
        quantity=100,
    )
    # B tries again -> no further trades
    place_order(
        test_app,
        api_key=key_b,
        symbol=symbol,
        side="buy",
        order_type="market",
        quantity=100,
    )
    # Check B's orders count; last should be cancelled (no liquidity)
    orders_b = list_orders(test_app, api_key=key_b, symbol=symbol)
    last = orders_b[-1]
    assert last["status"] == "cancelled"


def test_e2e_order_cancellation(test_app: TestClient, api_keys: tuple[str, str]) -> None:
    key_a, _ = api_keys
    symbol = "GOOGL"
    # A rests bid 140@10 then cancels
    order = place_order(
        test_app,
        api_key=key_a,
        symbol=symbol,
        side="buy",
        order_type="limit",
        quantity=10,
        price=140.0,
    )
    order_id = order["order_id"]
    res = test_app.delete(f"/api/v1/orders/{order_id}", headers=_headers(key_a))
    assert res.status_code == 200
    # Verify it no longer appears in open orders
    open_orders = test_app.get(
        "/api/v1/orders/open", headers=_headers(key_a), params={"symbol": symbol}
    )
    assert open_orders.status_code == 200
    assert len(open_orders.json()["orders"]) == 0


def test_e2e_positions_realized_pnl_on_partial_sell(
    test_app: TestClient, api_keys: tuple[str, str]
) -> None:
    key_a, key_b = api_keys
    symbol = "AAPL"
    # A buys 100@100, B sells 100@100
    place_order(
        test_app,
        api_key=key_a,
        symbol=symbol,
        side="buy",
        order_type="limit",
        quantity=100,
        price=100.0,
    )
    place_order(
        test_app,
        api_key=key_b,
        symbol=symbol,
        side="sell",
        order_type="limit",
        quantity=100,
        price=100.0,
    )

    # A sells 40@110 to B's bid
    place_order(
        test_app,
        api_key=key_b,
        symbol=symbol,
        side="buy",
        order_type="limit",
        quantity=100,
        price=110.0,
    )
    place_order(
        test_app,
        api_key=key_a,
        symbol=symbol,
        side="sell",
        order_type="limit",
        quantity=40,
        price=100.0,
    )

    positions = get_positions(test_app, api_key=key_a)
    pos = next(p for p in positions if p["symbol"] == symbol)
    assert pos["quantity"] == 60
    assert pos["average_price"] == 100.0
    assert pos["realized_pnl"] == 400.0
