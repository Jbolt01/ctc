from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field

import liquibook

PRICE_SCALE = 1_000_000


@dataclass(slots=True)
class SimpleOrder:
    order_id: str
    side: str  # "buy" or "sell"
    quantity: int
    price: float | None
    team_id: str


@dataclass(slots=True)
class SimpleTrade:
    buyer_order_id: str
    seller_order_id: str
    quantity: int
    price: float


@dataclass(slots=True)
class SimpleCancel:
    order_id: str
    quantity: int
    reason: str = "self_trade_prevention"


@dataclass(slots=True)
class _EventBuffer:
    trades: list[SimpleTrade] = field(default_factory=list)
    cancels: list[SimpleCancel] = field(default_factory=list)


@dataclass(slots=True)
class _OrderMeta:
    simple: SimpleOrder
    liquibook_order: liquibook.SimpleOrder
    team_id: str
    side: str
    price_int: int
    liquibook_id: int
    open_qty: int
    resting: bool = False
    requeued: bool = False

    @property
    def order_id(self) -> str:
        return self.simple.order_id


class _SimpleOrderBook(liquibook.DepthOrderBook):  # type: ignore[misc]
    def __init__(self, engine: "MatchingEngine") -> None:  # noqa: UP037
        super().__init__()
        self._engine = engine

    def on_fill(
        self,
        order: liquibook.SimpleOrder,
        matched_order: liquibook.SimpleOrder,
        quantity: int,
        price: int,
        inbound_order_filled: bool,
        matched_order_filled: bool,
    ) -> None:
        super().on_fill(
            order,
            matched_order,
            quantity,
            price,
            inbound_order_filled,
            matched_order_filled,
        )
        self._engine._handle_fill(order, matched_order, quantity, price)

    def on_cancel(self, order: liquibook.SimpleOrder, quantity: int) -> None:
        super().on_cancel(order, quantity)
        self._engine._handle_cancel(order, quantity)

    def on_replace(
        self,
        order: liquibook.SimpleOrder,
        current_qty: int,
        new_qty: int,
        new_price: int,
    ) -> None:
        super().on_replace(order, current_qty, new_qty, new_price)
        self._engine._handle_replace(order, current_qty, new_qty)

    def on_order_book_change(self) -> None:
        super().on_order_book_change()
        self._engine._handle_book_change()


def _price_to_int(price: float | None) -> int:
    if price is None:
        return 0
    return round(price * PRICE_SCALE)


def _price_to_float(price_int: int) -> float:
    return price_int / PRICE_SCALE


def _prices_cross(side: str, incoming: int, resting: int) -> bool:
    if incoming == 0:
        return True
    if side == "buy":
        return incoming >= resting
    return incoming <= resting


def _order_key(order: liquibook.SimpleOrder) -> int:
    return int(order.order_id_)


