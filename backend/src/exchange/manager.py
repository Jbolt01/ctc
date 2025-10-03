from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import inspect, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import Order as OrderModel
from src.db.models import Position as PositionModel
from src.db.models import Symbol as SymbolModel
from src.db.models import Trade as TradeModel
from src.exchange.engine import MatchingEngine, SimpleOrder


@dataclass
class OrderBookState:
    engine: MatchingEngine
    loaded: bool = False
    simple_orders: dict[str, SimpleOrder] = field(default_factory=dict)
    order_models: dict[str, OrderModel] = field(default_factory=dict)


class ExchangeManager:
    def __init__(self) -> None:
        self._books: dict[str, OrderBookState] = {}

    def _get_or_create_state(self, symbol_code: str) -> OrderBookState:
        state = self._books.get(symbol_code)
        if state is None:
            state = OrderBookState(engine=MatchingEngine())
            self._books[symbol_code] = state
        return state

    async def ensure_symbol_loaded(
        self,
        session: AsyncSession,
        symbol_code: str,
        *,
        exclude_order_ids: set[str] | None = None,
    ) -> OrderBookState:
        state = self._get_or_create_state(symbol_code)
        if not state.loaded:
            await self.load_open_orders(
                session, symbol_code=symbol_code, exclude_order_ids=exclude_order_ids
            )
        elif exclude_order_ids:
            for order_id in exclude_order_ids:
                state.engine.remove_order(order_id)
                state.simple_orders.pop(order_id, None)
                state.order_models.pop(order_id, None)
        return state

    def get_orderbook_levels(
        self, symbol_code: str, depth: int = 50
    ) -> tuple[list[tuple[float, int]], list[tuple[float, int]]]:
        state = self._books.get(symbol_code)
        if state is None or not state.loaded:
            return [], []
        return state.engine.get_orderbook_levels(depth)

    async def load_open_orders(
        self,
        session: AsyncSession,
        symbol_code: str | None = None,
        *,
        exclude_order_ids: set[str] | None = None,
    ) -> None:
        if symbol_code is not None:
            state = self._get_or_create_state(symbol_code)
            orders = (
                await session.execute(
                    select(OrderModel)
                    .join(SymbolModel, SymbolModel.id == OrderModel.symbol_id)
                    .where(
                        SymbolModel.symbol == symbol_code,
                        OrderModel.status.in_(["pending", "partial"]),
                    )
                    .order_by(OrderModel.created_at, OrderModel.id)
                )
            ).scalars().all()
            self._populate_state_from_orders(state, orders, exclude_order_ids)
            return

        result = await session.execute(
            select(OrderModel, SymbolModel.symbol)
            .join(SymbolModel, SymbolModel.id == OrderModel.symbol_id)
            .where(OrderModel.status.in_(["pending", "partial"]))
            .order_by(SymbolModel.symbol, OrderModel.created_at, OrderModel.id)
        )
        rows = result.all()
        grouped: dict[str, list[OrderModel]] = {}
        for order_model, sym_code in rows:
            grouped.setdefault(sym_code, []).append(order_model)

        symbols_to_refresh = set(self._books.keys()) | set(grouped.keys())
        for sym in symbols_to_refresh:
            state = self._get_or_create_state(sym)
            orders = grouped.get(sym, [])
            self._populate_state_from_orders(state, orders, exclude_order_ids)

    def _populate_state_from_orders(
        self,
        state: OrderBookState,
        orders: Iterable[OrderModel],
        exclude_order_ids: set[str] | None = None,
    ) -> None:
        state.engine.reset()
        state.simple_orders.clear()
        state.order_models.clear()
        for order_model in orders:
            if exclude_order_ids and str(order_model.id) in exclude_order_ids:
                continue
            remaining = order_model.quantity - order_model.filled_quantity
            if remaining <= 0:
                continue
            if order_model.order_type == "market" or order_model.price is None:
                continue
            simple = self._simple_from_model(order_model, remaining)
            state.simple_orders[simple.order_id] = simple
            state.order_models[simple.order_id] = order_model
            state.engine.add_resting_order(simple)
        state.loaded = True

    def _simple_from_model(self, order: OrderModel, remaining: int) -> SimpleOrder:
        return SimpleOrder(
            order_id=str(order.id),
            side=order.side,
            quantity=remaining,
            price=float(order.price) if order.price is not None else None,
            team_id=str(order.team_id),
        )

    async def place_and_match(
        self,
        session: AsyncSession,
        *,
        db_order: OrderModel,
        symbol_code: str,
    ) -> list[TradeModel]:
        new_order_id = str(db_order.id)
        state = await self.ensure_symbol_loaded(
            session, symbol_code, exclude_order_ids={new_order_id}
        )

        remaining_qty = db_order.quantity - db_order.filled_quantity
        new_order = SimpleOrder(
            order_id=new_order_id,
            side=db_order.side,
            quantity=remaining_qty,
            price=float(db_order.price) if db_order.price is not None else None,
            team_id=str(db_order.team_id),
        )
        state.order_models[new_order_id] = db_order

        simple_trades, simple_cancels = state.engine.add_order(new_order)

        # Only track the new order as resting if it is a limit order with remaining qty
        if new_order.price is not None and new_order.quantity > 0:
            state.simple_orders[new_order_id] = new_order
        else:
            state.simple_orders.pop(new_order_id, None)

        trades: list[TradeModel] = []
        impacted_orders: set[str] = {new_order_id}
        position_cache: dict[tuple[uuid.UUID, uuid.UUID], PositionModel] = {}

        for t in simple_trades:
            buyer_model = await self._get_order_model(session, state, t.buyer_order_id)
            seller_model = await self._get_order_model(session, state, t.seller_order_id)
            if not buyer_model or not seller_model:
                continue

            trade = TradeModel(
                buyer_order_id=buyer_model.id,
                seller_order_id=seller_model.id,
                symbol_id=buyer_model.symbol_id,
                quantity=t.quantity,
                price=t.price,
                executed_at=datetime.utcnow(),
            )
            session.add(trade)
            trades.append(trade)

            self._apply_fill_to_order(buyer_model, t.quantity)
            self._apply_fill_to_order(seller_model, t.quantity)
            impacted_orders.update({t.buyer_order_id, t.seller_order_id})

            await self._apply_trade_to_position(
                session,
                team_id=buyer_model.team_id,
                symbol_id=buyer_model.symbol_id,
                side="buy",
                qty=t.quantity,
                price=t.price,
                cache=position_cache,
            )
            await self._apply_trade_to_position(
                session,
                team_id=seller_model.team_id,
                symbol_id=seller_model.symbol_id,
                side="sell",
                qty=t.quantity,
                price=t.price,
                cache=position_cache,
            )

        for cancel in simple_cancels:
            cancel_model = await self._get_order_model(session, state, cancel.order_id)
            if not cancel_model:
                continue
            cancel_model.filled_quantity += cancel.quantity
            if cancel_model.filled_quantity >= cancel_model.quantity:
                cancel_model.status = "cancelled"
            else:
                cancel_model.status = "partial"
            cancel_model.updated_at = datetime.utcnow()
            impacted_orders.add(cancel.order_id)

        self._cleanup_orders(state, impacted_orders)
        self._update_new_order_status(db_order)

        return trades

    async def _get_order_model(
        self,
        session: AsyncSession,
        state: OrderBookState,
        order_id: str,
    ) -> OrderModel | None:
        model = state.order_models.get(order_id)
        try:
            oid: uuid.UUID | str = uuid.UUID(order_id)
        except ValueError:
            oid = order_id
        if model is not None:
            bound_session = inspect(model).session
            if bound_session is session.sync_session:
                return model
        model = await session.get(OrderModel, oid)
        if model:
            state.order_models[order_id] = model
        return model

    def _apply_fill_to_order(self, order: OrderModel, qty: int) -> None:
        order.filled_quantity += qty
        if order.filled_quantity >= order.quantity:
            order.status = "filled"
        else:
            order.status = "partial"
        order.updated_at = datetime.utcnow()

    def _cleanup_orders(self, state: OrderBookState, order_ids: Iterable[str]) -> None:
        for order_id in order_ids:
            simple = state.simple_orders.get(order_id)
            if simple is not None and simple.quantity <= 0:
                state.engine.remove_order(order_id)
                state.simple_orders.pop(order_id, None)
            model = state.order_models.get(order_id)
            if model and model.status in {"filled", "cancelled"}:
                state.simple_orders.pop(order_id, None)
                state.order_models.pop(order_id, None)

    def _update_new_order_status(self, order: OrderModel) -> None:
        if order.order_type == "market":
            if order.filled_quantity >= order.quantity:
                order.status = "filled"
            else:
                order.status = "cancelled"
        else:
            if order.filled_quantity >= order.quantity:
                order.status = "filled"
            elif order.filled_quantity > 0:
                order.status = "partial"
            else:
                order.status = "pending"
        order.updated_at = datetime.utcnow()

    def remove_from_book(self, symbol_code: str, order_id: str) -> None:
        state = self._books.get(symbol_code)
        if not state or not state.loaded:
            return
        state.engine.remove_order(order_id)
        state.simple_orders.pop(order_id, None)
        state.order_models.pop(order_id, None)

    async def _apply_trade_to_position(
        self,
        session: AsyncSession,
        *,
        team_id: uuid.UUID,
        symbol_id: uuid.UUID,
        side: str,
        qty: int,
        price: float,
        cache: dict[tuple[uuid.UUID, uuid.UUID], PositionModel] | None = None,
    ) -> None:
        key = (team_id, symbol_id)
        pos: PositionModel | None
        if cache is not None and key in cache:
            pos = cache[key]
        else:
            pos = await session.get(PositionModel, {"team_id": team_id, "symbol_id": symbol_id})
            if pos is None:
                pos = PositionModel(
                    team_id=team_id,
                    symbol_id=symbol_id,
                    quantity=0,
                    average_price=None,
                    realized_pnl=0,
                )
                session.add(pos)
                await session.flush()
            if cache is not None:
                cache[key] = pos

        assert pos is not None

        qty_curr = pos.quantity
        avg = float(pos.average_price) if pos.average_price is not None else None

        if side == "buy":
            if qty_curr >= 0:
                if avg is None or qty_curr == 0:
                    pos.average_price = price
                else:
                    pos.average_price = ((avg * qty_curr) + (price * qty)) / (qty_curr + qty)
                pos.quantity = qty_curr + qty
            else:
                cover = min(qty, -qty_curr)
                if avg is not None:
                    pos.realized_pnl = (float(pos.realized_pnl) + (avg - price) * cover)
                pos.quantity = qty_curr + cover
                if pos.quantity == 0:
                    pos.average_price = None
                remaining = qty - cover
                if remaining > 0:
                    pos.average_price = price
                    pos.quantity = remaining
        else:
            if qty_curr <= 0:
                if avg is None or qty_curr == 0:
                    pos.average_price = price
                else:
                    pos.average_price = ((avg * (-qty_curr)) + (price * qty)) / ((-qty_curr) + qty)
                pos.quantity = qty_curr - qty
            else:
                sell = min(qty, qty_curr)
                if avg is not None:
                    pos.realized_pnl = (float(pos.realized_pnl) + (price - avg) * sell)
                pos.quantity = qty_curr - sell
                if pos.quantity == 0:
                    pos.average_price = None
                remaining = qty - sell
                if remaining > 0:
                    pos.average_price = price
                    pos.quantity = -remaining
