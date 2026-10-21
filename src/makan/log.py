"""Food log entries, day summaries, quick adds, and the change log behind undo."""

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from makan import foods as food_svc
from makan.models import MEALS, NUTRIENTS, Change, Entry, Food, Pin, SavedMeal, User


class LogError(ValueError):
    pass


# --- change log (undo) ---------------------------------------------------------


@dataclass
class ChangeLog:
    """Collects what one agent turn changed so the turn can be undone."""

    db: Session
    turn_id: int
    entries_touched: list[int] = field(default_factory=list)

    def record(
        self, table: str, action: str, row_id: int, before: dict | None, after: dict | None
    ) -> None:
        self.db.add(
            Change(
                turn_id=self.turn_id,
                table=table,
                action=action,
                row_id=row_id,
                before=before,
                after=after,
            )
        )
        if table == "entries":
            self.entries_touched.append(row_id)


_ENTRY_FIELDS = (
    "user_id",
    "date",
    "meal",
    "position",
    "food_id",
    "name",
    "serving_label",
    "servings",
    "grams",
    "is_estimate",
    "note",
    "photo_id",
    "origin",
    *NUTRIENTS,
)


def entry_snapshot(entry: Entry) -> dict[str, Any]:
    snap = {k: getattr(entry, k) for k in _ENTRY_FIELDS}
    snap["date"] = entry.date.isoformat()
    return snap


def _apply_snapshot(entry: Entry, snap: dict[str, Any]) -> None:
    for k in _ENTRY_FIELDS:
        value = snap.get(k)
        if k == "date" and isinstance(value, str):
            value = date.fromisoformat(value)
        setattr(entry, k, value)


def undo_changes(db: Session, turn_id: int) -> int:
    changes = list(
        db.scalars(select(Change).where(Change.turn_id == turn_id).order_by(Change.id.desc()))
    )
    for ch in changes:
        if ch.table == "entries":
            entry = db.get(Entry, ch.row_id)
            if ch.action == "create":
                if entry is not None:
                    db.delete(entry)
            elif ch.action == "update" and entry is not None and ch.before:
                _apply_snapshot(entry, ch.before)
            elif ch.action == "delete" and entry is None and ch.before:
                restored = Entry(id=ch.row_id)
                _apply_snapshot(restored, ch.before)
                db.add(restored)
        elif ch.table == "foods":
            food_svc.restore_food(db, ch.row_id, ch.before)
        db.flush()
    return len(changes)


# --- entries -------------------------------------------------------------------


def _check_meal(meal: str) -> str:
    meal = meal.strip().lower()
    if meal == "supper":
        meal = "snacks"
    if meal not in MEALS:
        raise LogError(f"meal must be one of {', '.join(MEALS)}")
    return meal


def _next_position(db: Session, user_id: int, day: date, meal: str) -> int:
    current = db.scalar(
        select(func.max(Entry.position)).where(
            Entry.user_id == user_id, Entry.date == day, Entry.meal == meal
        )
    )
    return 0 if current is None else current + 1


def _get_entry(db: Session, user: User, entry_id: int) -> Entry:
    entry = db.get(Entry, entry_id)
    if entry is None or entry.user_id != user.id:
        raise LogError(f"No entry with id {entry_id}")
    return entry


def _food_name(food: Food) -> str:
    if food.brand and food.brand.lower() not in food.name.lower():
        return f"{food.brand} {food.name}"
    return food.name


def _set_custom_nutrients(entry: Entry, nutrients: dict[str, float | None]) -> None:
    if nutrients.get("kcal") is None:
        raise LogError("an item without a food_id needs kcal")
    for n in NUTRIENTS:
        value = nutrients.get(n)
        if value is not None and value < 0:
            raise LogError(f"{n} can't be negative")
        setattr(entry, n, value)


def add_entry(
    db: Session,
    user: User,
    *,
    day: date,
    meal: str,
    food_id: int | None = None,
    servings: float | None = None,
    serving: str | None = None,
    grams: float | None = None,
    name: str | None = None,
    nutrients: dict[str, float | None] | None = None,
    note: str | None = None,
    photo_id: int | None = None,
    origin: str = "manual",
    changes: ChangeLog | None = None,
) -> Entry:
    meal = _check_meal(meal)
    entry = Entry(user_id=user.id, date=day, meal=meal, note=note, photo_id=photo_id, origin=origin)
    if food_id is not None:
        food = food_svc.get_food(db, food_id)
        portion = food_svc.resolve_portion(food, servings, serving, grams)
        entry.food_id = food.id
        entry.name = name or _food_name(food)
        entry.servings, entry.serving_label, entry.grams = (
            portion.servings,
            portion.serving_label,
            portion.grams,
        )
        for n, v in food_svc.scale(food, portion.grams).items():
            setattr(entry, n, v)
        entry.is_estimate = False
    else:
        if not name:
            raise LogError("an item without a food_id needs a name")
        entry.name = name.strip()
        entry.servings, entry.serving_label, entry.grams = servings, serving, grams
        _set_custom_nutrients(entry, nutrients or {})
        entry.is_estimate = True
    entry.position = _next_position(db, user.id, day, meal)
    db.add(entry)
    db.flush()
    if changes:
        changes.record("entries", "create", entry.id, None, entry_snapshot(entry))
    return entry


