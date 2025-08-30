from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any, Literal

# Ensure anyio asyncio backend is importable in some environments
import anyio._backends._asyncio  # noqa: F401
from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.routing import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.config import settings
from src.app.deps import RequireAPIKey
from src.app.startup import attach_lifecycle
from src.core.orders import OrderService
from src.db.models import APIKey as APIKeyModel
from src.db.models import MarketData as MarketDataModel
from src.db.models import Order as OrderModel
from src.db.models import Position as PositionModel
from src.db.models import Symbol as SymbolModel
from src.db.models import Team as TeamModel
from src.db.models import TeamMember as TeamMemberModel
from src.db.models import Trade as TradeModel
from src.db.models import User as UserModel
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


async def _get_team_by_id(session: AsyncSession, team_id: str) -> TeamModel:
    """Get team by ID - assumes team exists (should be created during registration)"""
    team = await session.get(TeamModel, team_id)
    if not team:
        raise HTTPException(status_code=404, detail=f"Team {team_id} not found")
    return team


@api_router.post("/orders", response_model=PlaceOrderResponse)
async def place_order(
    payload: PlaceOrderRequest,
    api_key: RequireAPIKey,
    session: DbSession,
) -> PlaceOrderResponse:
    from src.exchange.websocket_manager import websocket_manager

    team = await _get_team_by_id(session, api_key["team_id"])
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
    trades = await _exchange.place_and_match(session, db_order=db_order, symbol_code=payload.symbol)
    await session.commit()

    # Notify WebSocket clients of order book changes
    await websocket_manager.notify_order_book_update(payload.symbol, session)

    # Notify WebSocket clients of any trades that occurred
    for trade in trades:
        await websocket_manager.notify_trade(
            payload.symbol,
            float(trade.price),
            trade.quantity,
            trade.executed_at.isoformat()
        )

    return PlaceOrderResponse(
        order_id=str(db_order.id),
        status=db_order.status,
        created_at=db_order.created_at,
    )


