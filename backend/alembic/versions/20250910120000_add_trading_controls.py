import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "20250910120000_add_trading_controls"
down_revision = "0001_init"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'symbols',
        sa.Column('trading_halted', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        'symbols',
        sa.Column('settlement_active', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column('symbols', sa.Column('settlement_price', sa.Numeric(20, 6), nullable=True))
    op.add_column('symbols', sa.Column('settlement_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('symbols', 'settlement_at')
    op.drop_column('symbols', 'settlement_price')
    op.drop_column('symbols', 'settlement_active')
    op.drop_column('symbols', 'trading_halted')
