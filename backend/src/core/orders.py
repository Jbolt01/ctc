from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import Order, Position, PositionLimit, Symbol


class OrderService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_symbol_id(self, symbol_code: str) -> uuid.UUID:
        symbol_id = await self.session.scalar(
            select(Symbol.id).where(Symbol.symbol == symbol_code)
        )
        if not symbol_id:
            raise ValueError(f"Unknown symbol: {symbol_code}")
        return symbol_id

    async def _apply_position_limits(
        self,
        *,
        team_id: uuid.UUID,
        symbol_id: uuid.UUID,
        side: str,
        quantity: int,
    ) -> tuple[int, str | None]:
        """Return capped quantity and optional warning message."""
        limit = await self.session.scalar(
            select(PositionLimit).where(PositionLimit.symbol_id == symbol_id)
        )
        if not limit:
            return quantity, None

        original_quantity = quantity

        # Cap by max_order_size
        quantity = min(quantity, limit.max_order_size)

        # Cap by max_position
        position = await self.session.scalar(
            select(Position).where(
                Position.team_id == team_id, Position.symbol_id == symbol_id
            )
        )
        current_qty = position.quantity if position else 0

        allowed_qty = (
            limit.max_position - current_qty if side == "buy"
            else limit.max_position + current_qty
        )
        quantity = min(quantity, max(0, allowed_qty))

        if quantity != original_quantity:
            return quantity, (
                f"Order quantity capped from {original_quantity} to {quantity} "
                f"due to position limits."
            )
        return quantity, None

    async def place_order(
        self,
        *,
        team_id: uuid.UUID,
        symbol_code: str,
        side: str,
        order_type: str,
        quantity: int,
        price: float | None,
    ) -> tuple[Order, str | None]:
        symbol_id = await self.get_symbol_id(symbol_code)

        # Apply caps
        quantity, message = await self._apply_position_limits(
            team_id=team_id, symbol_id=symbol_id, side=side, quantity=quantity
        )

        # Create order
        db_order = Order(
            team_id=team_id,
            symbol_id=symbol_id,
            side=side,
            order_type=order_type,
            quantity=quantity,
            price=price,
            filled_quantity=0,
            status="pending",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        self.session.add(db_order)
        await self.session.flush()
        return db_order, message
