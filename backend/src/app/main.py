from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any, Literal

# Ensure anyio asyncio backend is importable in some environments
import anyio._backends._asyncio  # noqa: F401
from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.routing import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.config import settings
from src.app.deps import RequireAPIKey
from src.app.startup import attach_lifecycle
from src.core.orders import OrderService
from src.db.models import MarketData as MarketDataModel
from src.db.models import Order as OrderModel
from src.db.models import Position as PositionModel
from src.db.models import Symbol as SymbolModel
from src.db.models import Team as TeamModel
from src.db.session import get_db_session
from src.exchange.manager import ExchangeManager

app = FastAPI(
    title=settings.api_title,
    version=settings.api_version,
    docs_url='/api/docs',
    redoc_url='/api/redoc',
    openapi_url='/api/openapi.json'
)
attach_lifecycle(app)


health_router = APIRouter()


@health_router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


api_router = APIRouter(prefix="/api/v1")


class PlaceOrderRequest(BaseModel):
    symbol: str
    side: Literal["buy", "sell"]
    order_type: Literal["market", "limit"]
    quantity: int = Field(gt=0)
    price: float | None = Field(default=None, gt=0)


class OrderSummary(BaseModel):
    order_id: str
    symbol: str
    side: str
    order_type: str
    quantity: int
    price: float | None
    filled_quantity: int
    status: Literal["pending", "partial", "filled", "cancelled"]
    created_at: datetime


class PlaceOrderResponse(BaseModel):
    order_id: str
    status: str
    created_at: datetime


_ORDERS: dict[str, OrderSummary] = {}
_exchange = ExchangeManager()


DbSession = Annotated[AsyncSession, Depends(get_db_session)]


async def _get_or_create_team(session: AsyncSession, team_name: str) -> TeamModel:
    row = await session.scalar(select(TeamModel).where(TeamModel.name == team_name))
    if row:
        return row
    team = TeamModel(name=team_name)
    session.add(team)
    await session.commit()
    await session.refresh(team)
    return team


@api_router.post("/orders", response_model=PlaceOrderResponse)
async def place_order(
    payload: PlaceOrderRequest,
    api_key: RequireAPIKey,
    session: DbSession,
) -> PlaceOrderResponse:
    team = await _get_or_create_team(session, api_key["team_id"])
    service = OrderService(session)
    db_order = await service.place_order(
        team_id=team.id,
        symbol_code=payload.symbol,
        side=payload.side,
        order_type=payload.order_type,
        quantity=payload.quantity,
        price=payload.price,
    )
    # Attempt to match the new order with existing orders and persist trades/positions
    await _exchange.load_open_orders(session)
    await _exchange.place_and_match(session, db_order=db_order, symbol_code=payload.symbol)
    await session.commit()
    return PlaceOrderResponse(
        order_id=str(db_order.id),
        status=db_order.status,
        created_at=db_order.created_at,
    )


@api_router.delete("/orders/{order_id}", response_model=dict[str, str])
async def cancel_order(order_id: str, api_key: RequireAPIKey, session: DbSession) -> dict[str, str]:
    res = await session.execute(
        update(OrderModel)
        .where(OrderModel.id == order_id)
        .values(status="cancelled", updated_at=datetime.now(tz=UTC))
        .returning(OrderModel.id)
    )
    row = res.first()
    if not row:
        raise HTTPException(status_code=404, detail="Order not found")
    await session.commit()
    return {"order_id": order_id, "status": "cancelled"}


class OrdersResponse(BaseModel):
    orders: list[OrderSummary]


