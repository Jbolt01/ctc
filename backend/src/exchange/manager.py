from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import Order as OrderModel
from src.db.models import Position
from src.db.models import Symbol as SymbolModel
from src.db.models import Trade as TradeModel
from src.exchange.engine import MatchingEngine, SimpleOrder, SimpleTrade


@dataclass
class OrderBookState:
    engine: MatchingEngine


class ExchangeManager:
    def __init__(self) -> None:
        self._books: dict[str, OrderBookState] = {}

    def _get_engine(self, symbol_code: str) -> MatchingEngine:
        state = self._books.get(symbol_code)
        if state is None:
            state = OrderBookState(engine=MatchingEngine())
            self._books[symbol_code] = state
        return state.engine

    def get_orderbook_levels(
        self, symbol_code: str, depth: int = 10
    ) -> tuple[list[tuple[float, int]], list[tuple[float, int]]]:
        engine = self._get_engine(symbol_code)
        return engine.get_orderbook_levels(depth)

    async def load_open_orders(self, session: AsyncSession) -> None:
        rows = (
            await session.execute(
                select(
                    OrderModel.id,
                    SymbolModel.symbol,
                    OrderModel.side,
                    OrderModel.quantity,
                    OrderModel.filled_quantity,
                    OrderModel.price,
                    OrderModel.status,
                )
                .join(SymbolModel, SymbolModel.id == OrderModel.symbol_id)
                .where(OrderModel.status.in_(["pending", "partial"]))
            )
        ).all()
        for r in rows:
            remaining = r.quantity - r.filled_quantity
            if remaining <= 0:
                continue
            order = SimpleOrder(
                order_id=str(r.id),
                side=r.side,
                quantity=remaining,
                price=float(r.price) if r.price is not None else None,
            )
            self._get_engine(r.symbol).add_order(order)

    async def place_and_match(
        self,
        session: AsyncSession,
        *,
        db_order: OrderModel,
        symbol_code: str,
    ) -> list[TradeModel]:
        # Run matching against in-memory book and apply results to DB
        engine = self._get_engine(symbol_code)
        remaining_qty = db_order.quantity - db_order.filled_quantity
        new_order = SimpleOrder(
            order_id=str(db_order.id),
            side=db_order.side,
            quantity=remaining_qty,
            price=float(db_order.price) if db_order.price is not None else None,
        )
        simple_trades: list[SimpleTrade] = engine.add_order(new_order)
        trades: list[TradeModel] = []
        for t in simple_trades:
            buyer_id = uuid.UUID(t.buyer_order_id)
            seller_id = uuid.UUID(t.seller_order_id)
            # Fetch orders to get team and symbol context
            buyer = await session.get(OrderModel, buyer_id)
            seller = await session.get(OrderModel, seller_id)
            if not buyer or not seller:
                continue
            # Create trade row
            trade = TradeModel(
                buyer_order_id=buyer.id,
                seller_order_id=seller.id,
                symbol_id=buyer.symbol_id,
                quantity=t.quantity,
                price=t.price,
                executed_at=datetime.utcnow(),
            )
            session.add(trade)
            trades.append(trade)
            # Update orders filled quantities
            buyer.filled_quantity += t.quantity
            seller.filled_quantity += t.quantity
            buyer.status = "filled" if buyer.filled_quantity >= buyer.quantity else "partial"
            seller.status = "filled" if seller.filled_quantity >= seller.quantity else "partial"
            buyer.updated_at = datetime.utcnow()
            seller.updated_at = datetime.utcnow()
            session.add(buyer)
            session.add(seller)
            # Update positions
            await self._apply_trade_to_position(
                session,
                team_id=buyer.team_id,
                symbol_id=buyer.symbol_id,
                side="buy",
                qty=t.quantity,
                price=t.price,
            )
            await self._apply_trade_to_position(
                session,
                team_id=seller.team_id,
                symbol_id=seller.symbol_id,
                side="sell",
                qty=t.quantity,
                price=t.price,
            )

        # Update the just-placed order status to reflect matches done
        await session.flush()
        await session.refresh(db_order)
        return trades

    async def _apply_trade_to_position(
        self,
        session: AsyncSession,
        *,
        team_id: uuid.UUID,
        symbol_id: uuid.UUID,
        side: str,
        qty: int,
        price: float,
    ) -> None:
        pos = await session.get(Position, {"team_id": team_id, "symbol_id": symbol_id})
        if pos is None:
            pos = Position(
                team_id=team_id,
                symbol_id=symbol_id,
                quantity=0,
                average_price=None,
                realized_pnl=0,
            )
            session.add(pos)
            await session.flush()

        qty_curr = pos.quantity
        avg = float(pos.average_price) if pos.average_price is not None else None

        if side == "buy":
            if qty_curr >= 0:
                # increasing or opening long
                if avg is None or qty_curr == 0:
                    pos.average_price = price
                else:
                    pos.average_price = ((avg * qty_curr) + (price * qty)) / (qty_curr + qty)
                pos.quantity = qty_curr + qty
            else:
                # covering short
                cover = min(qty, -qty_curr)
                if avg is not None:
                    pos.realized_pnl = (float(pos.realized_pnl) + (avg - price) * cover)
                pos.quantity = qty_curr + cover
                if pos.quantity == 0:
                    pos.average_price = None
                remaining = qty - cover
                if remaining > 0:
                    # establish long with remaining
                    pos.average_price = price
                    pos.quantity = remaining
        else:
            # sell
            if qty_curr <= 0:
                # increasing or opening short
                if avg is None or qty_curr == 0:
                    pos.average_price = price
                else:
                    pos.average_price = ((avg * (-qty_curr)) + (price * qty)) / ((-qty_curr) + qty)
                pos.quantity = qty_curr - qty
            else:
                # selling long
                sell = min(qty, qty_curr)
                if avg is not None:
                    pos.realized_pnl = (float(pos.realized_pnl) + (price - avg) * sell)
                pos.quantity = qty_curr - sell
                if pos.quantity == 0:
                    pos.average_price = None
                remaining = qty - sell
                if remaining > 0:
                    # establish short with remaining
                    pos.average_price = price
                    pos.quantity = -remaining

