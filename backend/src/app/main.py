from __future__ import annotations

import hashlib
import secrets
import uuid as _uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

# Ensure anyio asyncio backend is importable in some environments
import anyio._backends._asyncio  # noqa: F401
from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.routing import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.config import settings
from src.app.deps import RequireAPIKey, require_admin
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

_Any = Any

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
    team_pk: _Any
    try:
        team_pk = _uuid.UUID(str(team_id))
    except Exception:
        team_pk = team_id  # fall back if already proper type
    team = await session.get(TeamModel, team_pk)
    if not team:
        raise HTTPException(status_code=404, detail=f"Team {team_id} not found")
    return team


async def _verify_google_id_token(id_token: str) -> dict[str, Any] | None:
    """Verify Google ID token and return claims or None.

    In production (allow_any_api_key = False), this fetches and validates via google-auth.
    In tests or dev (allow_any_api_key = True), callers should not pass id_token, or tests can
    monkeypatch this function.
    """
    if settings.allow_any_api_key:
        # Dev mode, skip verification
        return None
    try:
        # Imports are untyped; keep in local scope to avoid import at module load
        import importlib
        from typing import Any, cast

        google_requests = importlib.import_module("google.auth.transport.requests")
        google_id_token = importlib.import_module("google.oauth2.id_token")

        req = cast(Any, google_requests).Request()
        aud = settings.google_client_id
        claims = cast(Any, google_id_token).verify_oauth2_token(id_token, req, aud)
        return cast(dict[str, Any], dict(claims))
    except Exception:
        # Verification failed; caller may decide to fallback to provided fields
        return None


@api_router.post("/orders", response_model=PlaceOrderResponse)
async def place_order(
    payload: PlaceOrderRequest,
    api_key: RequireAPIKey,
    session: DbSession,
) -> PlaceOrderResponse:
    from src.exchange.websocket_manager import websocket_manager

    team = await _get_team_by_id(session, api_key["team_id"])
    # Enforce trading controls
    sym_row = await session.scalar(select(SymbolModel).where(SymbolModel.symbol == payload.symbol))
    if not sym_row:
        raise HTTPException(status_code=404, detail="Symbol not found")
    if sym_row.trading_halted or sym_row.settlement_active:
        raise HTTPException(status_code=403, detail="Trading halted or settled for this symbol")
    service = OrderService(session)
    db_order = await service.place_order(
        team_id=team.id,
        symbol_code=payload.symbol,
        side=payload.side,
        order_type=payload.order_type,
        quantity=payload.quantity,
        price=payload.price,
    )
    trades = await _exchange.place_and_match(session, db_order=db_order, symbol_code=payload.symbol)
    await session.commit()

    bids, asks = _exchange.get_orderbook_levels(payload.symbol)
    await websocket_manager.notify_order_book_update(payload.symbol, bids, asks)

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

    _oid: _Any
    try:
        _oid = _uuid.UUID(str(order_id))
    except Exception:
        _oid = order_id
    order = await session.get(OrderModel, _oid)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Get symbol name for notification
    symbol_result = await session.get(SymbolModel, order.symbol_id)
    symbol_name = symbol_result.symbol if symbol_result else None

    # Update order status to cancelled
    res = await session.execute(
        update(OrderModel)
        .where(OrderModel.id == _oid)
        .values(status="cancelled", updated_at=datetime.utcnow())
        .returning(OrderModel.id)
    )
    row = res.first()
    if not row:
        raise HTTPException(status_code=404, detail="Order not found")

    order.status = "cancelled"
    order.updated_at = datetime.utcnow()

    await session.commit()

    if symbol_name:
        await _exchange.ensure_symbol_loaded(session, symbol_name)
        _exchange.remove_from_book(symbol_name, str(order.id))
        bids, asks = _exchange.get_orderbook_levels(symbol_name)
        await websocket_manager.notify_order_book_update(symbol_name, bids, asks)

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
    id_token: str | None = None
    openid_sub: str | None = None
    email: str | None = None
    name: str | None = None
    # Team onboarding fields (optional, for registration)
    team_action: Literal["create", "join"] | None = None
    team_name: str | None = None
    join_code: str | None = None

class LoginResponse(BaseModel):
    user: UserResponse
    teams: list[TeamResponse]
    api_key: str

class CreateTeamRequest(BaseModel):
    name: str

class JoinTeamRequest(BaseModel):
    team_id: str
    role: str = "member"


