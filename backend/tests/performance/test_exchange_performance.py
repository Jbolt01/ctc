from __future__ import annotations

import asyncio
import random
import statistics
import time
import uuid
from dataclasses import dataclass
from typing import Generator, Sequence

import pytest
from pytest_benchmark.fixture import BenchmarkFixture
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from src.db.models import Base, Order as OrderModel, Symbol, Team
from src.exchange.engine import MatchingEngine, SimpleOrder
from src.exchange.manager import ExchangeManager


RANDOM_SEED = 0xC0FFEE

pytestmark = pytest.mark.filterwarnings(
    r"ignore:datetime.datetime.utcnow\(\) is deprecated:DeprecationWarning"
)


@dataclass(frozen=True)
class OrderSpec:
    """Immutable description of an order used by the performance harness."""

    order_id: str
    side: str
    quantity: int
    price: float | None
    team_id: str

    def to_simple(self) -> SimpleOrder:
        return SimpleOrder(
            order_id=self.order_id,
            side=self.side,
            quantity=self.quantity,
            price=self.price,
            team_id=self.team_id,
        )


@dataclass
class ExchangePerfEnv:
    """Pre-built in-memory exchange fixtures for manager performance tests."""

    engine: AsyncEngine
    session_factory: async_sessionmaker[AsyncSession]
    symbol_code: str
    symbol_id: uuid.UUID
    team_ids: list[uuid.UUID]


