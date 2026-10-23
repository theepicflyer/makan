from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from makan.db import Base

NUTRIENTS = ("kcal", "protein_g", "carb_g", "fat_g", "fibre_g", "sugar_g", "sodium_mg", "sat_fat_g")
MEALS = ("breakfast", "lunch", "dinner", "snacks")
SOURCES = ("ours", "sgfoodid", "usda")


def utcnow() -> datetime:
    return datetime.now(UTC)


class NutrientColumns:
    kcal: Mapped[float | None] = mapped_column(Float)
    protein_g: Mapped[float | None] = mapped_column(Float)
    carb_g: Mapped[float | None] = mapped_column(Float)
    fat_g: Mapped[float | None] = mapped_column(Float)
    fibre_g: Mapped[float | None] = mapped_column(Float)
    sugar_g: Mapped[float | None] = mapped_column(Float)
    sodium_mg: Mapped[float | None] = mapped_column(Float)
    sat_fat_g: Mapped[float | None] = mapped_column(Float)

    def nutrients(self) -> dict[str, float | None]:
        return {n: getattr(self, n) for n in NUTRIENTS}


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    oidc_sub: Mapped[str] = mapped_column(String, unique=True)
    email: Mapped[str | None] = mapped_column(String)
    name: Mapped[str] = mapped_column(String)
    kcal_target: Mapped[float | None] = mapped_column(Float)
    protein_target_g: Mapped[float | None] = mapped_column(Float)
    carb_target_g: Mapped[float | None] = mapped_column(Float)
    fat_target_g: Mapped[float | None] = mapped_column(Float)
    # Daily reminder to log, "HH:MM" in the app's timezone, sent to each of the user's push_subscriptions.
    reminder_time: Mapped[str] = mapped_column(String, default="21:00", server_default="21:00")
    # The log date the last reminder was settled for (sent or skipped), so each day gets at most one.
    reminded_on: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PushSubscription(Base):
    """A device that gets its user's reminders: a browser's Web Push subscription."""

    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    endpoint: Mapped[str] = mapped_column(String, unique=True)
    p256dh: Mapped[str] = mapped_column(String)
    auth: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Food(NutrientColumns, Base):
    """A food with nutrients per 100 g. Reference sources are read-only; 'ours' is editable."""

    __tablename__ = "foods"
    __table_args__ = (UniqueConstraint("source", "source_ref"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String, index=True)
    source_ref: Mapped[str | None] = mapped_column(String)
    name: Mapped[str] = mapped_column(String)
    brand: Mapped[str | None] = mapped_column(String)
    description: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String)
    # [{"label": "bowl", "grams": 604.0, "default": true}]
    servings: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    # Generic words this food stands for in the household, e.g. ["yogurt"]
    aliases: Mapped[list[str]] = mapped_column(JSON, default=list)
    meta: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Photo(Base):
    __tablename__ = "photos"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    path: Mapped[str] = mapped_column(String)
    media_type: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Entry(NutrientColumns, Base):
    """One logged item. Nutrients are totals for the portion, copied at log time."""

    __tablename__ = "entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    meal: Mapped[str] = mapped_column(String)
    position: Mapped[int] = mapped_column(Integer, default=0)
    food_id: Mapped[int | None] = mapped_column(ForeignKey("foods.id"))
    name: Mapped[str] = mapped_column(String)
    serving_label: Mapped[str | None] = mapped_column(String)
    servings: Mapped[float | None] = mapped_column(Float)
    grams: Mapped[float | None] = mapped_column(Float)
    is_estimate: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[str | None] = mapped_column(Text)
    photo_id: Mapped[int | None] = mapped_column(ForeignKey("photos.id"))
    origin: Mapped[str] = mapped_column(String, default="manual")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class Pin(Base):
    """A quick-add shortcut for one food and portion."""

    __tablename__ = "pins"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    food_id: Mapped[int] = mapped_column(ForeignKey("foods.id"))
    serving_label: Mapped[str | None] = mapped_column(String)
    servings: Mapped[float | None] = mapped_column(Float)
    grams: Mapped[float | None] = mapped_column(Float)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SavedMeal(Base):
    """A named group of items logged together, e.g. "usual breakfast"."""

    __tablename__ = "saved_meals"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String)
    # [{"food_id": 1, "serving_label": "cup", "servings": 1, "grams": null}]
    items: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Thread(Base):
    """One assistant conversation: from opening Bao to closing it, about one log date."""

    __tablename__ = "threads"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    date: Mapped[date] = mapped_column(Date)
    model: Mapped[str] = mapped_column(String)
    # Fingerprint of the household food list the model last saw in this thread.
    foods_fingerprint: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Turn(Base):
    """One user message and everything the agent did in response."""

    __tablename__ = "turns"

    id: Mapped[int] = mapped_column(primary_key=True)
    thread_id: Mapped[int] = mapped_column(ForeignKey("threads.id"), index=True)
    user_text: Mapped[str] = mapped_column(Text, default="")
    photo_id: Mapped[int | None] = mapped_column(ForeignKey("photos.id"))
    reply_text: Mapped[str] = mapped_column(Text, default="")
    # API-format messages appended during this turn (user message first).
    messages: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    usage: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String, default="ok")
    undone_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Change(Base):
    """A row the agent created, updated or deleted, kept so a turn can be undone."""

    __tablename__ = "changes"

    id: Mapped[int] = mapped_column(primary_key=True)
    turn_id: Mapped[int] = mapped_column(ForeignKey("turns.id"), index=True)
    table: Mapped[str] = mapped_column(String)
    action: Mapped[str] = mapped_column(String)
    row_id: Mapped[int] = mapped_column(Integer)
    before: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSON)


class Meta(Base):
    __tablename__ = "meta"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(Text)