class TeamMemberOut(BaseModel):
    id: str
    email: str
    name: str
    role: str


class TeamSettingsOut(BaseModel):
    id: str
    name: str
    join_code: str
    role: str
    members: list[TeamMemberOut]


# Authentication Endpoints
def _generate_join_code() -> str:
    # Short, shareable, uppercased code
    return secrets.token_urlsafe(6).replace("-", "").replace("_", "").upper()[:8]


async def _ensure_unique_team_name(session: AsyncSession, base_name: str) -> str:
    # If a team with base_name exists, append (2), (3), ... until unique
    name = base_name
    i = 2
    # Only select a simple column to avoid loading all mapped fields
    while await session.scalar(select(TeamModel.id).where(TeamModel.name == name)):
        name = f"{base_name} ({i})"
        i += 1
    return name


@api_router.post("/auth/register", response_model=LoginResponse)
async def register(request: LoginRequest, session: DbSession) -> LoginResponse:
    """Register a new user and either create a team or join via code.

    Backward-compatible defaults:
    - If team_action not provided, create a team with a unique name derived from user's name.
    - Ensure team name uniqueness to avoid IntegrityError on duplicates.
    """
    import hashlib
    import secrets

    from src.db.models import APIKey as APIKeyModel

    # Extract identity: verify Google ID token in production, otherwise use provided fields
    sub: str | None = None
    email: str | None = None
    name: str | None = None
    if request.id_token and not settings.allow_any_api_key:
        claims = await _verify_google_id_token(request.id_token)
        if isinstance(claims, dict):
            sub = str(claims.get("sub"))
            email = str(claims.get("email") or "")
            name = str(claims.get("name") or (email.split("@")[0] if email else "user"))
        else:
            # Fallback to provided fields
            sub = request.openid_sub
            email = request.email
            name = request.name
    else:
        sub = request.openid_sub
        email = request.email
        name = request.name

    if not sub or not email or not name:
        raise HTTPException(status_code=400, detail="Missing identity fields")

    # Check if user already exists
    existing_user = await session.scalar(
        select(UserModel).where(UserModel.openid_sub == sub)
    )

    if existing_user:
        raise HTTPException(status_code=400, detail="User already exists")

    # Create new user
    user = UserModel(email=email, name=name, openid_sub=sub)
    session.add(user)
    await session.flush()  # Get the user ID

    # Determine onboarding action
    action = (request.team_action or "create").lower()
    team: TeamModel
    if action == "join":
        code = (request.join_code or "").strip().upper()
        if not code:
            raise HTTPException(status_code=400, detail="Missing join_code for team join")
        team_row = await session.scalar(select(TeamModel).where(TeamModel.join_code == code))
        if not team_row:
            raise HTTPException(status_code=404, detail="Invalid join code")
        team = team_row
        # Add user to the team as member
        team_member = TeamMemberModel(team_id=team.id, user_id=user.id, role="member")
        session.add(team_member)
    else:
        # Create a new team with unique name
        base_name = request.team_name or f"{name}'s Team"
        unique_name = await _ensure_unique_team_name(session, base_name)
        team = TeamModel(name=unique_name, join_code=_generate_join_code())
        session.add(team)
        await session.flush()
        # Add user as admin
        team_member = TeamMemberModel(team_id=team.id, user_id=user.id, role="admin")
        session.add(team_member)

    # Create API key for the team
    api_key_value = secrets.token_urlsafe(32)
    api_key_hash = hashlib.sha256(api_key_value.encode()).hexdigest()

    api_key = APIKeyModel(
        key_hash=api_key_hash,
        team_id=team.id,
        user_id=user.id,
        name=f"{name}'s API Key",
        is_admin=(email.lower() in settings.admin_emails) if email else False,
    )
    session.add(api_key)

    await session.commit()

    # Get user's teams
    # Determine role used when joining/creating above
    role = "admin" if action != "join" else "member"
    teams = [TeamResponse(id=str(team.id), name=team.name, role=role)]

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

    # Resolve identity
    if request.id_token and not settings.allow_any_api_key:
        claims = await _verify_google_id_token(request.id_token)
        if isinstance(claims, dict):
            openid_sub = str(claims.get("sub"))
        else:
            if not request.openid_sub:
                raise HTTPException(status_code=401, detail="Invalid ID token")
            openid_sub = str(request.openid_sub)
    else:
        if not request.openid_sub:
            raise HTTPException(status_code=400, detail="Missing openid_sub")
        openid_sub = str(request.openid_sub)

    # Find existing user
    user = await session.scalar(select(UserModel).where(UserModel.openid_sub == openid_sub))

    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    # Update user info if present and changed (best-effort)
    new_email = request.email or user.email
    new_name = request.name or user.name
    if user.email != new_email or user.name != new_name:
        user.email = new_email
        user.name = new_name
        await session.commit()

    # Get user's teams and create a fresh API key for the first team
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
    # Issue a new API key since originals are not retrievable from hashes
    # imports moved to module scope to satisfy import sorting rules
    team_id = team_row.id
    api_key_value = secrets.token_urlsafe(32)
    api_key_hash = hashlib.sha256(api_key_value.encode()).hexdigest()
    is_admin = (user.email.lower() in settings.admin_emails) if user.email else False
    new_key = APIKeyModel(
        key_hash=api_key_hash,
        team_id=team_id,
        user_id=user.id,
        name=f"Login key for {user.email}",
        is_admin=is_admin,
    )
    session.add(new_key)
    await session.commit()

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
    # Get user from API key (requires user_id on APIKey)
    user = await session.scalar(
        select(UserModel)
        .join(APIKeyModel, APIKeyModel.user_id == UserModel.id)
        .where(APIKeyModel.key_hash == api_key["key_hash"])
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Create new team
    # Create with a fresh join code
    team = TeamModel(name=request.name, join_code=_generate_join_code())
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
    side: Literal["buy", "sell"] | None = None


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

    # Subqueries to get orders for this team
    buyer_orders = select(OrderModel.id).where(OrderModel.team_id == team.id).subquery()
    seller_orders = select(OrderModel.id).where(OrderModel.team_id == team.id).subquery()

    stmt = select(
        TradeModel.id,
        SymbolModel.symbol,
        TradeModel.quantity,
        TradeModel.price,
        TradeModel.executed_at,
        TradeModel.buyer_order_id,
        TradeModel.seller_order_id,
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
    # Build a set of this team's order IDs to infer trade side quickly
    res_ids = await session.execute(
        select(OrderModel.id).where(OrderModel.team_id == team.id)
    )
    team_order_ids = set(res_ids.scalars().all())
    trades = []
    for r in rows:
        side: Literal["buy", "sell"] | None
        if r.buyer_order_id in team_order_ids:
            side = "buy"
        elif r.seller_order_id in team_order_ids:
            side = "sell"
        else:
            side = None
        trades.append(
            TradeRecord(
                trade_id=str(r.id),
                symbol=r.symbol,
                quantity=r.quantity,
                price=float(r.price),
                executed_at=r.executed_at,
                side=side,
            )
        )
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


@api_router.get("/symbols", response_model=SymbolsResponse)
async def get_symbols(api_key: RequireAPIKey, session: DbSession) -> SymbolsResponse:
    rows = (await session.execute(select(SymbolModel.symbol, SymbolModel.name))).all()
    return SymbolsResponse(symbols=[SymbolInfo(symbol=s, name=n) for s, n in rows])


# Team settings endpoints
@api_router.get("/teams/me", response_model=TeamSettingsOut)
async def get_team_settings(api_key: RequireAPIKey, session: DbSession) -> TeamSettingsOut:
    team = await _get_team_by_id(session, api_key["team_id"])
    # Determine calling user via API key
    user = await session.scalar(
        select(UserModel)
        .join(APIKeyModel, APIKeyModel.user_id == UserModel.id)
        .where(APIKeyModel.key_hash == api_key["key_hash"])
    )
    # Membership role
    role = "member"
    if user:
        tm = await session.scalar(
            select(TeamMemberModel)
            .where(TeamMemberModel.team_id == team.id, TeamMemberModel.user_id == user.id)
        )
        if tm:
            role = tm.role
    # Members list
    member_rows = (
        await session.execute(
            select(UserModel.id, UserModel.email, UserModel.name, TeamMemberModel.role)
            .join(TeamMemberModel, TeamMemberModel.user_id == UserModel.id)
            .where(TeamMemberModel.team_id == team.id)
        )
    ).all()
    members = [
        TeamMemberOut(id=str(r.id), email=r.email, name=r.name, role=r.role) for r in member_rows
    ]
    return TeamSettingsOut(
        id=str(team.id),
        name=team.name,
        join_code=team.join_code,
        role=role,
        members=members,
    )


class TeamNameIn(BaseModel):
    name: str


def _is_owner(role: str) -> bool:
    return role == "admin"


@api_router.post("/teams/me/name")
async def update_team_name(
    payload: TeamNameIn, api_key: RequireAPIKey, session: DbSession
) -> dict[str, str]:
    team = await _get_team_by_id(session, api_key["team_id"])
    # Identify user and role
    user = await session.scalar(
        select(UserModel)
        .join(APIKeyModel, APIKeyModel.user_id == UserModel.id)
        .where(APIKeyModel.key_hash == api_key["key_hash"])
    )
    if not user:
        raise HTTPException(status_code=403, detail="User not found for API key")
    tm = await session.scalar(
        select(TeamMemberModel).where(
            TeamMemberModel.team_id == team.id, TeamMemberModel.user_id == user.id
        )
    )
    if not tm or not _is_owner(tm.role):
        raise HTTPException(status_code=403, detail="Only team owner can update name")
    unique = await _ensure_unique_team_name(session, payload.name)
    team.name = unique
    session.add(team)
    await session.commit()
    return {"status": "ok"}


@api_router.post("/teams/me/rotate-code")
async def rotate_join_code(api_key: RequireAPIKey, session: DbSession) -> dict[str, str]:
    team = await _get_team_by_id(session, api_key["team_id"])
    user = await session.scalar(
        select(UserModel)
        .join(APIKeyModel, APIKeyModel.user_id == UserModel.id)
        .where(APIKeyModel.key_hash == api_key["key_hash"])
    )
    if not user:
        raise HTTPException(status_code=403, detail="User not found for API key")
    tm = await session.scalar(
        select(TeamMemberModel).where(
            TeamMemberModel.team_id == team.id, TeamMemberModel.user_id == user.id
        )
    )
    if not tm or not _is_owner(tm.role):
        raise HTTPException(status_code=403, detail="Only team owner can rotate code")
    team.join_code = secrets.token_urlsafe(6).replace("-", "").replace("_", "").upper()[:8]
    session.add(team)
    await session.commit()
    return {"join_code": team.join_code}


@api_router.delete("/teams/me/members/{user_id}")
async def remove_member(user_id: str, api_key: RequireAPIKey, session: DbSession) -> dict[str, str]:
    team = await _get_team_by_id(session, api_key["team_id"])
    # Acting user
    actor = await session.scalar(
        select(UserModel)
        .join(APIKeyModel, APIKeyModel.user_id == UserModel.id)
        .where(APIKeyModel.key_hash == api_key["key_hash"])
    )
    if not actor:
        raise HTTPException(status_code=403, detail="User not found for API key")
    actor_tm = await session.scalar(
        select(TeamMemberModel).where(
            TeamMemberModel.team_id == team.id, TeamMemberModel.user_id == actor.id
        )
    )
    if not actor_tm or not _is_owner(actor_tm.role):
        raise HTTPException(status_code=403, detail="Only team owner can remove members")
    # Prevent removing self if only owner
    target_id: _Any
    try:
        target_id = _uuid.UUID(user_id)
    except Exception:
        target_id = user_id
    if target_id == actor.id:
        raise HTTPException(status_code=400, detail="Owner cannot remove self")
    # Remove membership
    row = await session.scalar(
        select(TeamMemberModel).where(
            TeamMemberModel.team_id == team.id, TeamMemberModel.user_id == target_id
        )
    )
    if not row:
        raise HTTPException(status_code=404, detail="Member not found")
    await session.execute(
        delete(TeamMemberModel).where(
            TeamMemberModel.team_id == team.id, TeamMemberModel.user_id == target_id
        )
    )
    await session.commit()
    return {"status": "removed"}


# Team API Keys management
class TeamAPIKeyOut(BaseModel):
    id: str
    name: str
    created_at: datetime
    last_used: datetime | None = None
    is_active: bool


class TeamAPIKeyCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class TeamAPIKeyCreateOut(BaseModel):
    id: str
    name: str
    created_at: datetime
    api_key: str


async def _require_team_owner(session: AsyncSession, team_id: _Any, api_key_hash: str) -> tuple[TeamModel, UserModel]:
    team = await _get_team_by_id(session, team_id)
    user = await session.scalar(
        select(UserModel)
        .join(APIKeyModel, APIKeyModel.user_id == UserModel.id)
        .where(APIKeyModel.key_hash == api_key_hash)
    )
    if not user:
        raise HTTPException(status_code=403, detail="User not found for API key")
    tm = await session.scalar(
        select(TeamMemberModel).where(
            TeamMemberModel.team_id == team.id, TeamMemberModel.user_id == user.id
        )
    )
    if not tm or not _is_owner(tm.role):
        raise HTTPException(status_code=403, detail="Only team owner can manage API keys")
    return team, user


@api_router.get("/teams/me/api-keys", response_model=list[TeamAPIKeyOut])
async def list_team_api_keys(api_key: RequireAPIKey, session: DbSession) -> list[TeamAPIKeyOut]:
    team, _user = await _require_team_owner(session, api_key["team_id"], api_key["key_hash"])
    rows = (
        await session.execute(
            select(APIKeyModel).where(APIKeyModel.team_id == team.id).order_by(APIKeyModel.created_at.asc())
        )
    ).scalars().all()
    out: list[TeamAPIKeyOut] = []
    for r in rows:
        out.append(
            TeamAPIKeyOut(
                id=str(r.id),
                name=r.name,
                created_at=r.created_at,
                last_used=r.last_used,
                is_active=r.is_active,
            )
        )
    return out


@api_router.post("/teams/me/api-keys", response_model=TeamAPIKeyCreateOut)
async def create_team_api_key(
    payload: TeamAPIKeyCreateIn, api_key: RequireAPIKey, session: DbSession
) -> TeamAPIKeyCreateOut:
    team, user = await _require_team_owner(session, api_key["team_id"], api_key["key_hash"])
    # Create a new API key for this team
    import secrets
    import hashlib

    api_key_value = secrets.token_urlsafe(32)
    api_key_hash = hashlib.sha256(api_key_value.encode()).hexdigest()

    new_row = APIKeyModel(
        key_hash=api_key_hash,
        team_id=team.id,
        user_id=user.id,
        name=payload.name,
        is_admin=False,
    )
    session.add(new_row)
    await session.commit()
    return TeamAPIKeyCreateOut(
        id=str(new_row.id), name=new_row.name, created_at=new_row.created_at, api_key=api_key_value
    )


@api_router.delete("/teams/me/api-keys/{key_id}")
async def revoke_team_api_key(key_id: str, api_key: RequireAPIKey, session: DbSession) -> dict[str, str]:
    team, _user = await _require_team_owner(session, api_key["team_id"], api_key["key_hash"])
    # Parse id
    _kid: _Any
    try:
        _kid = _uuid.UUID(str(key_id))
    except Exception:
        _kid = key_id
    row = await session.get(APIKeyModel, _kid)
    if not row or row.team_id != team.id:
        raise HTTPException(status_code=404, detail="API key not found")
    # Soft-revoke
    row.is_active = False
    session.add(row)
    await session.commit()
    return {"status": "revoked", "id": str(row.id)}


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
    await _exchange.ensure_symbol_loaded(session, symbol)
    bids, asks = _exchange.get_orderbook_levels(symbol, depth=depth)
    bid_levels = [OrderBookLevel(price=p, quantity=q) for p, q in bids]
    ask_levels = [OrderBookLevel(price=p, quantity=q) for p, q in asks]
    return OrderBookResponse(symbol=symbol, bids=bid_levels, asks=ask_levels, last_update=now)


# Admin router for basic CRUD
admin_router = APIRouter(prefix="/api/v1/admin", dependencies=[Depends(require_admin)])


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

    # Cascade-delete this symbol and any derivatives (underlyings)
    from src.db.models import PositionLimit as PositionLimitModel
    from src.db.models import TradingHours as TradingHoursModel  # local import

    # Collect all symbol ids to delete (this symbol + derived chain)
    to_delete: list[Any] = []
    stack: list[Any] = [row.id]
    while stack:
        sid = stack.pop()
        to_delete.append(sid)
        child_ids = (
            await session.execute(select(SymbolModel.id).where(SymbolModel.underlying_id == sid))
        ).scalars().all()
        stack.extend(child_ids)

    if to_delete:
        # Delete dependent rows in FK-safe order
        await session.execute(delete(TradeModel).where(TradeModel.symbol_id.in_(to_delete)))
        await session.execute(delete(OrderModel).where(OrderModel.symbol_id.in_(to_delete)))
        await session.execute(
            delete(PositionModel).where(PositionModel.symbol_id.in_(to_delete))
        )
        await session.execute(
            delete(MarketDataModel).where(MarketDataModel.symbol_id.in_(to_delete))
        )
        await session.execute(
            delete(TradingHoursModel).where(TradingHoursModel.symbol_id.in_(to_delete))
        )
        await session.execute(
            delete(PositionLimitModel).where(PositionLimitModel.symbol_id.in_(to_delete))
        )
        await session.execute(delete(SymbolModel).where(SymbolModel.id.in_(to_delete)))
        await session.commit()
    return {"status": "deleted"}


@admin_router.post("/reset-exchange")
async def reset_exchange(session: DbSession) -> dict[str, str]:
    """Purge all exchange data: orders, trades, positions, market data, limits, hours, symbols."""
    from src.db.models import PositionLimit as PositionLimitModel
    from src.db.models import TradingHours as TradingHoursModel

    await session.execute(delete(TradeModel))
    await session.execute(delete(OrderModel))
    await session.execute(delete(PositionModel))
    await session.execute(delete(MarketDataModel))
    await session.execute(delete(TradingHoursModel))
    await session.execute(delete(PositionLimitModel))
    await session.execute(delete(SymbolModel))
    await session.commit()
    return {"status": "ok"}


@admin_router.post("/reset-users")
async def reset_users(session: DbSession) -> dict[str, str]:
    """Purge all user/team data and their related records."""
    from src.db.models import Competition as CompetitionModel
    from src.db.models import CompetitionTeam as CompetitionTeamModel

    # Remove team-related trading records first
    await session.execute(delete(TradeModel))
    await session.execute(delete(OrderModel))
    await session.execute(delete(PositionModel))
    # Remove competitions/team links
    await session.execute(delete(CompetitionTeamModel))
    await session.execute(delete(APIKeyModel))
    await session.execute(delete(TeamMemberModel))
    await session.execute(delete(TeamModel))
    await session.execute(delete(UserModel))
    # Optionally clear competitions as well
    await session.execute(delete(CompetitionModel))
    await session.commit()
    return {"status": "ok"}


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
    team = TeamModel(name=payload.name, join_code=_generate_join_code())
    session.add(team)
    await session.commit()
    return {"id": str(team.id)}


@admin_router.get("/teams")
async def list_teams(session: DbSession) -> list[dict[str, Any]]:
    rows = (await session.execute(select(TeamModel.id, TeamModel.name, TeamModel.join_code))).all()
    return [{"id": str(r.id), "name": r.name, "join_code": r.join_code} for r in rows]


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


@admin_router.get("/symbols")
async def admin_list_symbols(session: DbSession) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            select(
                SymbolModel.symbol,
                SymbolModel.name,
                SymbolModel.trading_halted,
                SymbolModel.settlement_active,
                SymbolModel.settlement_price,
            )
        )
    ).all()
    out: list[dict[str, Any]] = []
    for r in rows:
        out.append(
            {
                "symbol": r.symbol,
                "name": r.name,
                "trading_halted": r.trading_halted,
                "settlement_active": r.settlement_active,
                "settlement_price": (
                    float(r.settlement_price) if r.settlement_price is not None else None
                ),
            }
        )
    return out


