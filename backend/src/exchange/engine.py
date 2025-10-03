from __future__ import annotations

from dataclasses import dataclass


@dataclass
class SimpleOrder:
    order_id: str
    side: str  # "buy" or "sell"
    quantity: int
    price: float | None
    team_id: str


@dataclass
class SimpleTrade:
    buyer_order_id: str
    seller_order_id: str
    quantity: int
    price: float


@dataclass
class SimpleCancel:
    order_id: str
    quantity: int
    reason: str = "self_trade_prevention"


class MatchingEngine:
    def __init__(self) -> None:
        self.bids: list[SimpleOrder] = []
        self.asks: list[SimpleOrder] = []

    def reset(self) -> None:
        """Clear all in-memory book state."""
        self.bids.clear()
        self.asks.clear()

    def _insert_bid(self, order: SimpleOrder) -> None:
        if order.price is None:
            return
        order_price = float(order.price)
        idx = 0
        while idx < len(self.bids):
            existing_price = float(self.bids[idx].price or 0.0)
            if existing_price >= order_price:
                idx += 1
            else:
                break
        self.bids.insert(idx, order)

    def _insert_ask(self, order: SimpleOrder) -> None:
        if order.price is None:
            return
        order_price = float(order.price)
        idx = 0
        while idx < len(self.asks):
            existing_price = float(self.asks[idx].price or 0.0)
            if existing_price <= order_price:
                idx += 1
            else:
                break
        self.asks.insert(idx, order)

    def add_resting_order(self, order: SimpleOrder) -> None:
        """Insert a pre-existing limit order without attempting to match."""
        if order.side == "buy":
            self._insert_bid(order)
        else:
            self._insert_ask(order)

    def add_order(self, order: SimpleOrder) -> tuple[list[SimpleTrade], list[SimpleCancel]]:
        trades: list[SimpleTrade] = []
        cancels: list[SimpleCancel] = []
        if order.side == "buy":
            trades, cancels = self._match_buy(order)
            if order.quantity > 0 and order.price is not None:
                self._insert_bid(order)
        else:
            trades, cancels = self._match_sell(order)
            if order.quantity > 0 and order.price is not None:
                self._insert_ask(order)
        return trades, cancels

    def get_orderbook_levels(
        self, depth: int = 10
    ) -> tuple[list[tuple[float, int]], list[tuple[float, int]]]:
        bid_levels: dict[float, int] = {}
        ask_levels: dict[float, int] = {}
        for o in self.bids:
            if o.price is None:
                continue
            bid_levels[o.price] = bid_levels.get(o.price, 0) + o.quantity
        for o in self.asks:
            if o.price is None:
                continue
            ask_levels[o.price] = ask_levels.get(o.price, 0) + o.quantity
        bids_sorted = sorted(bid_levels.items(), key=lambda x: -x[0])[:depth]
        asks_sorted = sorted(ask_levels.items(), key=lambda x: x[0])[:depth]
        return bids_sorted, asks_sorted

    def remove_order(self, order_id: str) -> bool:
        for book in (self.bids, self.asks):
            for idx, existing in enumerate(book):
                if existing.order_id == order_id:
                    book.pop(idx)
                    return True
        return False

    def _match_buy(self, buy: SimpleOrder) -> tuple[list[SimpleTrade], list[SimpleCancel]]:
        trades: list[SimpleTrade] = []
        cancels: list[SimpleCancel] = []
        i = 0
        while i < len(self.asks) and buy.quantity > 0:
            ask = self.asks[i]
            if ask.price is None:
                i += 1
                continue
            if buy.price is not None and buy.price < ask.price:
                break
            if buy.price is None or buy.price >= ask.price:
                if ask.team_id == buy.team_id:
                    cancel_qty = min(buy.quantity, ask.quantity)
                    if cancel_qty > 0:
                        ask.quantity -= cancel_qty
                        cancels.append(SimpleCancel(order_id=ask.order_id, quantity=cancel_qty))
                        if ask.quantity == 0:
                            self.asks.pop(i)
                            continue
                else:
                    qty = min(buy.quantity, ask.quantity)
                    trades.append(
                        SimpleTrade(
                            buyer_order_id=buy.order_id,
                            seller_order_id=ask.order_id,
                            quantity=qty,
                            price=float(ask.price),
                        )
                    )
                    buy.quantity -= qty
                    ask.quantity -= qty
                    if ask.quantity == 0:
                        self.asks.pop(i)
                        continue
            i += 1
        return trades, cancels

    def _match_sell(self, sell: SimpleOrder) -> tuple[list[SimpleTrade], list[SimpleCancel]]:
        trades: list[SimpleTrade] = []
        cancels: list[SimpleCancel] = []
        i = 0
        while i < len(self.bids) and sell.quantity > 0:
            bid = self.bids[i]
            if bid.price is None:
                i += 1
                continue
            if sell.price is not None and sell.price > bid.price:
                break
            if sell.price is None or sell.price <= bid.price:
                if bid.team_id == sell.team_id:
                    cancel_qty = min(sell.quantity, bid.quantity)
                    if cancel_qty > 0:
                        bid.quantity -= cancel_qty
                        cancels.append(SimpleCancel(order_id=bid.order_id, quantity=cancel_qty))
                        if bid.quantity == 0:
                            self.bids.pop(i)
                            continue
                else:
                    qty = min(sell.quantity, bid.quantity)
                    trades.append(
                        SimpleTrade(
                            buyer_order_id=bid.order_id,
                            seller_order_id=sell.order_id,
                            quantity=qty,
                            price=float(bid.price),
                        )
                    )
                    sell.quantity -= qty
                    bid.quantity -= qty
                    if bid.quantity == 0:
                        self.bids.pop(i)
                        continue
            i += 1
        return trades, cancels
