from __future__ import annotations

import asyncio
import uuid
from unittest.mock import AsyncMock

import pytest

from src.core.orders import OrderService
from src.db import session as session_mod
from src.db.models import Position, PositionLimit, Team


def test_place_order_does_not_commit_session(test_app, monkeypatch) -> None:
    async def _run() -> None:
        async with session_mod.SessionLocal() as session:
            team = Team(name="Team Perf", join_code="TPERF123")
            session.add(team)
            await session.commit()
            await session.refresh(team)

            service = OrderService(session)

            async def _fail_commit() -> None:  # pragma: no cover - trigger if called
                raise AssertionError("OrderService.place_order must not commit the session")

            monkeypatch.setattr(session, "commit", _fail_commit)

            order, _ = await service.place_order(
                team_id=team.id,
                symbol_code="AAPL",
                side="buy",
                order_type="limit",
                quantity=10,
                price=101.0,
            )

            assert order.id is not None
            assert order.status == "pending"

    asyncio.run(_run())


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "limit_max_pos, limit_max_ord, current_pos, side, quantity, expected_qty, expected_msg",
    [
        # No limit
        (None, None, 0, "buy", 100, 100, None),
        # Cap by max_order_size
        (1000, 50, 0, "buy", 100, 50, "capped from 100 to 50"),
        # Cap by max_position (long)
        (100, 200, 80, "buy", 50, 20, "capped from 50 to 20"),
        # Cap by max_position (short)
        (100, 200, -80, "sell", 50, 20, "capped from 50 to 20"),
        # Fully blocked by position limit
        (100, 200, 100, "buy", 50, 0, "capped from 50 to 0"),
        # No capping needed
        (100, 100, 50, "buy", 50, 50, None),
        # Cap by max_order_size first, then by max_position
        (100, 70, 50, "buy", 100, 50, "capped from 100 to 50"),
        # Sell order within limits
        (100, 100, 50, "sell", 50, 50, None),
        # Sell order to open short position
        (100, 100, 0, "sell", 50, 50, None),
    ],
)
async def test_apply_position_limits(
    limit_max_pos, limit_max_ord, current_pos, side, quantity, expected_qty, expected_msg
):
    mock_session = AsyncMock()
    service = OrderService(mock_session)

    # Setup mock return values for session.scalar
    mock_limit = None
    if limit_max_pos is not None:
        mock_limit = PositionLimit(max_position=limit_max_pos, max_order_size=limit_max_ord)

    mock_position = Position(quantity=current_pos) if current_pos is not None else None

    mock_session.scalar.side_effect = [mock_limit, mock_position]

    # Call the method
    capped_quantity, message = await service._apply_position_limits(
        team_id=uuid.uuid4(),
        symbol_id=uuid.uuid4(),
        side=side,
        quantity=quantity,
    )

    # Assertions
    assert capped_quantity == expected_qty
    if expected_msg:
        assert expected_msg in message
    else:
        assert message is None
