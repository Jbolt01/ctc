from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.models import Order, Symbol


class OrderService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_symbol_id(self, symbol_code: str) -> uuid.UUID:
        row = await self.session.scalar(select(Symbol.id).where(Symbol.symbol == symbol_code))
        if not row:
            raise ValueError("Unknown symbol")
        return row

    async def place_order(
        self,
        *,
        team_id: uuid.UUID,
        symbol_code: str,
        side: str,
        order_type: str,
        quantity: int,
        price: float | None,
    ) -> Order:
        symbol_id = await self.get_symbol_id(symbol_code)
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
        return db_order