def update_entry(
    db: Session,
    user: User,
    entry_id: int,
    *,
    day: date | None = None,
    meal: str | None = None,
    food_id: int | None = None,
    servings: float | None = None,
    serving: str | None = None,
    grams: float | None = None,
    name: str | None = None,
    nutrients: dict[str, float | None] | None = None,
    note: str | None = None,
    changes: ChangeLog | None = None,
) -> Entry:
    entry = _get_entry(db, user, entry_id)
    before = entry_snapshot(entry)
    if day is not None or meal is not None:
        new_day = day or entry.date
        new_meal = _check_meal(meal) if meal is not None else entry.meal
        if (new_day, new_meal) != (entry.date, entry.meal):
            entry.date, entry.meal = new_day, new_meal
            entry.position = _next_position(db, user.id, new_day, new_meal)
    if note is not None:
        entry.note = note or None

    portion_changed = servings is not None or serving is not None or grams is not None
    target_food_id = food_id if food_id is not None else entry.food_id
    if nutrients:
        # Explicit totals win: the entry becomes a custom estimate.
        if name is not None:
            entry.name = name.strip()
        if portion_changed:
            entry.servings, entry.serving_label, entry.grams = servings, serving, grams
        merged = {n: getattr(entry, n) for n in NUTRIENTS} | {
            k: v for k, v in nutrients.items() if k in NUTRIENTS
        }
        _set_custom_nutrients(entry, merged)
        entry.food_id = None if food_id is None else food_id
        entry.is_estimate = True
    elif target_food_id is not None and (food_id is not None or portion_changed):
        food = food_svc.get_food(db, target_food_id, include_deleted=True)
        if food_id is None and not portion_changed:
            portion = food_svc.Portion(entry.grams or 100.0, entry.servings, entry.serving_label)
        elif (
            grams is None
            and servings is not None
            and serving is None
            and food_id is None
            and entry.serving_label
        ):
            # "make that 2": keep the serving, change the count
            portion = food_svc.resolve_portion(food, servings, entry.serving_label, None)
        else:
            portion = food_svc.resolve_portion(food, servings, serving, grams)
        entry.food_id = food.id
        entry.servings, entry.serving_label, entry.grams = (
            portion.servings,
            portion.serving_label,
            portion.grams,
        )
        for n, v in food_svc.scale(food, portion.grams).items():
            setattr(entry, n, v)
        entry.name = name.strip() if name else _food_name(food)
        entry.is_estimate = False
    elif portion_changed:
        # Custom item: scale its totals with the portion count.
        old = entry.servings or 1.0
        new = servings if servings is not None else old
        if new <= 0:
            raise LogError("servings must be positive")
        ratio = new / old
        for n in NUTRIENTS:
            value = getattr(entry, n)
            if value is not None:
                setattr(entry, n, round(value * ratio, 2))
        entry.servings = new
        if serving is not None:
            entry.serving_label = serving
        if grams is not None:
            entry.grams = grams
        if name is not None:
            entry.name = name.strip()
    elif name is not None:
        entry.name = name.strip()
    db.flush()
    if changes:
        changes.record("entries", "update", entry.id, before, entry_snapshot(entry))
    return entry


def delete_entry(
    db: Session, user: User, entry_id: int, changes: ChangeLog | None = None
) -> dict[str, Any]:
    entry = _get_entry(db, user, entry_id)
    snap = entry_snapshot(entry)
    db.delete(entry)
    db.flush()
    if changes:
        changes.record("entries", "delete", entry_id, snap, None)
    return snap


def entries_between(db: Session, user: User, start: date, end: date) -> list[Entry]:
    return list(
        db.scalars(
            select(Entry)
            .where(Entry.user_id == user.id, Entry.date >= start, Entry.date <= end)
            .order_by(Entry.date, Entry.meal, Entry.position, Entry.id)
        )
    )


def totals(entries: list[Entry]) -> dict[str, float]:
    out = {n: 0.0 for n in NUTRIENTS}
    for e in entries:
        for n in NUTRIENTS:
            value = getattr(e, n)
            if value is not None:
                out[n] += value
    return {n: round(v, 1) for n, v in out.items()}


def targets(user: User) -> dict[str, float | None]:
    return {
        "kcal": user.kcal_target,
        "protein_g": user.protein_target_g,
        "carb_g": user.carb_target_g,
        "fat_g": user.fat_target_g,
    }


def daily_totals(db: Session, user: User, start: date, end: date) -> list[dict[str, Any]]:
    by_day: dict[date, list[Entry]] = defaultdict(list)
    for e in entries_between(db, user, start, end):
        by_day[e.date].append(e)
    out = []
    day = start
    while day <= end:
        items = by_day.get(day, [])
        out.append({"date": day.isoformat(), "entries": len(items), **totals(items)})
        day += timedelta(days=1)
    return out


# --- quick adds ----------------------------------------------------------------


def _portion_key(e: Entry) -> tuple:
    return (e.serving_label, e.servings, None if e.serving_label else e.grams)


