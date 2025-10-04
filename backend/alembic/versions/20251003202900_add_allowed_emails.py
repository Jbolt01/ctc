from __future__ import annotations

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision ="20251003202900"
down_revision = "20250911070000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "allowed_emails",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=False, unique=True, index=True),
        sa.Column(
            "user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
            unique=True,
        ),
    )


def downgrade() -> None:
    op.drop_table("allowed_emails")
