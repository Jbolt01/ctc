from __future__ import annotations

import asyncio

from src.exchange.engine import MatchingEngine, SimpleCancel, SimpleOrder, SimpleTrade


def mk_order(order_id: str, side: str, qty: int, price: float | None, team: str) -> SimpleOrder:
    return SimpleOrder(order_id=order_id, side=side, quantity=qty, price=price, team_id=team)


def test_market_buy_partial_fill_and_cancel_remainder() -> None:
    engine = MatchingEngine()
    # Seed asks: 50@100 (team B), 100@101 (team C)
    ask1 = mk_order("S1", "sell", 50, 100.0, "B")
    ask2 = mk_order("S2", "sell", 100, 101.0, "C")
    engine.add_order(ask1)
    engine.add_order(ask2)

    # Market buy for 120 should take 50@100 and 70@101, leave 30@101
    trades, cancels = engine.add_order(mk_order("M1", "buy", 120, None, "A"))
    assert len(cancels) == 0
    assert len(trades) == 2
    assert trades[0].quantity == 50
    assert trades[0].price == 100.0
    assert trades[1].quantity == 70
    assert trades[1].price == 101.0

    # Incoming market order should not rest; asks should have remaining 30@101
    assert ask2.quantity == 30
    bids, asks = engine.get_orderbook_levels()
    assert bids == []
    assert asks == [(101.0, 30)]


def test_market_buy_insufficient_liquidity_cancels_remainder() -> None:
    engine = MatchingEngine()
    # Seed asks: 50@100 (team B)
    ask = mk_order("S3", "sell", 50, 100.0, "B")
    engine.add_order(ask)
    # Market buy for 80 should fill 50 and cancel remainder 30 (no rest)
    trades, cancels = engine.add_order(mk_order("M2", "buy", 80, None, "A"))
    assert len(cancels) == 0
    assert len(trades) == 1
    assert trades[0].quantity == 50
    assert trades[0].price == 100.0
    bids, asks = engine.get_orderbook_levels()
    assert bids == []
    assert asks == []


def test_stp_buy_cancels_self_then_trades_others_and_rests_remainder() -> None:
    engine = MatchingEngine()
    # Seed asks at same price: self 40@100 (team A), other 60@100 (team B)
    self_ask = mk_order("S4", "sell", 40, 100.0, "A")
    other_ask = mk_order("S5", "sell", 60, 100.0, "B")
    engine.add_order(self_ask)
    engine.add_order(other_ask)

    # Incoming buy limit 70@110 from team A
    trades, cancels = engine.add_order(mk_order("L1", "buy", 70, 110.0, "A"))

    # Should cancel self 40, then trade 60 with other, and rest 10 as bid@110
    assert len(cancels) == 1
    assert cancels[0].order_id == "S4"
    assert cancels[0].quantity == 40
    assert self_ask.quantity == 0

    assert len(trades) == 1
    assert trades[0].quantity == 60
    assert trades[0].price == 100.0
    assert other_ask.quantity == 0

    # Book state: no asks left; one bid with remaining 10 at 110 from L1
    bids, asks = engine.get_orderbook_levels()
    assert asks == []
    assert bids == [(110.0, 10)]


def test_stp_sell_cancels_self_then_trades_others_and_rests_remainder() -> None:
    engine = MatchingEngine()
    # Seed bids at same price: self 30@100 (team A), other 50@100 (team B)
    self_bid = mk_order("B1", "buy", 30, 100.0, "A")
    other_bid = mk_order("B2", "buy", 50, 100.0, "B")
    engine.add_order(self_bid)
    engine.add_order(other_bid)

    # Incoming sell limit 70@90 from team A
    trades, cancels = engine.add_order(mk_order("S6", "sell", 70, 90.0, "A"))

    # Should cancel self 30, then trade 50 with other, and rest 20 as ask@90
    assert len(cancels) == 1
    assert cancels[0].order_id == "B1"
    assert cancels[0].quantity == 30
    assert self_bid.quantity == 0

    assert len(trades) == 1
    assert trades[0].quantity == 50
    assert trades[0].price == 100.0
    assert other_bid.quantity == 0

    # Book state: no bids left; one ask with remaining 20 at 90 from S6
    bids, asks = engine.get_orderbook_levels()
    assert bids == []
    assert asks == [(90.0, 20)]


