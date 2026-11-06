"""push reminders

Revision ID: 9ceb764fd8d0
Revises: 2b2a5380ffa5
Create Date: 2026-10-22 12:09:39.997569

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9ceb764fd8d0"
down_revision: str | Sequence[str] | None = "2b2a5380ffa5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("endpoint", sa.String(), nullable=False),
        sa.Column("p256dh", sa.String(), nullable=False),
        sa.Column("auth", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("endpoint"),
    )
    with op.batch_alter_table("push_subscriptions", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_push_subscriptions_user_id"), ["user_id"], unique=False
        )
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("reminder_time", sa.String(), server_default="21:00", nullable=False)
        )
        batch_op.add_column(sa.Column("reminded_on", sa.Date(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    # SQLite drops plain columns in place; a batch rebuild of users would trip the foreign keys on it.
    op.drop_column("users", "reminded_on")
    op.drop_column("users", "reminder_time")
    with op.batch_alter_table("push_subscriptions", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_push_subscriptions_user_id"))
    op.drop_table("push_subscriptions")