class MatchingEngine:
    def __init__(self) -> None:
        self._book = _SimpleOrderBook(self)
        self._active_buffer: _EventBuffer | None = None
        self._orders_by_id: dict[str, _OrderMeta] = {}
        self._orders_by_liquibook: dict[int, _OrderMeta] = {}
        self._team_orders: dict[str, dict[str, set[int]]] = defaultdict(
            lambda: {"buy": set(), "sell": set()}
        )
        self._suppress_cancel: set[str] = set()

    def reset(self) -> None:
        self._book = _SimpleOrderBook(self)
        self._active_buffer = None
        self._orders_by_id.clear()
        self._orders_by_liquibook.clear()
        self._team_orders.clear()
        self._suppress_cancel.clear()

    def add_resting_order(self, order: SimpleOrder) -> None:
        with self._collect_events():
            self._enter_order(order)

    def add_order(self, order: SimpleOrder) -> tuple[list[SimpleTrade], list[SimpleCancel]]:
        with self._collect_events() as buffer:
            requeue = self._self_trade_prevent(order)
            meta = self._enter_order(order)
            re_add_inbound = False
            inbound_remainder = meta.open_qty
            if requeue and inbound_remainder > 0:
                self._suppress_cancel.add(meta.order_id)
                with self._collect_events():
                    self._book.cancel(meta.liquibook_order)
                re_add_inbound = True
            elif order.price is None and inbound_remainder > 0:
                self._suppress_cancel.add(meta.order_id)
                with self._collect_events():
                    self._book.cancel(meta.liquibook_order)
                meta.open_qty = 0
            if requeue:
                self._requeue_orders(requeue)
            if re_add_inbound and inbound_remainder > 0 and order.price is not None:
                price_int = _price_to_int(order.price)
                liquibook_order = liquibook.SimpleOrder(
                    order.side == "buy",
                    price_int,
                    inbound_remainder,
                    0,
                    liquibook.oc_no_conditions,
                )
                meta.liquibook_order = liquibook_order
                meta.liquibook_id = _order_key(liquibook_order)
                meta.open_qty = inbound_remainder
                meta.simple.quantity = inbound_remainder
                meta.resting = True
                self._orders_by_id[meta.order_id] = meta
                self._orders_by_liquibook[meta.liquibook_id] = meta
                self._register(meta)
                self._book.add(liquibook_order)
        return buffer.trades, buffer.cancels

    def get_orderbook_levels(
        self, depth: int = 10
    ) -> tuple[list[tuple[float, int]], list[tuple[float, int]]]:
        book_depth = self._book.depth()
        bids: list[tuple[float, int]] = []
        for level in book_depth.get_bid_levels():
            qty = level.aggregate_qty()
            if qty > 0:
                bids.append((_price_to_float(level.price()), qty))
            if len(bids) >= depth:
                break
        asks: list[tuple[float, int]] = []
        for level in book_depth.get_ask_levels():
            qty = level.aggregate_qty()
            if qty > 0:
                asks.append((_price_to_float(level.price()), qty))
            if len(asks) >= depth:
                break
        return bids, asks

    def remove_order(self, order_id: str) -> bool:
        meta = self._orders_by_id.get(order_id)
        if meta is None:
            return False
        with self._collect_events():
            self._book.cancel(meta.liquibook_order)
        return True

    def _enter_order(self, order: SimpleOrder) -> _OrderMeta:
        price_int = _price_to_int(order.price)
        conditions = (
            liquibook.oc_immediate_or_cancel if order.price is None else liquibook.oc_no_conditions
        )
        liquibook_order = liquibook.SimpleOrder(
            order.side == "buy",
            price_int,
            order.quantity,
            0,
            conditions,
        )
        meta = _OrderMeta(
            simple=order,
            liquibook_order=liquibook_order,
            team_id=order.team_id,
            side=order.side,
            price_int=price_int,
            liquibook_id=_order_key(liquibook_order),
            open_qty=order.quantity,
        )
        self._orders_by_id[order.order_id] = meta
        self._orders_by_liquibook[_order_key(liquibook_order)] = meta
        self._book.add(liquibook_order)
        order.quantity = meta.open_qty
        if order.price is not None and meta.open_qty > 0:
            meta.resting = True
            self._register(meta)
        else:
            if meta.open_qty == 0:
                self._remove_meta(meta)
        return meta

    def _requeue_orders(self, requeue: list[tuple[_OrderMeta, int]]) -> None:
        for meta, remainder in requeue:
            if remainder <= 0:
                continue
            price_int = _price_to_int(meta.simple.price)
            liquibook_order = liquibook.SimpleOrder(
                meta.side == "buy",
                price_int,
                remainder,
                0,
                liquibook.oc_no_conditions,
            )
            meta.liquibook_order = liquibook_order
            meta.liquibook_id = _order_key(liquibook_order)
            meta.open_qty = remainder
            meta.simple.quantity = remainder
            meta.resting = True
            meta.requeued = True
            self._orders_by_id[meta.order_id] = meta
            self._orders_by_liquibook[meta.liquibook_id] = meta
            self._register(meta)
            self._book.add(liquibook_order)

    def _self_trade_prevent(self, incoming: SimpleOrder) -> list[tuple[_OrderMeta, int]]:
        team_set = self._team_orders.get(incoming.team_id)
        if not team_set:
            return []
        opposite_side = "sell" if incoming.side == "buy" else "buy"
        candidates = list(team_set[opposite_side])
        if not candidates:
            return []
        price_int = _price_to_int(incoming.price)
        remaining_qty = incoming.quantity
        requeue: list[tuple[_OrderMeta, int]] = []
        for liquibook_id in candidates:
            meta = self._orders_by_liquibook.get(liquibook_id)
            if meta is None:
                team_set[opposite_side].discard(liquibook_id)
                continue
            if not meta.resting:
                team_set[opposite_side].discard(liquibook_id)
                continue
            if not _prices_cross(incoming.side, price_int, meta.price_int):
                continue
            current_open = meta.open_qty
            if current_open <= 0:
                team_set[opposite_side].discard(liquibook_id)
                continue
            cancel_qty = min(remaining_qty, current_open)
            if cancel_qty <= 0:
                continue
            if cancel_qty >= current_open:
                with self._collect_events():
                    self._book.cancel(meta.liquibook_order)
            else:
                self._unregister(meta)
                with self._collect_events():
                    self._book.replace(
                        meta.liquibook_order,
                        -cancel_qty,
                        meta.liquibook_order.price(),
                    )
                remainder = current_open - cancel_qty
                meta.open_qty = remainder
                meta.simple.quantity = remainder
                meta.resting = False
                self._suppress_cancel.add(meta.order_id)
                with self._collect_events():
                    self._book.cancel(meta.liquibook_order)
                requeue.append((meta, remainder))
            remaining_qty -= cancel_qty
            if remaining_qty <= 0:
                break
        if incoming.price is None:
            incoming.quantity = max(remaining_qty, 0)
        return requeue

    def _register(self, meta: _OrderMeta) -> None:
        team_orders = self._team_orders[meta.team_id]
        team_orders[meta.side].add(meta.liquibook_id)

    def _unregister(self, meta: _OrderMeta) -> None:
        team_orders = self._team_orders.get(meta.team_id)
        if not team_orders:
            return
        team_orders[meta.side].discard(meta.liquibook_id)
        if not team_orders["buy"] and not team_orders["sell"]:
            self._team_orders.pop(meta.team_id, None)

    def _remove_meta(self, meta: _OrderMeta) -> None:
        self._orders_by_id.pop(meta.order_id, None)
        self._orders_by_liquibook.pop(meta.liquibook_id, None)
        if meta.resting:
            self._unregister(meta)

    def _lookup_meta(self, order: liquibook.SimpleOrder) -> _OrderMeta | None:
        return self._orders_by_liquibook.get(_order_key(order))

    def _handle_fill(
        self,
        order: liquibook.SimpleOrder,
        matched_order: liquibook.SimpleOrder,
        quantity: int,
        price_int: int,
    ) -> None:
        buffer = self._active_buffer
        if buffer is None:
            return
        inbound = self._lookup_meta(order)
        resting = self._lookup_meta(matched_order)
        if inbound is None or resting is None:
            return
        price = _price_to_float(price_int)
        if inbound.team_id == resting.team_id:
            self._handle_self_trade_fill(inbound, resting, quantity, price_int)
            return
        if inbound.side == "buy":
            buyer_meta, seller_meta = inbound, resting
        else:
            buyer_meta, seller_meta = resting, inbound
        buffer.trades.append(
            SimpleTrade(
                buyer_order_id=buyer_meta.order_id,
                seller_order_id=seller_meta.order_id,
                quantity=quantity,
                price=price,
            )
        )
        inbound.open_qty -= quantity
        resting.open_qty -= quantity
        inbound.simple.quantity = inbound.open_qty
        resting.simple.quantity = resting.open_qty
        if inbound.open_qty == 0:
            if inbound.resting:
                inbound.resting = False
                self._unregister(inbound)
            self._remove_meta(inbound)
        if resting.open_qty == 0:
            if resting.resting:
                resting.resting = False
                self._unregister(resting)
            self._remove_meta(resting)

    def _handle_cancel(self, order: liquibook.SimpleOrder, quantity: int) -> None:
        buffer = self._active_buffer
        meta = self._lookup_meta(order)
        if meta is None:
            return
        meta.open_qty = 0
        meta.simple.quantity = 0
        if meta.resting:
            meta.resting = False
            self._unregister(meta)
        self._remove_meta(meta)
        if meta.order_id in self._suppress_cancel:
            self._suppress_cancel.discard(meta.order_id)
        elif buffer is not None and quantity > 0:
            buffer.cancels.append(SimpleCancel(order_id=meta.order_id, quantity=quantity))

    def _handle_replace(self, order: liquibook.SimpleOrder, current_qty: int, new_qty: int) -> None:
        meta = self._lookup_meta(order)
        if meta is None:
            return
        meta.open_qty = new_qty
        meta.simple.quantity = new_qty
        meta.price_int = order.price()
        if meta.simple.price is not None:
            meta.simple.price = _price_to_float(meta.price_int)
        meta.resting = new_qty > 0 and meta.simple.price is not None
        if meta.resting:
            self._register(meta)
        else:
            self._unregister(meta)
        cancel_qty = current_qty - new_qty
        buffer = self._active_buffer
        if buffer is not None and cancel_qty > 0:
            buffer.cancels.append(SimpleCancel(order_id=meta.order_id, quantity=cancel_qty))

    def _handle_book_change(self) -> None:
        # Depth updates are pulled directly from the Liquibook depth tracker
        # whenever they are requested, so no additional bookkeeping is needed.
        return

    def _handle_self_trade_fill(
        self,
        inbound_meta: _OrderMeta,
        resting_meta: _OrderMeta,
        quantity: int,
        price_int: int,
    ) -> None:
        buffer = self._active_buffer
        passive_meta = resting_meta if resting_meta.requeued else inbound_meta
        active_meta = inbound_meta if passive_meta is resting_meta else resting_meta
        if buffer is not None:
            buffer.cancels.append(
                SimpleCancel(order_id=passive_meta.order_id, quantity=quantity)
            )
        passive_meta.requeued = False
        self._book.replace(
            passive_meta.liquibook_order,
            quantity,
            passive_meta.liquibook_order.price(),
        )
        self._book.replace(
            active_meta.liquibook_order,
            quantity,
            active_meta.liquibook_order.price(),
        )
        passive_meta.open_qty += quantity
        active_meta.open_qty += quantity
        passive_meta.simple.quantity = passive_meta.open_qty
        active_meta.simple.quantity = active_meta.open_qty

    @contextmanager
    def _collect_events(self) -> Iterator[_EventBuffer]:
        if self._active_buffer is not None:
            yield self._active_buffer
            return
        buffer = _EventBuffer()
        self._active_buffer = buffer
        try:
            yield buffer
        finally:
            self._active_buffer = None