def test_stp_only_self_orders_market_buy_cancels_without_trade() -> None:
    engine = MatchingEngine()
    # Seed only self ask 100@100 (team A)
    ask = mk_order("S7", "sell", 100, 100.0, "A")
    engine.add_order(ask)
    # Incoming market buy 30 from same team should cancel 30 from S7 and not trade
    trades, cancels = engine.add_order(mk_order("M3", "buy", 30, None, "A"))

    assert len(trades) == 0
    assert len(cancels) == 1
    assert cancels[0].order_id == "S7"
    assert cancels[0].quantity == 30

    # Book state: S7 reduced to 70; no bids added (market orders don't rest)
    assert ask.quantity == 70
    bids, asks = engine.get_orderbook_levels()
    assert bids == []
    assert asks == [(100.0, 70)]


def test_stp_partial_cancel_leaves_remainder_and_trades_other_liquidity() -> None:
    engine = MatchingEngine()
    self_ask = mk_order("S8", "sell", 100, 100.0, "teamA")
    other_ask = mk_order("S9", "sell", 80, 101.0, "teamB")
    engine.add_order(self_ask)
    engine.add_order(other_ask)

    trades, cancels = engine.add_order(mk_order("L2", "buy", 30, 150.0, "teamA"))

    assert cancels == [SimpleCancel(order_id="S8", quantity=30)]
    assert self_ask.quantity == 70
    assert len(trades) == 1
    assert trades[0].buyer_order_id == "L2"
    assert trades[0].seller_order_id == "S9"
    assert trades[0].quantity == 30
    assert trades[0].price == 101.0

    bids, asks = engine.get_orderbook_levels()
    assert bids == []
    assert (100.0, 70) in asks
    assert (101.0, 50) in asks


def test_decimal_price_precision_is_preserved() -> None:
    engine = MatchingEngine()
    ask = mk_order("D1", "sell", 10, 101.123456, "A")
    engine.add_order(ask)
    trade_order = mk_order("D2", "buy", 10, 101.123456, "B")
    trades, cancels = engine.add_order(trade_order)

    assert cancels == []
    assert len(trades) == 1
    assert trades[0] == SimpleTrade(
        buyer_order_id="D2",
        seller_order_id="D1",
        quantity=10,
        price=101.123456,
    )


def test_remove_order_cancels_resting_liquidity() -> None:
    engine = MatchingEngine()
    order = mk_order("R1", "sell", 25, 105.0, "teamX")
    engine.add_order(order)
    assert engine.remove_order("R1")
    bids, asks = engine.get_orderbook_levels()
    assert bids == []
    assert asks == []


def test_manager_load_clears_and_prevents_duplicate_trade() -> None:
    # Reproduce scenario where the same resting order could be added twice to the
    # in-memory engine via load_open_orders before a market order consumes it.
    # The manager should clear and rebuild the book, so a second market order
    # should not be able to trade with the already-filled resting order.
    from src.exchange.manager import ExchangeManager

    class FakeRow:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class FakeScalarResult:
        def __init__(self, rows):
            self._rows = rows

        def all(self):  # mimic SQLAlchemy ScalarResult
            return self._rows

    class FakeResult:
        def __init__(self, rows):
            self._rows = rows

        def scalars(self):
            return FakeScalarResult(self._rows)

    class FakeSession:
        def __init__(self, rows):
            self.rows = rows

        async def execute(self, _stmt):
            return FakeResult(self.rows)

    symbol = "XYZ"
    manager = ExchangeManager()
    engine = manager._get_or_create_state(symbol).engine

    # Pre-existing in-memory ask from User A at 101 x 100
    engine.add_order(
        SimpleOrder(
            order_id="A1",
            side="sell",
            quantity=100,
            price=101.0,
            team_id="teamA",
        )
    )

    # First load: DB still shows A1 as open (pending)
    fake = FakeSession([
        FakeRow(
            id="A1",
            symbol=symbol,
            side="sell",
            team_id="teamA",
            order_type="limit",
            quantity=100,
            filled_quantity=0,
            price=101.0,
            status="pending",
        )
    ])

    async def run_scenario() -> None:
        await manager.load_open_orders(fake, symbol_code=symbol)

        # First buy market by User B for 100 hits A1 at 101
        trades1, _ = engine.add_order(
            SimpleOrder(order_id="B1", side="buy", quantity=100, price=None, team_id="teamB")
        )
        assert sum(t.quantity for t in trades1) == 100

        # After the trade, DB no longer has A1 open
        fake.rows = []
        await manager.load_open_orders(fake, symbol_code=symbol)

        # Second identical buy should not trade again (book rebuilt from DB)
        trades2, _ = engine.add_order(
            SimpleOrder(order_id="B2", side="buy", quantity=100, price=None, team_id="teamB")
        )
        assert len(trades2) == 0

    asyncio.run(run_scenario())