@api_router.delete("/orders/{order_id}", response_model=dict[str, str])
async def cancel_order(order_id: str, api_key: RequireAPIKey, session: DbSession) -> dict[str, str]:
    from src.exchange.websocket_manager import websocket_manager

    # First get the order to get the symbol for WebSocket notification
    order = await session.get(OrderModel, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Get symbol name for notification
    symbol_result = await session.get(SymbolModel, order.symbol_id)
    symbol_name = symbol_result.symbol if symbol_result else None

    # Update order status to cancelled
    res = await session.execute(
        update(OrderModel)
        .where(OrderModel.id == order_id)
        .values(status="cancelled", updated_at=datetime.utcnow())
        .returning(OrderModel.id)
    )
    row = res.first()
    if not row:
        raise HTTPException(status_code=404, detail="Order not found")

    await session.commit()

    # Notify WebSocket clients of order book changes
    if symbol_name:
        await websocket_manager.notify_order_book_update(symbol_name, session)

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
        team = await _get_team_by_id(session, api_key["team_id"])
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


# User Authentication Models
class UserCreate(BaseModel):
    email: str
    name: str
    openid_sub: str

class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    created_at: str

class TeamResponse(BaseModel):
    id: str
    name: str
    role: str  # User's role in this team

class LoginRequest(BaseModel):
    openid_sub: str
    email: str
    name: str

class LoginResponse(BaseModel):
    user: UserResponse
    teams: list[TeamResponse]
    api_key: str

class CreateTeamRequest(BaseModel):
    name: str

class JoinTeamRequest(BaseModel):
    team_id: str
    role: str = "member"


# Authentication Endpoints
@api_router.post("/auth/register", response_model=LoginResponse)
async def register(request: LoginRequest, session: DbSession) -> LoginResponse:
    """Register a new user and create default team"""
    import hashlib
    import secrets

    from src.db.models import APIKey as APIKeyModel

    # Check if user already exists
    existing_user = await session.scalar(
        select(UserModel).where(UserModel.openid_sub == request.openid_sub)
    )

    if existing_user:
        raise HTTPException(status_code=400, detail="User already exists")

    # Create new user
    user = UserModel(
        email=request.email,
        name=request.name,
        openid_sub=request.openid_sub
    )
    session.add(user)
    await session.flush()  # Get the user ID

    # Create a default team for the user
    team = TeamModel(name=f"{request.name}'s Team")
    session.add(team)
    await session.flush()

    # Add user to the team as admin
    team_member = TeamMemberModel(
        team_id=team.id,
        user_id=user.id,
        role="admin"
    )
    session.add(team_member)

    # Create API key for the team
    api_key_value = secrets.token_urlsafe(32)
    api_key_hash = hashlib.sha256(api_key_value.encode()).hexdigest()

    api_key = APIKeyModel(
        key_hash=api_key_hash,
        team_id=team.id,
        name=f"{request.name}'s API Key",
        is_admin=True
    )
    session.add(api_key)

    await session.commit()

    # Get user's teams
    teams = [TeamResponse(
        id=str(team.id),
        name=team.name,
        role="admin"
    )]

    return LoginResponse(
        user=UserResponse(
            id=str(user.id),
            email=user.email,
            name=user.name,
            created_at=user.created_at.isoformat()
        ),
        teams=teams,
        api_key=api_key_value
    )


@api_router.post("/auth/login", response_model=LoginResponse)
async def login(request: LoginRequest, session: DbSession) -> LoginResponse:
    """Login existing user and return user info with teams and API key"""
    from src.db.models import APIKey as APIKeyModel

    # Find existing user
    user = await session.scalar(
        select(UserModel).where(UserModel.openid_sub == request.openid_sub)
    )

    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    # Update user info if needed
    if user.email != request.email or user.name != request.name:
        user.email = request.email
        user.name = request.name
        await session.commit()

    # Get user's teams and API key
    teams_query = select(
        TeamModel.id,
        TeamModel.name,
        TeamMemberModel.role,
        APIKeyModel.key_hash
    ).join(TeamMemberModel, TeamModel.id == TeamMemberModel.team_id)\
     .join(APIKeyModel, TeamModel.id == APIKeyModel.team_id)\
     .where(TeamMemberModel.user_id == user.id)\
     .limit(1)  # For simplicity, get first team's API key

    team_result = await session.execute(teams_query)
    team_row = team_result.first()

    if not team_row:
        raise HTTPException(status_code=404, detail="No teams found for user")

    # In a real system, you'd have a way to retrieve the original API key
    # For now, we'll use a deterministic approach based on the hash
    api_key_value = f"key_{team_row.key_hash[:16]}"

    # Get all user's teams
    all_teams_query = select(
        TeamModel.id,
        TeamModel.name,
        TeamMemberModel.role
    ).join(TeamMemberModel, TeamModel.id == TeamMemberModel.team_id)\
     .where(TeamMemberModel.user_id == user.id)

    teams_result = await session.execute(all_teams_query)
    teams = [
        TeamResponse(
            id=str(row.id),
            name=row.name,
            role=row.role
        )
        for row in teams_result.fetchall()
    ]

    return LoginResponse(
        user=UserResponse(
            id=str(user.id),
            email=user.email,
            name=user.name,
            created_at=user.created_at.isoformat()
        ),
        teams=teams,
        api_key=api_key_value
    )


@api_router.post("/auth/teams", response_model=TeamResponse)
async def create_team(
    request: CreateTeamRequest,
    api_key: RequireAPIKey,
    session: DbSession
) -> TeamResponse:
    """Create a new team"""
    # Get user from API key
    user_query = (
        select(UserModel)
        .join(TeamMemberModel, UserModel.id == TeamMemberModel.user_id)
        .join(APIKeyModel, TeamMemberModel.team_id == APIKeyModel.team_id)
        .where(APIKeyModel.key_hash == api_key["key_hash"])
    )

    user = await session.scalar(user_query)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Create new team
    team = TeamModel(name=request.name)
    session.add(team)
    await session.flush()

    # Add user as admin
    team_member = TeamMemberModel(
        team_id=team.id,
        user_id=user.id,
        role="admin"
    )
    session.add(team_member)
    await session.commit()

    return TeamResponse(
        id=str(team.id),
        name=team.name,
        role="admin"
    )


@api_router.get("/positions", response_model=PositionsResponse)
async def get_positions(api_key: RequireAPIKey, session: DbSession) -> PositionsResponse:
    """Get real positions from the positions table"""
    team = await _get_team_by_id(session, api_key["team_id"])

    # Get positions from the positions table
    positions_query = select(
        PositionModel.quantity,
        PositionModel.average_price,
        PositionModel.realized_pnl,
        SymbolModel.symbol,
        SymbolModel.id.label("symbol_id")
    ).join(
        SymbolModel, PositionModel.symbol_id == SymbolModel.id
    ).where(
        PositionModel.team_id == team.id,
        PositionModel.quantity != 0  # Only show non-zero positions
    )

    position_rows = await session.execute(positions_query)
    positions: list[Position] = []

    for row in position_rows:
        symbol = row.symbol
        quantity = row.quantity
        avg_price = float(row.average_price) if row.average_price else None
        realized_pnl = float(row.realized_pnl) if row.realized_pnl else 0.0

        # Get current market price from latest trade
        current_price = None
        latest_trade = await session.scalar(
            select(TradeModel.price)
            .where(TradeModel.symbol_id == row.symbol_id)
            .order_by(TradeModel.executed_at.desc())
            .limit(1)
        )
        if latest_trade:
            current_price = float(latest_trade)

        # Calculate unrealized P&L
        unrealized_pnl = None
        if current_price is not None and avg_price is not None and quantity != 0:
            unrealized_pnl = (current_price - avg_price) * quantity

        positions.append(
            Position(
                symbol=symbol,
                quantity=quantity,
                average_price=avg_price,
                current_price=current_price,
                unrealized_pnl=unrealized_pnl,
                realized_pnl=realized_pnl,
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
    *,
    api_key: RequireAPIKey,
) -> TradesResponse:
    from src.db.models import Trade as TradeModel  # local import to avoid cycles

    # Get trades that involve this team (either as buyer or seller)
    # We need to check both buyer and seller orders to see if this team is involved
    team = await _get_team_by_id(session, api_key["team_id"])

    # Subquery to get buyer orders for this team
    buyer_orders = select(OrderModel.id).where(OrderModel.team_id == team.id).subquery()

    # Subquery to get seller orders for this team
    seller_orders = select(OrderModel.id).where(OrderModel.team_id == team.id).subquery()

    stmt = select(
        TradeModel.id,
        SymbolModel.symbol,
        TradeModel.quantity,
        TradeModel.price,
        TradeModel.executed_at,
    ).join(SymbolModel, SymbolModel.id == TradeModel.symbol_id)\
     .where(
         (TradeModel.buyer_order_id.in_(select(buyer_orders.c.id))) |
         (TradeModel.seller_order_id.in_(select(seller_orders.c.id)))
     )

    if symbol:
        stmt = stmt.where(SymbolModel.symbol == symbol)

    # Order by most recent first
    stmt = stmt.order_by(TradeModel.executed_at.desc())

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


@api_router.get("/trades/market", response_model=TradesResponse)
async def get_market_trades(
    session: DbSession,
    symbol: str | None = None,
) -> TradesResponse:
    """Get all market trades (not filtered by team) - for price charts"""
    from src.db.models import Trade as TradeModel  # local import to avoid cycles

    # Get all trades in the market (no team filtering)
    stmt = select(
        TradeModel.id,
        SymbolModel.symbol,
        TradeModel.quantity,
        TradeModel.price,
        TradeModel.executed_at,
    ).join(SymbolModel, SymbolModel.id == TradeModel.symbol_id)

    if symbol:
        stmt = stmt.where(SymbolModel.symbol == symbol)

    # Order by most recent first
    stmt = stmt.order_by(TradeModel.executed_at.desc())

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
        team = await _get_team_by_id(session, api_key["team_id"])
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
async def create_team_admin(payload: TeamIn, session: DbSession) -> dict[str, str]:
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
    try:
        await ws.send_json(data)
    except Exception as err:
        # Connection is closed, ignore the error
        raise WebSocketDisconnect() from err


@app.websocket("/ws/v1/market-data")
async def market_data_ws(ws: WebSocket) -> None:
    import asyncio

    from sqlalchemy import text

    from src.exchange.websocket_manager import websocket_manager

    await ws.accept()
    print("WebSocket connection accepted")

    try:
        # Wait for subscription message
        data = await ws.receive_json()
        msg = SubscriptionMessage.model_validate(data)

        if msg.action == "subscribe":
            print(f"Client subscribed to {msg.symbols} for channels {msg.channels}")

            # Register with WebSocket manager
            websocket_manager.connect(ws)
            websocket_manager.subscribe(ws, msg.symbols, msg.channels)

            # Send acknowledgment
            await ws.send_json({
                "type": "subscription_ack",
                "symbols": msg.symbols,
                "channels": msg.channels,
                "timestamp": datetime.now(tz=UTC).isoformat()
            })

            # Send initial data for each requested symbol
            for symbol in msg.symbols:
                async for session in get_db_session():
                    try:
                        # Send current order book if requested
                        if "orderbook" in msg.channels:
                            order_book = await websocket_manager.get_order_book(symbol, session)
                            bids = order_book["bids"]
                            asks = order_book["asks"]

                            await ws.send_json({
                                "type": "orderbook",
                                "symbol": symbol,
                                "bids": bids,
                                "asks": asks,
                                "timestamp": datetime.now(tz=UTC).isoformat()
                            })

                            # Send current quote if requested
                            if "quotes" in msg.channels and (bids or asks):
                                await ws.send_json({
                                    "type": "quote",
                                    "symbol": symbol,
                                    "bid": bids[0]["price"] if bids else 0,
                                    "ask": asks[0]["price"] if asks else 0,
                                    "bid_size": bids[0]["quantity"] if bids else 0,
                                    "ask_size": asks[0]["quantity"] if asks else 0,
                                    "timestamp": datetime.now(tz=UTC).isoformat()
                                })

                        # Send recent trades if requested
                        if "trades" in msg.channels:
                            recent_trades = await session.execute(
                                text("""
                                    SELECT t.price, t.quantity, t.executed_at
                                    FROM trades t
                                    JOIN symbols s ON t.symbol_id = s.id
                                    WHERE s.symbol = :symbol
                                    ORDER BY t.executed_at DESC
                                    LIMIT 1
                                """),
                                {"symbol": symbol}
                            )

                            for trade in recent_trades.fetchall():
                                await ws.send_json({
                                    "type": "trade",
                                    "symbol": symbol,
                                    "price": float(trade.price),
                                    "quantity": float(trade.quantity),
                                    "timestamp": trade.executed_at.isoformat()
                                })

                    except Exception as e:
                        print(f"Error sending initial data for {symbol}: {e}")
                    finally:
                        await session.close()

            # Keep connection alive with periodic heartbeats
            try:
                while True:
                    # Send heartbeat every 30 seconds
                    await asyncio.sleep(30)

                    # Check if connection is still active
                    if ws.client_state.name != "CONNECTED":
                        print("WebSocket connection no longer active, stopping heartbeat")
                        break

                    await ws.send_json({
                        "type": "heartbeat",
                        "timestamp": datetime.now(tz=UTC).isoformat()
                    })
            except Exception as e:
                print(f"Heartbeat loop ended: {e}")

    except WebSocketDisconnect:
        print("WebSocket client disconnected normally")
        websocket_manager.disconnect(ws)
    except Exception as e:
        print(f"WebSocket error: {e}")
        websocket_manager.disconnect(ws)
    finally:
        print("WebSocket connection closed")

