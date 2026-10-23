"""one thread per Bao session

Threads were unique per user and log date; now each time Bao is opened starts a new one.

Revision ID: c2149b7b4c44
Revises: 9ceb764fd8d0
Create Date: 2026-10-23 13:52:30.402731

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.schema import SchemaItem

# revision identifiers, used by Alembic.
revision: str = "c2149b7b4c44"
down_revision: str | Sequence[str] | None = "9ceb764fd8d0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _threads(*extra: SchemaItem) -> sa.Table:
    # SQLite can't drop an unnamed constraint; batch mode rebuilds the table from this definition.
    return sa.Table(
        "threads",
        sa.MetaData(),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("model", sa.String(), nullable=False),
        sa.Column("foods_fingerprint", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.Index("ix_threads_user_id", "user_id"),
        *extra,
    )


def upgrade() -> None:
    with op.batch_alter_table("threads", copy_from=_threads(), recreate="always"):
        pass


def downgrade() -> None:
    with op.batch_alter_table(
        "threads", copy_from=_threads(sa.UniqueConstraint("user_id", "date")), recreate="always"
    ):
        pass