@api_router.get("/orders", response_model=OrdersResponse)
async def get_orders(
    status: str | None = None,
    symbol: str | None = None,
    *,
    api_key: RequireAPIKey,
    session: DbSession,
) -> OrdersResponse:
    # Join to Symbol to get symbol code and filter by team
    stmt = select(
        OrderModel.id,
        SymbolModel.symbol,
        OrderModel.side,
        OrderModel.order_type,
        OrderModel.quantity,
        OrderModel.price,
        OrderModel.filled_quantity,
        OrderModel.status,
        OrderModel.created_at,
    ).join(SymbolModel, SymbolModel.id == OrderModel.symbol_id)
    # Filter to this team unless in permissive dev mode
    if not settings.allow_any_api_key:
        team = await _get_or_create_team(session, api_key["team_id"])
        stmt = stmt.where(OrderModel.team_id == team.id)
    if status:
        stmt = stmt.where(OrderModel.status == status)
    if symbol:
        stmt = stmt.where(SymbolModel.symbol == symbol)
    rows = (await session.execute(stmt)).all()
    orders = [
        OrderSummary(
            order_id=str(r.id),
            symbol=r.symbol,
            side=r.side,
            order_type=r.order_type,
            quantity=r.quantity,
            price=float(r.price) if r.price is not None else None,
            filled_quantity=r.filled_quantity,
            status=r.status,
            created_at=r.created_at,
        )
        for r in rows
    ]
    return OrdersResponse(orders=orders)


class Position(BaseModel):
    symbol: str
    quantity: int
    average_price: float | None = None
    current_price: float | None = None
    unrealized_pnl: float | None = None
    realized_pnl: float | None = 0.0


class PositionsResponse(BaseModel):
    positions: list[Position]


@api_router.get("/positions", response_model=PositionsResponse)
async def get_positions(api_key: RequireAPIKey, session: DbSession) -> PositionsResponse:
    # Get positions joined with symbol code
    stmt = select(
        PositionModel.symbol_id,
        SymbolModel.symbol,
        PositionModel.quantity,
        PositionModel.average_price,
        PositionModel.realized_pnl,
    ).join(SymbolModel, SymbolModel.id == PositionModel.symbol_id)
    rows = (await session.execute(stmt)).all()
    positions: list[Position] = []
    for r in rows:
        # Find latest close for current price
        md_sub = (
            select(func.max(MarketDataModel.timestamp))
            .where(MarketDataModel.symbol_id == r.symbol_id)
            .scalar_subquery()
        )
        md_row = (
            await session.execute(
                select(MarketDataModel.close).where(
                    MarketDataModel.symbol_id == r.symbol_id,
                    MarketDataModel.timestamp == md_sub,
                )
            )
        ).first()
        current_price = float(md_row[0]) if md_row and md_row[0] is not None else None
        avg = float(r.average_price) if r.average_price is not None else None
        unrealized: float | None = None
        if current_price is not None and avg is not None and r.quantity != 0:
            unrealized = (current_price - avg) * r.quantity
        positions.append(
            Position(
                symbol=r.symbol,
                quantity=r.quantity,
                average_price=avg,
                current_price=current_price,
                unrealized_pnl=unrealized,
                realized_pnl=float(r.realized_pnl) if r.realized_pnl is not None else 0.0,
            )
        )
    return PositionsResponse(positions=positions)


class TradeRecord(BaseModel):
    trade_id: str
    symbol: str
    quantity: int
    price: float
    executed_at: datetime


class TradesResponse(BaseModel):
    trades: list[TradeRecord]


@api_router.get("/trades", response_model=TradesResponse)
async def get_trades(
    session: DbSession,
    symbol: str | None = None,
) -> TradesResponse:
    from src.db.models import Trade as TradeModel  # local import to avoid cycles

    stmt = select(
        TradeModel.id,
        SymbolModel.symbol,
        TradeModel.quantity,
        TradeModel.price,
        TradeModel.executed_at,
    ).join(SymbolModel, SymbolModel.id == TradeModel.symbol_id)
    if symbol:
        stmt = stmt.where(SymbolModel.symbol == symbol)
    rows = (await session.execute(stmt)).all()
    trades = [
        TradeRecord(
            trade_id=str(r.id),
            symbol=r.symbol,
            quantity=r.quantity,
            price=float(r.price),
            executed_at=r.executed_at,
        )
        for r in rows
    ]
    return TradesResponse(trades=trades)


class SymbolInfo(BaseModel):
    symbol: str
    name: str
    symbol_type: str = "equity"
    tick_size: float = 0.01
    lot_size: int = 1


