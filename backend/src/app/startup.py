from __future__ import annotations

import secrets
from datetime import datetime

from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.orders import OrderService
from src.db.models import Position, Symbol, Team, TradingHours
from src.db.session import SessionLocal
from src.exchange.manager import ExchangeManager


async def seed_initial_symbols(session: AsyncSession) -> None:
    existing = (await session.execute(select(Symbol.symbol))).scalars().all()
    if existing:
        return
    session.add_all(
        [
            Symbol(symbol="AAPL", name="Apple Inc.", symbol_type="equity"),
            Symbol(symbol="GOOGL", name="Alphabet Inc.", symbol_type="equity"),
        ]
    )
    await session.commit()


def attach_lifecycle(app: FastAPI) -> None:
    from src.app.config import settings

    @app.on_event("startup")
    async def _startup() -> None:
        # Seeding is disabled by default; enable via SEED_ON_STARTUP=true if needed for demos
        if getattr(settings, "seed_on_startup", False):
            async with SessionLocal() as session:
                await seed_initial_symbols(session)
                await seed_demo_data(session)


async def _ensure_team(session: AsyncSession, name: str) -> Team:
    row = await session.scalar(select(Team).where(Team.name == name))
    if row:
        return row
    # Generate a simple uppercase join code for seeding
    def _gen_code() -> str:
        return secrets.token_urlsafe(6).replace("-", "").replace("_", "").upper()[:8]

    team = Team(name=name, join_code=_gen_code())
    session.add(team)
    await session.commit()
    await session.refresh(team)
    return team


async def _ensure_hours(session: AsyncSession, symbol_code: str) -> None:
    sym = await session.scalar(select(Symbol).where(Symbol.symbol == symbol_code))
    if not sym:
        return
    existing = (
        await session.execute(
            select(TradingHours.id).where(TradingHours.symbol_id == sym.id)
        )
    ).first()
    if existing:
        return
    rows = []
    for dow in range(1, 6):
        rows.append(
            TradingHours(
                symbol_id=sym.id,
                day_of_week=dow,
                open_time="09:30",
                close_time="16:00",
                is_active=True,
            )
        )
    session.add_all(rows)
    await session.commit()


async def seed_demo_data(session: AsyncSession) -> None:
    # Only seed if orders table is empty (idempotent guard for demo)
    any_orders = await session.scalar(select(func.count()).select_from(Position))
    if any_orders and any_orders > 0:
        return

    # Ensure symbols
    await seed_initial_symbols(session)
    await _ensure_hours(session, "AAPL")
    await _ensure_hours(session, "GOOGL")

    # Ensure teams
    team_alpha = await _ensure_team(session, "Team Alpha")
    team_beta = await _ensure_team(session, "Team Beta")

    # Seed market data (latest close) to drive PnL visuals
    from src.db.models import MarketData as MarketDataModel

    for symbol_code, close in [("AAPL", 150.55), ("GOOGL", 2750.10)]:
        sym = await session.scalar(select(Symbol).where(Symbol.symbol == symbol_code))
        if sym:
            md = MarketDataModel(
                symbol_id=sym.id,
                timestamp=datetime.utcnow(),
                open=None,
                high=None,
                low=None,
                close=close,
                volume=None,
            )
            session.add(md)
    await session.commit()

    # Seed a few orders and immediate trade
    service = OrderService(session)
    exch = ExchangeManager()

    # Matched trade for AAPL at 150.50 qty 100
    aapl_buy = await service.place_order(
        team_id=team_alpha.id,
        symbol_code="AAPL",
        side="buy",
        order_type="limit",
        quantity=100,
        price=150.50,
    )
    await exch.place_and_match(session, db_order=aapl_buy, symbol_code="AAPL")
    aapl_sell = await service.place_order(
        team_id=team_beta.id,
        symbol_code="AAPL",
        side="sell",
        order_type="limit",
        quantity=100,
        price=150.50,
    )
    await exch.place_and_match(session, db_order=aapl_sell, symbol_code="AAPL")

    # Leave resting orders to populate order book depth
    aapl_bid_rest = await service.place_order(
        team_id=team_alpha.id,
        symbol_code="AAPL",
        side="buy",
        order_type="limit",
        quantity=200,
        price=150.40,
    )
    await exch.place_and_match(session, db_order=aapl_bid_rest, symbol_code="AAPL")

    aapl_ask_rest = await service.place_order(
        team_id=team_beta.id,
        symbol_code="AAPL",
        side="sell",
        order_type="limit",
        quantity=200,
        price=150.60,
    )
    await exch.place_and_match(session, db_order=aapl_ask_rest, symbol_code="AAPL")

    await session.commit()