# Admin: Trading controls
class TradingActionIn(BaseModel):
    symbol: str | None = None


@admin_router.post("/symbols/pause")
async def admin_pause_symbols(payload: TradingActionIn, session: DbSession) -> dict[str, str]:
    q = select(SymbolModel)
    if payload.symbol:
        q = q.where(SymbolModel.symbol == payload.symbol)
    rows = (await session.execute(q)).scalars().all()
    for s in rows:
        s.trading_halted = True
        session.add(s)
    await session.commit()
    return {"status": "paused"}


@admin_router.post("/symbols/start")
async def admin_start_symbols(payload: TradingActionIn, session: DbSession) -> dict[str, str]:
    q = select(SymbolModel)
    if payload.symbol:
        q = q.where(SymbolModel.symbol == payload.symbol)
    rows = (await session.execute(q)).scalars().all()
    for s in rows:
        s.trading_halted = False
        # clear settlement state when starting
        s.settlement_active = False
        s.settlement_price = None
        s.settlement_at = None
        session.add(s)
    await session.commit()
    return {"status": "started"}


class SettleIn(BaseModel):
    symbol: str
    price: float


@admin_router.post("/symbols/settle")
async def admin_settle_symbol(payload: SettleIn, session: DbSession) -> dict[str, str]:
    sym = await session.scalar(select(SymbolModel).where(SymbolModel.symbol == payload.symbol))
    if not sym:
        raise HTTPException(status_code=404, detail="Symbol not found")
    # Mark as settled and halted
    sym.trading_halted = True
    sym.settlement_active = True
    sym.settlement_price = payload.price
    sym.settlement_at = datetime.utcnow()
    session.add(sym)
    # Convert open positions to realized PnL at settlement price
    pos_rows = (
        await session.execute(select(PositionModel).where(PositionModel.symbol_id == sym.id))
    ).scalars().all()
    for pos in pos_rows:
        qty = pos.quantity
        avg = float(pos.average_price) if pos.average_price is not None else None
        if qty == 0 or avg is None:
            continue
        price = float(payload.price)
        pnl_add = (price - avg) * qty if qty > 0 else (avg - price) * -qty
        pos.realized_pnl = float(pos.realized_pnl or 0) + pnl_add
        pos.quantity = 0
        pos.average_price = None
        session.add(pos)
    await session.commit()
    return {"status": "settled"}