def quick_items(
    db: Session, user: User, meal: str | None = None, day: date | None = None
) -> dict[str, Any]:
    since = (day or date.today()) - timedelta(days=90)
    recent_entries = list(
        db.scalars(
            select(Entry)
            .where(Entry.user_id == user.id, Entry.food_id.is_not(None), Entry.date >= since)
            .order_by(Entry.created_at.desc())
            .limit(400)
        )
    )
    food_ids = {e.food_id for e in recent_entries}
    live_foods = {
        f.id: f
        for f in db.scalars(select(Food).where(Food.id.in_(food_ids), Food.deleted_at.is_(None)))
    }

    def item(e: Entry) -> dict[str, Any]:
        return {
            "food_id": e.food_id,
            "name": e.name,
            "serving_label": e.serving_label,
            "servings": e.servings,
            "grams": e.grams if not e.serving_label else None,
            "kcal": e.kcal,
        }

    recents, seen = [], set()
    for e in recent_entries:
        if e.food_id in seen or e.food_id not in live_foods:
            continue
        seen.add(e.food_id)
        recents.append(item(e))
        if len(recents) >= 12:
            break

    counts: Counter[int] = Counter()
    portions: dict[int, Counter] = defaultdict(Counter)
    latest: dict[tuple, Entry] = {}
    for e in recent_entries:
        if e.food_id not in live_foods:
            continue
        weight = 3 if meal and e.meal == meal else 1
        counts[e.food_id] += weight
        key = _portion_key(e)
        portions[e.food_id][key] += 1
        latest.setdefault((e.food_id, key), e)
    frequent = []
    for food_id, _ in counts.most_common(12):
        key = portions[food_id].most_common(1)[0][0]
        frequent.append(item(latest[(food_id, key)]))

    pins = []
    for pin in db.scalars(select(Pin).where(Pin.user_id == user.id).order_by(Pin.position, Pin.id)):
        food = db.get(Food, pin.food_id)
        if food is None or food.deleted_at is not None:
            continue
        portion = food_svc.resolve_portion(food, pin.servings, pin.serving_label, pin.grams)
        pins.append(
            {
                "id": pin.id,
                "food_id": food.id,
                "name": _food_name(food),
                "serving_label": portion.serving_label,
                "servings": portion.servings,
                "grams": pin.grams,
                "kcal": food_svc.scale(food, portion.grams)["kcal"],
            }
        )

    meals = [
        {"id": m.id, "name": m.name, "items": m.items}
        for m in db.scalars(
            select(SavedMeal).where(SavedMeal.user_id == user.id).order_by(SavedMeal.name)
        )
    ]

    yesterday = None
    if meal and day:
        prev = list(
            db.scalars(
                select(Entry)
                .where(
                    Entry.user_id == user.id,
                    Entry.date == day - timedelta(days=1),
                    Entry.meal == meal,
                )
                .order_by(Entry.position)
            )
        )
        if prev:
            yesterday = {
                "date": (day - timedelta(days=1)).isoformat(),
                "items": [{"entry_id": e.id, "name": e.name, "kcal": e.kcal} for e in prev],
                "kcal": totals(prev)["kcal"],
            }

    return {
        "pins": pins,
        "saved_meals": meals,
        "frequent": frequent,
        "recent": recents,
        "yesterday": yesterday,
    }


def copy_entries(
    db: Session, user: User, entry_ids: list[int], day: date, meal: str
) -> list[Entry]:
    out = []
    for entry_id in entry_ids:
        src = _get_entry(db, user, entry_id)
        clone = Entry(user_id=user.id, date=day, meal=_check_meal(meal), origin="quick")
        for k in (
            "food_id",
            "name",
            "serving_label",
            "servings",
            "grams",
            "is_estimate",
            "note",
            *NUTRIENTS,
        ):
            setattr(clone, k, getattr(src, k))
        clone.position = _next_position(db, user.id, day, clone.meal)
        db.add(clone)
        db.flush()
        out.append(clone)
    return out


def log_saved_meal(db: Session, user: User, meal_id: int, day: date, meal: str) -> list[Entry]:
    saved = db.get(SavedMeal, meal_id)
    if saved is None or saved.user_id != user.id:
        raise LogError(f"No saved meal with id {meal_id}")
    return [
        add_entry(
            db,
            user,
            day=day,
            meal=meal,
            food_id=it["food_id"],
            servings=it.get("servings"),
            serving=it.get("serving_label"),
            grams=it.get("grams"),
            origin="quick",
        )
        for it in saved.items
    ]


def touch_user_targets(user: User, values: dict[str, float | None]) -> None:
    mapping = {
        "kcal": "kcal_target",
        "protein_g": "protein_target_g",
        "carb_g": "carb_target_g",
        "fat_g": "fat_target_g",
    }
    for key, attr in mapping.items():
        if key in values:
            value = values[key]
            if value is not None and value < 0:
                raise LogError(f"{key} target can't be negative")
            setattr(user, attr, value)


def parse_day(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise LogError(f"'{value}' is not a YYYY-MM-DD date") from exc
