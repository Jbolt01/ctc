from __future__ import annotations

import asyncio

from src.core.orders import OrderService
from src.db import session as session_mod
from src.db.models import Team


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

            order = await service.place_order(
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