# Admin: Users management
class UserAdminOut(BaseModel):
    id: str
    email: str
    name: str
    is_admin: bool


class SetAdminIn(BaseModel):
    is_admin: bool


@admin_router.get("/users", response_model=list[UserAdminOut])
async def admin_list_users(session: DbSession) -> list[UserAdminOut]:
    # Determine admin if any API key for user's teams is admin
    rows = (
        await session.execute(select(UserModel.id, UserModel.email, UserModel.name))
    ).all()
    out: list[UserAdminOut] = []
    for r in rows:
        teams = (
            await session.execute(
                select(TeamMemberModel.team_id).where(TeamMemberModel.user_id == r.id)
            )
        ).scalars().all()
        if not teams:
            is_admin = False
        else:
            admin_key = await session.scalar(
                select(APIKeyModel.id).where(
                    APIKeyModel.team_id.in_(teams), APIKeyModel.is_admin.is_(True)
                )
            )
            is_admin = admin_key is not None
        out.append(
            UserAdminOut(id=str(r.id), email=r.email, name=r.name, is_admin=is_admin)
        )
    return out


@admin_router.post("/users/{user_id}/admin")
async def admin_set_user_admin(
    user_id: str, payload: SetAdminIn, session: DbSession
) -> dict[str, str]:
    # Set is_admin for API keys of all teams the user belongs to
    _uid: _Any
    try:
        _uid = _uuid.UUID(str(user_id))
    except Exception:
        _uid = user_id
    user = await session.get(UserModel, _uid)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    team_ids = (
        await session.execute(
            select(TeamMemberModel.team_id).where(TeamMemberModel.user_id == user.id)
        )
    ).scalars().all()
    if team_ids:
        keys = (
            await session.execute(
                select(APIKeyModel).where(APIKeyModel.team_id.in_(team_ids))
            )
        ).scalars().all()
        for k in keys:
            k.is_admin = payload.is_admin
            session.add(k)
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
                        bids_payload: list[dict[str, float | int]] = []
                        asks_payload: list[dict[str, float | int]] = []
                        if "orderbook" in msg.channels or "quotes" in msg.channels:
                            await _exchange.ensure_symbol_loaded(session, symbol)
                            bids_levels, asks_levels = _exchange.get_orderbook_levels(symbol)
                            bids_payload = [
                                {"price": price, "quantity": quantity}
                                for price, quantity in bids_levels
                            ]
                            asks_payload = [
                                {"price": price, "quantity": quantity}
                                for price, quantity in asks_levels
                            ]

                        if "orderbook" in msg.channels:
                            await ws.send_json({
                                "type": "orderbook",
                                "symbol": symbol,
                                "bids": bids_payload,
                                "asks": asks_payload,
                                "timestamp": datetime.now(tz=UTC).isoformat()
                            })

                        if "quotes" in msg.channels and (bids_payload or asks_payload):
                            await ws.send_json({
                                "type": "quote",
                                "symbol": symbol,
                                "bid": bids_payload[0]["price"] if bids_payload else 0,
                                "ask": asks_payload[0]["price"] if asks_payload else 0,
                                "bid_size": bids_payload[0]["quantity"] if bids_payload else 0,
                                "ask_size": asks_payload[0]["quantity"] if asks_payload else 0,
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
