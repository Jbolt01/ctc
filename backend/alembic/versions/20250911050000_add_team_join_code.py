from __future__ import annotations

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20250911050000_add_team_join_code"
down_revision = "20250910120000_add_trading_controls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) Add column as nullable (so we can backfill)
    op.add_column("teams", sa.Column("join_code", sa.String(length=16), nullable=True))
    # 2) Backfill existing rows with deterministic code from UUID (first 8 hex, uppercased)
    #    Using PostgreSQL string functions
    op.execute(
        """
        UPDATE teams
        SET join_code = UPPER(SUBSTRING(REPLACE(id::text, '-', '') FROM 1 FOR 8))
        WHERE join_code IS NULL;
        """
    )
    # 3) Add unique constraint and set NOT NULL
    op.create_unique_constraint("uq_teams_join_code", "teams", ["join_code"])
    op.alter_column("teams", "join_code", nullable=False)


def downgrade() -> None:
    op.drop_constraint("uq_teams_join_code", "teams", type_="unique")
    op.drop_column("teams", "join_code")