class SymbolsResponse(BaseModel):
    symbols: list[SymbolInfo]


_SYMBOLS: list[SymbolInfo] = [
    SymbolInfo(symbol="AAPL", name="Apple Inc."),
    SymbolInfo(symbol="GOOGL", name="Alphabet Inc."),
]


@api_router.get("/symbols", response_model=SymbolsResponse)
async def get_symbols(api_key: RequireAPIKey, session: DbSession) -> SymbolsResponse:
    rows = (await session.execute(select(SymbolModel.symbol, SymbolModel.name))).all()
    if not rows:
        # fallback to in-memory defaults
        return SymbolsResponse(symbols=_SYMBOLS)
    return SymbolsResponse(symbols=[SymbolInfo(symbol=s, name=n) for s, n in rows])


class OrderBookLevel(BaseModel):
    price: float
    quantity: int


class OrderBookResponse(BaseModel):
    symbol: str
    bids: list[OrderBookLevel]
    asks: list[OrderBookLevel]
    last_update: datetime


@api_router.get("/orderbook/{symbol}", response_model=OrderBookResponse)
async def get_orderbook(
    symbol: str, api_key: RequireAPIKey, session: DbSession, depth: int = 10
) -> OrderBookResponse:
    now = datetime.now(tz=UTC)
    # Lazy load book from DB if empty
    await _exchange.load_open_orders(session)
    bids, asks = _exchange.get_orderbook_levels(symbol, depth=depth)
    bid_levels = [OrderBookLevel(price=p, quantity=q) for p, q in bids]
    ask_levels = [OrderBookLevel(price=p, quantity=q) for p, q in asks]
    return OrderBookResponse(symbol=symbol, bids=bid_levels, asks=ask_levels, last_update=now)


# Admin router for basic CRUD
admin_router = APIRouter(prefix="/api/v1/admin")


class UpsertSymbol(BaseModel):
    symbol: str
    name: str
    symbol_type: Literal["equity", "etf", "option"] = "equity"
    tick_size: float = 0.01
    lot_size: int = 1


@admin_router.post("/symbols", response_model=SymbolInfo)
async def create_symbol(payload: UpsertSymbol, session: DbSession) -> SymbolInfo:
    exists = await session.scalar(select(SymbolModel).where(SymbolModel.symbol == payload.symbol))
    if exists:
        raise HTTPException(status_code=409, detail="Symbol already exists")
    sym = SymbolModel(
        symbol=payload.symbol,
        name=payload.name,
        symbol_type=payload.symbol_type,
        tick_size=payload.tick_size,
        lot_size=payload.lot_size,
    )
    session.add(sym)
    await session.commit()
    return SymbolInfo(
        symbol=sym.symbol,
        name=sym.name,
        symbol_type=sym.symbol_type,
        tick_size=float(sym.tick_size),
        lot_size=sym.lot_size,
    )


@admin_router.delete("/symbols/{symbol}")
async def delete_symbol(symbol: str, session: DbSession) -> dict[str, str]:
    row = await session.scalar(select(SymbolModel).where(SymbolModel.symbol == symbol))
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    await session.delete(row)
    await session.commit()
    return {"status": "deleted"}


# Orders: open orders endpoint
@api_router.get("/orders/open", response_model=OrdersResponse)
async def get_open_orders(
    *, api_key: RequireAPIKey, session: DbSession, symbol: str | None = None
) -> OrdersResponse:
    stmt = select(
        OrderModel.id,
        SymbolModel.symbol,
        OrderModel.side,
        OrderModel.order_type,
        OrderModel.quantity,
        OrderModel.price,
        OrderModel.filled_quantity,
        OrderModel.status,
        OrderModel.created_at,
    ).join(SymbolModel, SymbolModel.id == OrderModel.symbol_id)
    stmt = stmt.where(OrderModel.status.in_(["pending", "partial"]))
    if not settings.allow_any_api_key:
        team = await _get_or_create_team(session, api_key["team_id"])
        stmt = stmt.where(OrderModel.team_id == team.id)
    if symbol:
        stmt = stmt.where(SymbolModel.symbol == symbol)
    rows = (await session.execute(stmt)).all()
    orders = [
        OrderSummary(
            order_id=str(r.id),
            symbol=r.symbol,
            side=r.side,
            order_type=r.order_type,
            quantity=r.quantity,
            price=float(r.price) if r.price is not None else None,
            filled_quantity=r.filled_quantity,
            status=r.status,
            created_at=r.created_at,
        )
        for r in rows
    ]
    return OrdersResponse(orders=orders)