def _build_book_specs(
    *,
    book_size: int,
    price_start: float,
    price_step: float,
    team_ids: Sequence[str],
) -> list[OrderSpec]:
    rng = random.Random(RANDOM_SEED + book_size)
    specs: list[OrderSpec] = []
    midpoint = price_start
    for idx in range(book_size):
        side = "buy" if idx % 2 == 0 else "sell"
        distance = (idx // 2) + 1
        offset = distance * price_step
        price = midpoint - offset if side == "buy" else midpoint + offset
        qty = rng.randint(10, 500)
        specs.append(
            OrderSpec(
                order_id=f"R{idx}",
                side=side,
                quantity=qty,
                price=round(price, 2),
                team_id=team_ids[idx % len(team_ids)],
            )
        )
    return specs


def _build_incoming_specs(
    *,
    order_count: int,
    price_start: float,
    price_variance: float,
    team_ids: Sequence[str],
) -> list[OrderSpec]:
    rng = random.Random(RANDOM_SEED + order_count * 13)
    specs: list[OrderSpec] = []
    for idx in range(order_count):
        side = "buy" if rng.random() < 0.5 else "sell"
        is_market = rng.random() < 0.25
        variance = rng.random() * price_variance
        price = None if is_market else round(price_start + (variance if side == "buy" else -variance), 2)
        quantity = rng.randint(5, 800)
        specs.append(
            OrderSpec(
                order_id=f"I{idx}",
                side=side,
                quantity=quantity,
                price=price,
                team_id=team_ids[idx % len(team_ids)],
            )
        )
    return specs


@pytest.fixture(scope="session")
def exchange_perf_env() -> Generator[ExchangePerfEnv, None, None]:
    async def _create_env() -> ExchangePerfEnv:
        engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        session_factory = async_sessionmaker(bind=engine, expire_on_commit=False)
        async with session_factory() as session:
            symbol = Symbol(symbol="PERF", name="Performance", symbol_type="equity")
            teams = [
                Team(name=f"Perf Team {idx}", join_code=f"PERF{idx:04d}") for idx in range(12)
            ]
            session.add(symbol)
            session.add_all(teams)
            await session.flush()

            rng = random.Random(RANDOM_SEED)
            midpoint = 100.0
            price_step = 0.05
            for idx in range(2000):
                side = "buy" if idx % 2 == 0 else "sell"
                distance = (idx // 2) + 1
                offset = distance * price_step
                price = midpoint - offset if side == "buy" else midpoint + offset
                order = OrderModel(
                    team_id=teams[idx % len(teams)].id,
                    symbol_id=symbol.id,
                    side=side,
                    order_type="limit",
                    quantity=rng.randint(10, 250),
                    price=round(price, 2),
                    filled_quantity=0,
                    status="pending",
                )
                session.add(order)
            await session.commit()
            return ExchangePerfEnv(
                engine=engine,
                session_factory=session_factory,
                symbol_code=symbol.symbol,
                symbol_id=symbol.id,
                team_ids=[team.id for team in teams],
            )

    env = asyncio.run(_create_env())
    try:
        yield env
    finally:
        asyncio.run(env.engine.dispose())


def _compute_latency_stats(latencies: list[float]) -> dict[str, float]:
    if not latencies:
        return {"count": 0.0, "p50_ms": 0.0, "p95_ms": 0.0, "max_ms": 0.0}
    latencies_ms = [value * 1_000 for value in latencies]
    p95 = statistics.quantiles(latencies_ms, n=100, method="inclusive")[94] if len(latencies_ms) >= 20 else max(latencies_ms)
    return {
        "count": float(len(latencies_ms)),
        "p50_ms": statistics.median(latencies_ms),
        "p95_ms": p95,
        "max_ms": max(latencies_ms),
    }


@pytest.mark.performance
@pytest.mark.parametrize("incoming_orders", [1500, 5000])
def test_matching_engine_limit_book_build_performance(
    benchmark: BenchmarkFixture, incoming_orders: int
) -> None:
    team_ids = [f"team-{idx}" for idx in range(16)]
    resting_specs = _build_book_specs(
        book_size=4000,
        price_start=100.0,
        price_step=0.05,
        team_ids=team_ids,
    )
    incoming_specs = _build_incoming_specs(
        order_count=incoming_orders,
        price_start=100.0,
        price_variance=0.5,
        team_ids=team_ids,
    )

    def _scenario() -> dict[str, object]:
        engine = MatchingEngine()
        for spec in resting_specs:
            engine.add_resting_order(spec.to_simple())

        latencies: list[float] = []
        trades = 0
        traded_volume = 0
        for spec in incoming_specs:
            simple = spec.to_simple()
            start = time.perf_counter()
            trade_results, _ = engine.add_order(simple)
            latency = time.perf_counter() - start
            latencies.append(latency)
            trades += len(trade_results)
            traded_volume += sum(t.quantity for t in trade_results)

        total_time = sum(latencies) or 1e-9
        throughput = len(latencies) / total_time

        return {
            "throughput_ops": throughput,
            "trades": float(trades),
            "traded_volume": float(traded_volume),
            "remaining_bids": float(len(engine.bids)),
            "remaining_asks": float(len(engine.asks)),
            "latency_series": latencies,
        }

    stats = benchmark.pedantic(_scenario, rounds=3, warmup_rounds=1)
    latencies = list(stats.pop("latency_series", []))
    latency_meta = _compute_latency_stats(latencies)
    fill_ratio = (stats["trades"] / incoming_orders) if incoming_orders else 0.0
    avg_trade_size = (
        stats["traded_volume"] / stats["trades"] if stats["trades"] else 0.0
    )

    benchmark.extra_info.update({
        "scenario": "limit_book_build",
        "incoming_orders": incoming_orders,
        **stats,
        **latency_meta,
        "fill_ratio": fill_ratio,
        "avg_trade_size": avg_trade_size,
    })

    assert stats["trades"] >= 0
    assert stats["remaining_bids"] >= 0
    assert stats["remaining_asks"] >= 0


@pytest.mark.performance
@pytest.mark.parametrize("sweep_size", [1000, 2500])
def test_matching_engine_market_sweep(
    benchmark: BenchmarkFixture, sweep_size: int
) -> None:
    team_ids = [f"team-{idx}" for idx in range(8)]
    resting_specs = _build_book_specs(
        book_size=6000,
        price_start=100.0,
        price_step=0.02,
        team_ids=team_ids,
    )
    sweep_specs = [
        OrderSpec(
            order_id=f"M{idx}",
            side="buy" if idx % 2 == 0 else "sell",
            quantity=400 + (idx % 5) * 20,
            price=None,
            team_id=team_ids[idx % len(team_ids)],
        )
        for idx in range(sweep_size)
    ]

    def _scenario() -> dict[str, object]:
        engine = MatchingEngine()
        for spec in resting_specs:
            engine.add_resting_order(spec.to_simple())

        latencies: list[float] = []
        depth_consumed = 0
        for spec in sweep_specs:
            start = time.perf_counter()
            trades, cancels = engine.add_order(spec.to_simple())
            latency = time.perf_counter() - start
            latencies.append(latency)
            depth_consumed += sum(trade.quantity for trade in trades)
            depth_consumed += sum(cancel.quantity for cancel in cancels)

        total_time = sum(latencies) or 1e-9
        return {
            "depth_consumed": float(depth_consumed),
            "latency_total": total_time,
            "orders_processed": float(len(sweep_specs)),
            "throughput_ops": len(sweep_specs) / total_time,
            "latency_series": latencies,
        }

    stats = benchmark.pedantic(_scenario, rounds=3, warmup_rounds=1)
    latency_stats = _compute_latency_stats(list(stats.pop("latency_series", [])))
    avg_depth_per_order = (
        stats["depth_consumed"] / stats["orders_processed"]
        if stats["orders_processed"]
        else 0.0
    )

    benchmark.extra_info.update({
        "scenario": "market_sweep",
        "sweep_size": sweep_size,
        **stats,
        **latency_stats,
        "avg_depth_per_order": avg_depth_per_order,
    })
    assert stats["depth_consumed"] > 0


@pytest.mark.performance
def test_exchange_manager_place_and_match_performance(
    benchmark: BenchmarkFixture, exchange_perf_env: ExchangePerfEnv
) -> None:
    team_cycle = exchange_perf_env.team_ids
    symbol_code = exchange_perf_env.symbol_code

    async def _scenario_async() -> dict[str, object]:
        manager = ExchangeManager()
        latencies: list[float] = []
        trades_recorded = 0
        pnl_events = 0
        async with exchange_perf_env.session_factory() as session:
            await manager.load_open_orders(session, symbol_code=symbol_code)
            for idx in range(600):
                order_model = OrderModel(
                    team_id=team_cycle[idx % len(team_cycle)],
                    symbol_id=exchange_perf_env.symbol_id,
                    side="buy" if idx % 2 == 0 else "sell",
                    order_type="limit",
                    quantity=400 + (idx % 5) * 25,
                    price=100.0 + (idx % 10) * 0.05,
                    filled_quantity=0,
                    status="pending",
                )
                session.add(order_model)
                await session.flush()

                start = time.perf_counter()
                trades = await manager.place_and_match(
                    session, db_order=order_model, symbol_code=symbol_code
                )
                latency = time.perf_counter() - start
                latencies.append(latency)
                trades_recorded += len(trades)
                pnl_events += sum(t.quantity for t in trades)

            await session.rollback()

        return {
            "orders_processed": float(len(latencies)),
            "latency_series": latencies,
            "trades_recorded": float(trades_recorded),
            "pnl_events": float(pnl_events),
        }

    def _scenario() -> dict[str, object]:
        return asyncio.run(_scenario_async())

    stats = benchmark.pedantic(_scenario, rounds=3, warmup_rounds=1)
    latency_stats = _compute_latency_stats(list(stats.pop("latency_series", [])))
    avg_trades_per_order = (
        stats["trades_recorded"] / stats["orders_processed"]
        if stats["orders_processed"]
        else 0.0
    )

    benchmark.extra_info.update({
        "scenario": "manager_place_and_match",
        **stats,
        **latency_stats,
        "avg_trades_per_order": avg_trades_per_order,
    })
    assert stats["orders_processed"] == 600


@pytest.mark.performance
def test_exchange_manager_load_open_orders_scaling(
    benchmark: BenchmarkFixture, exchange_perf_env: ExchangePerfEnv
) -> None:
    async def _scenario_async() -> dict[str, float]:
        manager = ExchangeManager()
        async with exchange_perf_env.session_factory() as session:
            start = time.perf_counter()
            await manager.load_open_orders(session)
            latency = time.perf_counter() - start
            await session.rollback()
        return {
            "books_tracked": float(len(manager._books)),
            "latency": latency,
        }

    def _scenario() -> dict[str, float]:
        return asyncio.run(_scenario_async())

    stats = benchmark.pedantic(_scenario, rounds=5, warmup_rounds=1)
    benchmark.extra_info.update({
        "scenario": "manager_load_open_orders",
        **stats,
    })
    assert stats["books_tracked"] >= 1
