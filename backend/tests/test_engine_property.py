from __future__ import annotations

import math
from typing import Literal

import hypothesis.strategies as st
from hypothesis import HealthCheck, given, settings

from src.exchange.engine import MatchingEngine, SimpleOrder


def best_bid_ask(engine: MatchingEngine) -> tuple[float | None, float | None]:
    bid = max((o.price for o in engine.bids if o.price is not None), default=None)
    ask = min((o.price for o in engine.asks if o.price is not None), default=None)
    return bid, ask


def is_sorted_books(engine: MatchingEngine) -> bool:
    # Bids descending, Asks ascending
    bprices = [o.price for o in engine.bids if o.price is not None]
    aprices = [o.price for o in engine.asks if o.price is not None]
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
        engine.add_order(SimpleOrder(**o.__dict__))

        # Invariants after each add
        # 1) No market orders rest in the book
        assert all(x.price is not None and not math.isnan(x.price) for x in engine.bids)
        assert all(x.price is not None and not math.isnan(x.price) for x in engine.asks)

        # 2) Books sorted properly
        assert is_sorted_books(engine)

        # 3) No crossing for different teams: if crossing remains, it should be self-cross only
        bid, ask = best_bid_ask(engine)
        if bid is not None and ask is not None and bid >= ask:
            # Allow crossing only if top-of-book is self-cross (STP cancel-passive)
            assert engine.bids and engine.asks
            assert engine.bids[0].team_id == engine.asks[0].team_id


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
    assert all(o.price is not None for o in engine.bids + engine.asks)


@settings(deadline=None, max_examples=50)
@given(
    n_buys=st.integers(min_value=1, max_value=25),
    n_sells=st.integers(min_value=1, max_value=25),
    ps=prices,
)
def test_orderbook_levels_sum(n_buys: int, n_sells: int, ps: float) -> None:
    # Sum of quantities at each price in get_orderbook_levels matches the actual book aggregation
    engine = MatchingEngine()
    for i in range(n_buys):
        engine.add_order(SimpleOrder(f"b{i}", "buy", 1 + (i % 3), ps + (i % 3), "A"))
    for j in range(n_sells):
        engine.add_order(SimpleOrder(f"s{j}", "sell", 1 + (j % 2), ps + (j % 3), "B"))

    bids, asks = engine.get_orderbook_levels(depth=10)
    # Re-aggregate directly
    agg_bids = {}
    for o in engine.bids:
        agg_bids[o.price] = agg_bids.get(o.price, 0) + o.quantity
    agg_asks = {}
    for o in engine.asks:
        agg_asks[o.price] = agg_asks.get(o.price, 0) + o.quantity

    for price_, qty_ in bids:
        assert qty_ == agg_bids.get(price_, 0)
    for price_, qty_ in asks:
        assert qty_ == agg_asks.get(price_, 0)
