"""turn feedback and audit log

Ratings, the error and app version on each turn, and hand edits of agent-logged entries.

Revision ID: 9c2b43ae09af
Revises: c2149b7b4c44
Create Date: 2026-11-10 14:15:02.922347

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9c2b43ae09af"
down_revision: str | Sequence[str] | None = "c2149b7b4c44"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "entry_edits",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("entry_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("before", sa.JSON(), nullable=False),
        sa.Column("after", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("entry_edits", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_entry_edits_entry_id"), ["entry_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_entry_edits_user_id"), ["user_id"], unique=False)
    # Plain nullable columns: SQLite adds them in place, no table rebuild.
    op.add_column("turns", sa.Column("error", sa.Text(), nullable=True))
    op.add_column("turns", sa.Column("app_version", sa.String(), nullable=True))
    op.add_column("turns", sa.Column("rating", sa.Integer(), nullable=True))
    op.add_column("turns", sa.Column("rating_note", sa.Text(), nullable=True))
    op.add_column("turns", sa.Column("rated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    for column in ("rated_at", "rating_note", "rating", "app_version", "error"):
        op.drop_column("turns", column)
    with op.batch_alter_table("entry_edits", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_entry_edits_user_id"))
        batch_op.drop_index(batch_op.f("ix_entry_edits_entry_id"))
    op.drop_table("entry_edits")
