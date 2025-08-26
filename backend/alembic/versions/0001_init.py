from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

from alembic import op

# revision identifiers, used by Alembic.
revision = "0001_init"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto;")

    op.create_table(
        "users",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("openid_sub", sa.String(255), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "teams",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "team_members",
        sa.Column("team_id", pg.UUID(as_uuid=True), sa.ForeignKey("teams.id"), primary_key=True),
        sa.Column("user_id", pg.UUID(as_uuid=True), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("role", sa.String(50), nullable=False),
    )

    op.create_table(
        "api_keys",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("key_hash", sa.String(255), nullable=False, unique=True),
        sa.Column("team_id", pg.UUID(as_uuid=True), sa.ForeignKey("teams.id")),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("is_admin", sa.Boolean(), default=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("last_used", sa.DateTime(), nullable=True),
        sa.Column("is_active", sa.Boolean(), default=True),
    )

    op.create_table(
        "symbols",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("symbol", sa.String(20), nullable=False, unique=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("symbol_type", sa.String(50), nullable=False),
        sa.Column("underlying_id", pg.UUID(as_uuid=True), sa.ForeignKey("symbols.id")),
        sa.Column("is_active", sa.Boolean(), default=True),
        sa.Column("tick_size", sa.Numeric(10, 6), default=0.01),
        sa.Column("lot_size", sa.Integer(), default=1),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "trading_hours",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("symbol_id", pg.UUID(as_uuid=True), sa.ForeignKey("symbols.id")),
        sa.Column("day_of_week", sa.Integer(), nullable=False),
        sa.Column("open_time", sa.String(8), nullable=False),
        sa.Column("close_time", sa.String(8), nullable=False),
        sa.Column("is_active", sa.Boolean(), default=True),
    )

    op.create_table(
        "position_limits",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("symbol_id", pg.UUID(as_uuid=True), sa.ForeignKey("symbols.id")),
        sa.Column("max_position", sa.Integer(), nullable=False),
        sa.Column("max_order_size", sa.Integer(), nullable=False),
        sa.Column("applies_to_admin", sa.Boolean(), default=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "orders",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("team_id", pg.UUID(as_uuid=True), sa.ForeignKey("teams.id")),
        sa.Column("symbol_id", pg.UUID(as_uuid=True), sa.ForeignKey("symbols.id")),
        sa.Column("side", sa.String(10), nullable=False),
        sa.Column("order_type", sa.String(20), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("price", sa.Numeric(20, 6), nullable=True),
        sa.Column("filled_quantity", sa.Integer(), default=0),
        sa.Column("status", sa.String(20), default="pending"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "trades",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("buyer_order_id", pg.UUID(as_uuid=True), sa.ForeignKey("orders.id")),
        sa.Column("seller_order_id", pg.UUID(as_uuid=True), sa.ForeignKey("orders.id")),
        sa.Column("symbol_id", pg.UUID(as_uuid=True), sa.ForeignKey("symbols.id")),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("price", sa.Numeric(20, 6), nullable=False),
        sa.Column("executed_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "positions",
        sa.Column("team_id", pg.UUID(as_uuid=True), sa.ForeignKey("teams.id"), primary_key=True),
        sa.Column(
            "symbol_id", pg.UUID(as_uuid=True), sa.ForeignKey("symbols.id"), primary_key=True
        ),
        sa.Column("quantity", sa.Integer(), default=0),
        sa.Column("average_price", sa.Numeric(20, 6), nullable=True),
        sa.Column("realized_pnl", sa.Numeric(20, 6), default=0),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "market_data",
        sa.Column(
            "symbol_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("symbols.id"),
            primary_key=True,
        ),
        sa.Column("timestamp", sa.DateTime(), primary_key=True),
        sa.Column("open", sa.Numeric(20, 6), nullable=True),
        sa.Column("high", sa.Numeric(20, 6), nullable=True),
        sa.Column("low", sa.Numeric(20, 6), nullable=True),
        sa.Column("close", sa.Numeric(20, 6), nullable=True),
        sa.Column("volume", sa.Integer(), nullable=True),
    )

    op.create_table(
        "competitions",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("start_time", sa.DateTime(), nullable=False),
        sa.Column("end_time", sa.DateTime(), nullable=False),
        sa.Column("is_active", sa.Boolean(), default=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "competition_teams",
        sa.Column(
            "competition_id",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("competitions.id"),
            primary_key=True,
        ),
        sa.Column("team_id", pg.UUID(as_uuid=True), sa.ForeignKey("teams.id"), primary_key=True),
        sa.Column("starting_capital", sa.Numeric(20, 6), default=1_000_000),
    )


def downgrade() -> None:
    op.drop_table("competition_teams")
    op.drop_table("competitions")
    op.drop_table("market_data")
    op.drop_table("positions")
    op.drop_table("trades")
    op.drop_table("orders")
    op.drop_table("position_limits")
    op.drop_table("trading_hours")
    op.drop_table("symbols")
    op.drop_table("api_keys")
    op.drop_table("team_members")
    op.drop_table("teams")
    op.drop_table("users")

