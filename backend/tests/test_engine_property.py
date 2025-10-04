from __future__ import annotations

from dataclasses import replace
from typing import Literal

import hypothesis.strategies as st
from hypothesis import HealthCheck, given, settings

from src.exchange.engine import MatchingEngine, SimpleOrder


def best_bid_ask(engine: MatchingEngine) -> tuple[float | None, float | None]:
    bids, asks = engine.get_orderbook_levels(depth=1)
    bid = bids[0][0] if bids else None
    ask = asks[0][0] if asks else None
    return bid, ask


def is_sorted_books(engine: MatchingEngine) -> bool:
    # Bids descending, Asks ascending
    bprices = [price for price, _ in engine.get_orderbook_levels(depth=50)[0]]
    aprices = [price for price, _ in engine.get_orderbook_levels(depth=50)[1]]
    return bprices == sorted(bprices, reverse=True) and aprices == sorted(aprices)


team_ids = st.sampled_from(["A", "B", "C"])  # small set to exercise STP
sides = st.sampled_from(["buy", "sell"])  # Literal["buy","sell"]
quantities = st.integers(min_value=1, max_value=100)
prices = st.integers(min_value=90, max_value=110).map(float)
order_types = st.sampled_from(["limit", "market"])  # derive price None for market


def order_strategy():
    return st.builds(
        lambda oid, side, team, typ, qty, price: SimpleOrder(
            order_id=f"o{oid}",
            side=side,
            team_id=team,
            quantity=qty,
            price=(None if typ == "market" else price),
        ),
        oid=st.integers(min_value=1, max_value=1_000_000),
        side=sides,
        team=team_ids,
        typ=order_types,
        qty=quantities,
        price=prices,
    )


@settings(deadline=None, max_examples=100, suppress_health_check=[HealthCheck.filter_too_much])
@given(orders=st.lists(order_strategy(), min_size=1, max_size=30))
def test_engine_no_crossing_and_sorted(orders: list[SimpleOrder]) -> None:
    engine = MatchingEngine()
    for o in orders:
        engine.add_order(replace(o))

        # Invariants after each add
        # 1) No market orders rest in the book
        bids, asks = engine.get_orderbook_levels(depth=50)
        assert all(price > 0 for price, _ in bids)
        assert all(price > 0 for price, _ in asks)

        # 2) Books sorted properly
        assert is_sorted_books(engine)

        # 3) No crossing for different teams: if crossing remains, it should be self-cross only
        bid, ask = best_bid_ask(engine)
        if bid is not None and ask is not None:
            assert bid < ask


@settings(deadline=None, max_examples=200)
@given(
    side=st.sampled_from(["buy", "sell"]),
    team_a=team_ids,
    team_b=team_ids,
    qty1=quantities,
    qty2=quantities,
    p1=prices,
    p2=prices,
)
def test_two_order_fill_conservation(
    side: Literal["buy", "sell"],
    team_a: str,
    team_b: str,
    qty1: int,
    qty2: int,
    p1: float,
    p2: float,
) -> None:
    # Property: For two opposite limit orders, if prices cross, matched qty == min(q1, q2)
    engine = MatchingEngine()
    if side == "buy":
        first = SimpleOrder("a1", "buy", qty1, p1, team_a)
        second = SimpleOrder("b1", "sell", qty2, p2, team_b)
    else:
        first = SimpleOrder("a1", "sell", qty1, p1, team_a)
        second = SimpleOrder("b1", "buy", qty2, p2, team_b)

    trades1, _ = engine.add_order(first)
    trades2, _ = engine.add_order(second)
    all_trades = trades1 + trades2

    crossed = p1 >= p2 if first.side == "buy" else p2 >= p1

    if crossed:
        filled = sum(t.quantity for t in all_trades)
        # With STP, self-matching produces cancellations not trades
        if team_a == team_b:
            assert filled == 0
        else:
            assert filled == min(qty1, qty2)
    else:
        # Non-crossing -> no trades
        assert sum(t.quantity for t in all_trades) == 0


@settings(deadline=None, max_examples=50)
@given(
    team=team_ids,
    opp=team_ids,
    own_qty=quantities,
    mkt_qty=quantities,
    price=prices,
)
def test_stp_prevents_resting_self_cross(
    team: str, opp: str, own_qty: int, mkt_qty: int, price: float
) -> None:
    # Arrange: team has a resting ask, then sends a market buy from same team
    engine = MatchingEngine()
    engine.add_order(SimpleOrder("s1", "sell", own_qty, price, team))
    engine.add_order(SimpleOrder("b2", "buy", mkt_qty, None, team))

    # Assert: no crossing remains and market order didn't rest
    bid, ask = best_bid_ask(engine)
    if bid is not None and ask is not None:
        assert bid < ask
    # No market orders in book
    bids, asks = engine.get_orderbook_levels(depth=20)
    assert all(price > 0 for price, _ in bids + asks)


@settings(deadline=None, max_examples=50)
@given(
    n_buys=st.integers(min_value=1, max_value=25),
    n_sells=st.integers(min_value=1, max_value=25),
    ps=prices,
)
def test_orderbook_levels_sum(n_buys: int, n_sells: int, ps: float) -> None:
    # Sum of quantities at each price in get_orderbook_levels matches the actual book aggregation
    engine = MatchingEngine()
    buy_orders: list[SimpleOrder] = []
    sell_orders: list[SimpleOrder] = []
    for i in range(n_buys):
        order = SimpleOrder(f"b{i}", "buy", 1 + (i % 3), ps + (i % 3), "A")
        engine.add_order(order)
        if order.price is not None and order.quantity > 0:
            buy_orders.append(order)
    for j in range(n_sells):
        order = SimpleOrder(f"s{j}", "sell", 1 + (j % 2), ps + (j % 3), "B")
        engine.add_order(order)
        if order.price is not None and order.quantity > 0:
            sell_orders.append(order)

    bids, asks = engine.get_orderbook_levels(depth=50)

    agg_bids: dict[float, int] = {}
    for order in buy_orders:
        if order.price is None or order.quantity <= 0:
            continue
        agg_bids[order.price] = agg_bids.get(order.price, 0) + order.quantity

    agg_asks: dict[float, int] = {}
    for order in sell_orders:
        if order.price is None or order.quantity <= 0:
            continue
        agg_asks[order.price] = agg_asks.get(order.price, 0) + order.quantity

    for price_, qty_ in bids:
        assert qty_ == agg_bids.get(price_, 0)
    for price_, qty_ in asks:
        assert qty_ == agg_asks.get(price_, 0)
