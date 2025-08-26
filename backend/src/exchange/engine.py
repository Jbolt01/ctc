from __future__ import annotations

from dataclasses import dataclass


@dataclass
class SimpleOrder:
    order_id: str
    side: str  # "buy" or "sell"
    quantity: int
    price: float | None


@dataclass
class SimpleTrade:
    buyer_order_id: str
    seller_order_id: str
    quantity: int
    price: float


class MatchingEngine:
    def __init__(self) -> None:
        self.bids: list[SimpleOrder] = []
        self.asks: list[SimpleOrder] = []

    def _sort_books(self) -> None:
        # Bids: highest price first; Asks: lowest price first
        self.bids.sort(key=lambda o: (-(o.price or 0.0)))
        self.asks.sort(key=lambda o: (o.price or 0.0))

    def add_order(self, order: SimpleOrder) -> list[SimpleTrade]:
        trades: list[SimpleTrade] = []
        if order.side == "buy":
            trades = self._match_buy(order)
            if order.quantity > 0:
                self.bids.append(order)
        else:
            trades = self._match_sell(order)
            if order.quantity > 0:
                self.asks.append(order)
        self._sort_books()
        return trades

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

    def _match_buy(self, buy: SimpleOrder) -> list[SimpleTrade]:
        trades: list[SimpleTrade] = []
        # naive loop over asks
        i = 0
        while i < len(self.asks) and buy.quantity > 0:
            ask = self.asks[i]
            if ask.price is None:
                i += 1
                continue
            # Price-time priority simplified: price only
            if buy.price is None or buy.price >= ask.price:
                qty = min(buy.quantity, ask.quantity)
                trades.append(
                    SimpleTrade(
                        buyer_order_id=buy.order_id,
                        seller_order_id=ask.order_id,
                        quantity=qty,
                        price=ask.price,
                    )
                )
                buy.quantity -= qty
                ask.quantity -= qty
                if ask.quantity == 0:
                    self.asks.pop(i)
                    continue
            i += 1
        return trades

    def _match_sell(self, sell: SimpleOrder) -> list[SimpleTrade]:
        trades: list[SimpleTrade] = []
        i = 0
        while i < len(self.bids) and sell.quantity > 0:
            bid = self.bids[i]
            if bid.price is None:
                i += 1
                continue
            if sell.price is None or sell.price <= bid.price:
                qty = min(sell.quantity, bid.quantity)
                trades.append(
                    SimpleTrade(
                        buyer_order_id=bid.order_id,
                        seller_order_id=sell.order_id,
                        quantity=qty,
                        price=bid.price,
                    )
                )
                sell.quantity -= qty
                bid.quantity -= qty
                if bid.quantity == 0:
                    self.bids.pop(i)
                    continue
            i += 1
        return trades