# Admin: limits, hours, teams, competitions CRUD (minimal)
class LimitIn(BaseModel):
    symbol: str
    max_position: int
    max_order_size: int
    applies_to_admin: bool = False


@admin_router.post("/limits")
async def create_limit(payload: LimitIn, session: DbSession) -> dict[str, str]:
    from src.db.models import PositionLimit as PositionLimitModel

    sym = await session.scalar(select(SymbolModel).where(SymbolModel.symbol == payload.symbol))
    if not sym:
        raise HTTPException(status_code=404, detail="Symbol not found")
    limit = PositionLimitModel(
        symbol_id=sym.id,
        max_position=payload.max_position,
        max_order_size=payload.max_order_size,
        applies_to_admin=payload.applies_to_admin,
    )
    session.add(limit)
    await session.commit()
    return {"status": "ok"}


@admin_router.get("/limits")
async def list_limits(session: DbSession) -> list[dict[str, Any]]:
    from src.db.models import PositionLimit as PositionLimitModel

    rows = (
        await session.execute(
            select(
                PositionLimitModel.id,
                SymbolModel.symbol,
                PositionLimitModel.max_position,
                PositionLimitModel.max_order_size,
                PositionLimitModel.applies_to_admin,
            ).join(SymbolModel, SymbolModel.id == PositionLimitModel.symbol_id)
        )
    ).all()
    return [
        {
            "id": str(r.id),
            "symbol": r.symbol,
            "max_position": r.max_position,
            "max_order_size": r.max_order_size,
            "applies_to_admin": r.applies_to_admin,
        }
        for r in rows
    ]


class TradingHourIn(BaseModel):
    symbol: str
    day_of_week: int
    open_time: str
    close_time: str
    is_active: bool = True


@admin_router.post("/hours")
async def create_hours(payload: TradingHourIn, session: DbSession) -> dict[str, str]:
    from src.db.models import TradingHours as TradingHoursModel

    sym = await session.scalar(select(SymbolModel).where(SymbolModel.symbol == payload.symbol))
    if not sym:
        raise HTTPException(status_code=404, detail="Symbol not found")
    row = TradingHoursModel(
        symbol_id=sym.id,
        day_of_week=payload.day_of_week,
        open_time=payload.open_time,
        close_time=payload.close_time,
        is_active=payload.is_active,
    )
    session.add(row)
    await session.commit()
    return {"status": "ok"}


@admin_router.get("/hours")
async def list_hours(session: DbSession) -> list[dict[str, Any]]:
    from src.db.models import TradingHours as TradingHoursModel

    rows = (
        await session.execute(
            select(
                TradingHoursModel.id,
                SymbolModel.symbol,
                TradingHoursModel.day_of_week,
                TradingHoursModel.open_time,
                TradingHoursModel.close_time,
                TradingHoursModel.is_active,
            ).join(SymbolModel, SymbolModel.id == TradingHoursModel.symbol_id)
        )
    ).all()
    return [
        {
            "id": str(r.id),
            "symbol": r.symbol,
            "day_of_week": r.day_of_week,
            "open_time": r.open_time,
            "close_time": r.close_time,
            "is_active": r.is_active,
        }
        for r in rows
    ]


class TeamIn(BaseModel):
    name: str


@admin_router.post("/teams")
async def create_team(payload: TeamIn, session: DbSession) -> dict[str, str]:
    if await session.scalar(select(TeamModel).where(TeamModel.name == payload.name)):
        raise HTTPException(status_code=409, detail="Team exists")
    team = TeamModel(name=payload.name)
    session.add(team)
    await session.commit()
    return {"id": str(team.id)}


