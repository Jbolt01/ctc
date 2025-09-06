from __future__ import annotations

from src.exchange.engine import MatchingEngine, SimpleOrder


def mk_order(order_id: str, side: str, qty: int, price: float | None, team: str) -> SimpleOrder:
    return SimpleOrder(order_id=order_id, side=side, quantity=qty, price=price, team_id=team)


def test_market_buy_partial_fill_and_cancel_remainder() -> None:
    engine = MatchingEngine()
    # Seed asks: 50@100 (team B), 100@101 (team C)
    engine.add_order(mk_order("S1", "sell", 50, 100.0, "B"))
    engine.add_order(mk_order("S2", "sell", 100, 101.0, "C"))

    # Market buy for 120 should take 50@100 and 70@101, leave 30@101
    trades, cancels = engine.add_order(mk_order("M1", "buy", 120, None, "A"))
    assert len(cancels) == 0
    assert len(trades) == 2
    assert trades[0].quantity == 50
    assert trades[0].price == 100.0
    assert trades[1].quantity == 70
    assert trades[1].price == 101.0

    # Incoming market order should not rest; asks should have remaining 30@101
    assert len(engine.bids) == 0
    assert len(engine.asks) == 1
    assert engine.asks[0].order_id == "S2"
    assert engine.asks[0].quantity == 30


def test_market_buy_insufficient_liquidity_cancels_remainder() -> None:
    engine = MatchingEngine()
    # Seed asks: 50@100 (team B)
    engine.add_order(mk_order("S3", "sell", 50, 100.0, "B"))
    # Market buy for 80 should fill 50 and cancel remainder 30 (no rest)
    trades, cancels = engine.add_order(mk_order("M2", "buy", 80, None, "A"))
    assert len(cancels) == 0
    assert len(trades) == 1
    assert trades[0].quantity == 50
    assert trades[0].price == 100.0
    assert len(engine.asks) == 0
    assert len(engine.bids) == 0


def test_stp_buy_cancels_self_then_trades_others_and_rests_remainder() -> None:
    engine = MatchingEngine()
    # Seed asks at same price: self 40@100 (team A), other 60@100 (team B)
    engine.add_order(mk_order("S4", "sell", 40, 100.0, "A"))
    engine.add_order(mk_order("S5", "sell", 60, 100.0, "B"))

    # Incoming buy limit 70@110 from team A
    trades, cancels = engine.add_order(mk_order("L1", "buy", 70, 110.0, "A"))

    # Should cancel self 40, then trade 60 with other, and rest 10 as bid@110
    assert len(cancels) == 1
    assert cancels[0].order_id == "S4"
    assert cancels[0].quantity == 40

    assert len(trades) == 1
    assert trades[0].quantity == 60
    assert trades[0].price == 100.0

    # Book state: no asks left; one bid with remaining 10 at 110 from L1
    assert len(engine.asks) == 0
    assert len(engine.bids) == 1
    assert engine.bids[0].order_id == "L1"
    assert engine.bids[0].quantity == 10
    assert engine.bids[0].price == 110.0


def test_stp_sell_cancels_self_then_trades_others_and_rests_remainder() -> None:
    engine = MatchingEngine()
    # Seed bids at same price: self 30@100 (team A), other 50@100 (team B)
    engine.add_order(mk_order("B1", "buy", 30, 100.0, "A"))
    engine.add_order(mk_order("B2", "buy", 50, 100.0, "B"))

    # Incoming sell limit 70@90 from team A
    trades, cancels = engine.add_order(mk_order("S6", "sell", 70, 90.0, "A"))

    # Should cancel self 30, then trade 50 with other, and rest 20 as ask@90
    assert len(cancels) == 1
    assert cancels[0].order_id == "B1"
    assert cancels[0].quantity == 30

    assert len(trades) == 1
    assert trades[0].quantity == 50
    assert trades[0].price == 100.0

    # Book state: no bids left; one ask with remaining 20 at 90 from S6
    assert len(engine.bids) == 0
    assert len(engine.asks) == 1
    assert engine.asks[0].order_id == "S6"
    assert engine.asks[0].quantity == 20
    assert engine.asks[0].price == 90.0


def test_stp_only_self_orders_market_buy_cancels_without_trade() -> None:
    engine = MatchingEngine()
    # Seed only self ask 100@100 (team A)
    engine.add_order(mk_order("S7", "sell", 100, 100.0, "A"))
    # Incoming market buy 30 from same team should cancel 30 from S7 and not trade
    trades, cancels = engine.add_order(mk_order("M3", "buy", 30, None, "A"))

    assert len(trades) == 0
    assert len(cancels) == 1
    assert cancels[0].order_id == "S7"
    assert cancels[0].quantity == 30

    # Book state: S7 reduced to 70; no bids added (market orders don't rest)
    assert len(engine.bids) == 0
    assert len(engine.asks) == 1
    assert engine.asks[0].order_id == "S7"
    assert engine.asks[0].quantity == 70