@admin_router.get("/teams")
async def list_teams(session: DbSession) -> list[dict[str, Any]]:
    rows = (await session.execute(select(TeamModel.id, TeamModel.name))).all()
    return [{"id": str(r.id), "name": r.name} for r in rows]


class CompetitionIn(BaseModel):
    name: str
    start_time: datetime
    end_time: datetime
    is_active: bool = False


@admin_router.post("/competitions")
async def create_competition(payload: CompetitionIn, session: DbSession) -> dict[str, str]:
    from src.db.models import Competition as CompetitionModel

    row = CompetitionModel(
        name=payload.name,
        start_time=payload.start_time,
        end_time=payload.end_time,
        is_active=payload.is_active,
    )
    session.add(row)
    await session.commit()
    return {"id": str(row.id)}


@admin_router.get("/competitions")
async def list_competitions(session: DbSession) -> list[dict[str, Any]]:
    from src.db.models import Competition as CompetitionModel

    rows = (
        await session.execute(
            select(
                CompetitionModel.id,
                CompetitionModel.name,
                CompetitionModel.start_time,
                CompetitionModel.end_time,
                CompetitionModel.is_active,
            )
        )
    ).all()
    return [
        {
            "id": str(r.id),
            "name": r.name,
            "start_time": r.start_time,
            "end_time": r.end_time,
            "is_active": r.is_active,
        }
        for r in rows
    ]


class MarketDataIn(BaseModel):
    symbol: str
    close: float


@admin_router.post("/market-data")
async def upsert_market_data(payload: MarketDataIn, session: DbSession) -> dict[str, str]:
    sym = await session.scalar(select(SymbolModel).where(SymbolModel.symbol == payload.symbol))
    if not sym:
        raise HTTPException(status_code=404, detail="Symbol not found")
    md = MarketDataModel(
        symbol_id=sym.id,
        timestamp=datetime.utcnow(),
        open=None,
        high=None,
        low=None,
        close=payload.close,
        volume=None,
    )
    session.add(md)
    await session.commit()
    return {"status": "ok"}


app.include_router(health_router)
app.include_router(api_router)
app.include_router(admin_router)


# WebSocket: /ws/v1/market-data

class SubscriptionMessage(BaseModel):
    action: Literal["subscribe", "unsubscribe"]
    symbols: list[str]
    channels: list[Literal["trades", "orderbook", "quotes"]]


async def ws_send_json(ws: WebSocket, data: dict[str, Any]) -> None:
    await ws.send_json(data)


@app.websocket("/ws/v1/market-data")
async def market_data_ws(ws: WebSocket) -> None:
    await ws.accept()
    try:
        while True:
            raw = await ws.receive_json()
            msg = SubscriptionMessage.model_validate(raw)
            # Immediately send one mock update per requested channel for the first symbol
            now_iso = datetime.now(tz=UTC).isoformat()
            symbol = msg.symbols[0] if msg.symbols else "AAPL"
            if "quotes" in msg.channels:
                await ws_send_json(
                    ws,
                    {
                        "type": "quote",
                        "symbol": symbol,
                        "bid": 150.5,
                        "ask": 150.51,
                        "bid_size": 100,
                        "ask_size": 150,
                        "timestamp": now_iso,
                    },
                )
            if "orderbook" in msg.channels:
                await ws_send_json(
                    ws,
                    {
                        "type": "orderbook",
                        "symbol": symbol,
                        "bids": [{"price": 150.5, "quantity": 100}],
                        "asks": [{"price": 150.51, "quantity": 150}],
                        "timestamp": now_iso,
                    },
                )
            if "trades" in msg.channels:
                await ws_send_json(
                    ws,
                    {
                        "type": "trade",
                        "symbol": symbol,
                        "price": 150.75,
                        "quantity": 100,
                        "timestamp": now_iso,
                    },
                )
    except WebSocketDisconnect:
        return

