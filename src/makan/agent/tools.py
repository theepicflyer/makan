"""Tools the agent calls. Each returns compact text, which costs fewer tokens than JSON."""

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.orm import Session

from makan import foods as food_svc
from makan import log as log_svc
from makan.agent.prompt import day_lines, entry_line, food_line
from makan.models import NUTRIENTS, User

MealName = Literal["breakfast", "lunch", "dinner", "snacks"]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SearchFoods(_Model):
    queries: list[str] = Field(min_length=1, max_length=15)
    limit: int = Field(default=5, ge=1, le=10)


class GetEntries(_Model):
    date: str


class NewEntry(_Model):
    meal: MealName
    date: str | None = None
    food_id: int | None = None
    servings: float | None = Field(default=None, gt=0)
    serving: str | None = None
    grams: float | None = Field(default=None, gt=0)
    name: str | None = None
    kcal: float | None = Field(default=None, ge=0)
    protein_g: float | None = Field(default=None, ge=0)
    carb_g: float | None = Field(default=None, ge=0)
    fat_g: float | None = Field(default=None, ge=0)
    note: str | None = None
    photo: int | None = Field(default=None, ge=1)


class LogEntries(_Model):
    entries: list[NewEntry] = Field(min_length=1, max_length=30)


class EntryUpdate(_Model):
    entry_id: int
    date: str | None = None
    meal: MealName | None = None
    food_id: int | None = None
    servings: float | None = Field(default=None, gt=0)
    serving: str | None = None
    grams: float | None = Field(default=None, gt=0)
    name: str | None = None
    kcal: float | None = Field(default=None, ge=0)
    protein_g: float | None = Field(default=None, ge=0)
    carb_g: float | None = Field(default=None, ge=0)
    fat_g: float | None = Field(default=None, ge=0)
    note: str | None = None


class UpdateEntries(_Model):
    updates: list[EntryUpdate] = Field(min_length=1, max_length=30)


class DeleteEntries(_Model):
    entry_ids: list[int] = Field(min_length=1, max_length=30)


class FoodNutrients(_Model):
    basis: Literal["per_100g", "per_serving"] = "per_100g"
    serving_grams: float | None = Field(default=None, gt=0)
    kcal: float = Field(ge=0)
    protein_g: float | None = Field(default=None, ge=0)
    carb_g: float | None = Field(default=None, ge=0)
    fat_g: float | None = Field(default=None, ge=0)
    fibre_g: float | None = Field(default=None, ge=0)
    sugar_g: float | None = Field(default=None, ge=0)
    sodium_mg: float | None = Field(default=None, ge=0)
    sat_fat_g: float | None = Field(default=None, ge=0)


class ServingIn(_Model):
    label: str
    grams: float = Field(gt=0)
    default: bool = False


class SaveFood(_Model):
    food_id: int | None = None
    name: str | None = None
    brand: str | None = None
    nutrients: FoodNutrients | None = None
    servings: list[ServingIn] | None = None
    remove_servings: list[str] | None = None
    aliases: list[str] | None = None
    remove_aliases: list[str] | None = None


class DeleteFood(_Model):
    food_id: int


_portion_props = {
    "servings": {"type": "number", "description": "How many of `serving`. Defaults to 1."},
    "serving": {
        "type": "string",
        "description": "A serving label of the food, e.g. 'bowl', 'slice', 'cup'. Omit for the default serving.",
    },
    "grams": {
        "type": "number",
        "description": (
            "Total weight eaten; use instead of servings when the user gives a weight or you judge it "
            "from a photo. With an estimate, the weight its numbers are for."
        ),
    },
}
_custom_props = {
    "name": {
        "type": "string",
        "description": "Required when there is no food_id; overrides the display name otherwise.",
    },
    "kcal": {"type": "number", "description": "Total kcal for a custom estimate (no food_id)."},
    "protein_g": {"type": "number"},
    "carb_g": {"type": "number"},
    "fat_g": {"type": "number"},
    "note": {"type": "string"},
}
_meal_prop = {"type": "string", "enum": ["breakfast", "lunch", "dinner", "snacks"]}
_date_prop = {"type": "string", "description": "YYYY-MM-DD. Defaults to the log date."}

TOOLS: list[dict[str, Any]] = sorted(
    [
        {
            "name": "search_foods",
            "description": (
                "Search the food database (Ours, SG FoodID, USDA) for several items at once. "
                "Returns the best matches per query with food_id, kcal and macros per 100 g, and servings "
                "(* marks the default)."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "queries": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "One short food name per item.",
                    },
                    "limit": {"type": "integer", "description": "Matches per query, default 5."},
                },
                "required": ["queries"],
                "additionalProperties": False,
            },
        },
        {
            "name": "get_entries",
            "description": "List one day's log entries (with ids) and totals.",
            "input_schema": {
                "type": "object",
                "properties": {"date": {"type": "string", "description": "YYYY-MM-DD"}},
                "required": ["date"],
                "additionalProperties": False,
            },
        },
        {
            "name": "log_entries",
            "description": (
                "Add items to the log. Each item has a meal and either a food_id (with an optional portion) "
                "or a name plus kcal/protein_g/carb_g/fat_g for a custom estimate."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "entries": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "meal": _meal_prop,
                                "date": _date_prop,
                                "food_id": {"type": "integer"},
                                **_portion_props,
                                **_custom_props,
                                "photo": {
                                    "type": "integer",
                                    "description": "Which attached photo the item is from (1 = first), when the message has several.",
                                },
                            },
                            "required": ["meal"],
                            "additionalProperties": False,
                        },
                    }
                },
                "required": ["entries"],
                "additionalProperties": False,
            },
        },
        {
            "name": "update_entries",
            "description": (
                "Change existing entries: move to another meal or date, change the portion (servings alone keeps "
                "the current serving), swap the food, or set custom nutrient totals. Only pass fields that change."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "updates": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "entry_id": {"type": "integer"},
                                "meal": _meal_prop,
                                "date": {"type": "string", "description": "YYYY-MM-DD"},
                                "food_id": {"type": "integer"},
                                **_portion_props,
                                **_custom_props,
                            },
                            "required": ["entry_id"],
                            "additionalProperties": False,
                        },
                    }
                },
                "required": ["updates"],
                "additionalProperties": False,
            },
        },
        {
            "name": "delete_entries",
            "description": "Remove entries from the log.",
            "input_schema": {
                "type": "object",
                "properties": {"entry_ids": {"type": "array", "items": {"type": "integer"}}},
                "required": ["entry_ids"],
                "additionalProperties": False,
            },
        },
        {
            "name": "save_food",
            "description": (
                "Create a household (Ours) food, or edit one by food_id. On edit, only pass what changes: "
                "`servings` adds or updates servings by label, `aliases` adds aliases (an alias moves off any "
                "other household food). Nutrients are per 100 g unless basis is per_serving."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "food_id": {"type": "integer", "description": "Omit to create a new food."},
                    "name": {"type": "string"},
                    "brand": {"type": "string"},
                    "nutrients": {
                        "type": "object",
                        "properties": {
                            "basis": {"type": "string", "enum": ["per_100g", "per_serving"]},
                            "serving_grams": {
                                "type": "number",
                                "description": "Required when basis is per_serving.",
                            },
                            **{n: {"type": "number"} for n in NUTRIENTS},
                        },
                        "required": ["kcal"],
                        "additionalProperties": False,
                    },
                    "servings": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string"},
                                "grams": {"type": "number"},
                                "default": {"type": "boolean"},
                            },
                            "required": ["label", "grams"],
                            "additionalProperties": False,
                        },
                    },
                    "remove_servings": {"type": "array", "items": {"type": "string"}},
                    "aliases": {"type": "array", "items": {"type": "string"}},
                    "remove_aliases": {"type": "array", "items": {"type": "string"}},
                },
                "additionalProperties": False,
            },
        },
        {
            "name": "delete_food",
            "description": "Delete a household (Ours) food. Past log entries keep their values.",
            "input_schema": {
                "type": "object",
                "properties": {"food_id": {"type": "integer"}},
                "required": ["food_id"],
                "additionalProperties": False,
            },
        },
    ],
    key=lambda t: t["name"],
)


@dataclass
class ToolContext:
    db: Session
    user: User
    log_date: date
    changes: log_svc.ChangeLog
    photo_ids: list[int] = field(default_factory=list)
    days_touched: set[date] = field(default_factory=set)


class ToolError(ValueError):
    pass


def _day(value: str | None, ctx: ToolContext) -> date:
    if value is None:
        return ctx.log_date
    try:
        return log_svc.parse_day(value)
    except log_svc.LogError as exc:
        raise ToolError(str(exc)) from exc


def _photo_id(ctx: ToolContext, number: int | None) -> int | None:
    """The photo an entry came from: the one it names, or the only one sent."""
    if number is not None and number <= len(ctx.photo_ids):
        return ctx.photo_ids[number - 1]
    return ctx.photo_ids[0] if len(ctx.photo_ids) == 1 else None


def _nutrients(item: NewEntry | EntryUpdate) -> dict[str, float | None] | None:
    values = {n: getattr(item, n) for n in ("kcal", "protein_g", "carb_g", "fat_g")}
    if all(v is None for v in values.values()):
        return None
    return values


def _day_summary(ctx: ToolContext, days: set[date]) -> list[str]:
    out = []
    for day in sorted(days):
        entries = log_svc.entries_between(ctx.db, ctx.user, day, day)
        t = log_svc.totals(entries)
        out.append(
            f"Day total {day.isoformat()}: {t['kcal']:.0f} kcal, P{t['protein_g']:.0f} "
            f"C{t['carb_g']:.0f} F{t['fat_g']:.0f}"
        )
    return out


def search_foods(ctx: ToolContext, args: SearchFoods) -> str:
    out = []
    for q in args.queries:
        hits = food_svc.search(ctx.db, q, limit=args.limit)
        out.append(f'"{q}":')
        out += [f"  {food_line(h.food)}" for h in hits] or ["  (no matches)"]
    return "\n".join(out)


def get_entries(ctx: ToolContext, args: GetEntries) -> str:
    day = _day(args.date, ctx)
    return f"Entries on {day.isoformat()}:\n" + "\n".join(day_lines(ctx.db, ctx.user, day))


def log_entries(ctx: ToolContext, args: LogEntries) -> str:
    created, errors, days = [], [], set()
    for i, item in enumerate(args.entries):
        try:
            day = _day(item.date, ctx)
            entry = log_svc.add_entry(
                ctx.db,
                ctx.user,
                day=day,
                meal=item.meal,
                food_id=item.food_id,
                servings=item.servings,
                serving=item.serving,
                grams=item.grams,
                name=item.name,
                nutrients=_nutrients(item),
                note=item.note,
                photo_id=_photo_id(ctx, item.photo),
                origin="agent",
                changes=ctx.changes,
            )
            created.append(entry)
            days.add(day)
        except (ValueError, ToolError) as exc:
            errors.append(f"item {i + 1}: {exc}")
    ctx.days_touched |= days
    lines = [f"Logged {e.date.isoformat()} {entry_line(e)}" for e in created]
    lines += [f"Not logged — {e}" for e in errors]
    return "\n".join(lines + _day_summary(ctx, days))


def update_entries(ctx: ToolContext, args: UpdateEntries) -> str:
    updated, errors, days = [], [], set()
    for u in args.updates:
        try:
            entry = ctx.db.get(log_svc.Entry, u.entry_id)
            if entry is not None and entry.user_id == ctx.user.id:
                days.add(entry.date)
            entry = log_svc.update_entry(
                ctx.db,
                ctx.user,
                u.entry_id,
                day=_day(u.date, ctx) if u.date else None,
                meal=u.meal,
                food_id=u.food_id,
                servings=u.servings,
                serving=u.serving,
                grams=u.grams,
                name=u.name,
                nutrients=_nutrients(u),
                note=u.note,
                changes=ctx.changes,
            )
            updated.append(entry)
            days.add(entry.date)
        except (ValueError, ToolError) as exc:
            errors.append(f"#{u.entry_id}: {exc}")
    ctx.days_touched |= days
    lines = [f"Updated {e.date.isoformat()} {entry_line(e)}" for e in updated]
    lines += [f"Not updated — {e}" for e in errors]
    return "\n".join(lines + _day_summary(ctx, days))


def delete_entries(ctx: ToolContext, args: DeleteEntries) -> str:
    deleted, errors, days = [], [], set()
    for entry_id in args.entry_ids:
        try:
            snap = log_svc.delete_entry(ctx.db, ctx.user, entry_id, changes=ctx.changes)
            deleted.append(f"#{entry_id} {snap['name']}")
            days.add(date.fromisoformat(snap["date"]))
        except ValueError as exc:
            errors.append(str(exc))
    ctx.days_touched |= days
    lines = [f"Deleted {d}" for d in deleted] + [f"Not deleted — {e}" for e in errors]
    return "\n".join(lines + _day_summary(ctx, days))


def _per_100g(n: FoodNutrients) -> dict[str, float | None]:
    values = {k: getattr(n, k) for k in NUTRIENTS}
    if n.basis == "per_100g":
        return values
    if not n.serving_grams:
        raise ToolError("basis per_serving needs serving_grams")
    factor = 100.0 / n.serving_grams
    return {k: (None if v is None else round(v * factor, 2)) for k, v in values.items()}


def save_food(ctx: ToolContext, args: SaveFood) -> str:
    nutrients = _per_100g(args.nutrients) if args.nutrients else None
    servings = None
    aliases = None
    if args.food_id is not None:
        current = food_svc.get_food(ctx.db, args.food_id)
        if args.servings is not None or args.remove_servings:
            by_label = {
                food_svc.normalize_label(s["label"]): dict(s) for s in current.servings or []
            }
            for label in args.remove_servings or []:
                by_label.pop(food_svc.normalize_label(label), None)
            for s in args.servings or []:
                if s.default:
                    for existing in by_label.values():
                        existing["default"] = False
                key = food_svc.normalize_label(s.label)
                keep_default = by_label.get(key, {}).get("default", False)
                by_label[key] = {
                    "label": s.label,
                    "grams": s.grams,
                    "default": s.default or keep_default,
                }
            servings = list(by_label.values())
        if args.aliases is not None or args.remove_aliases:
            drop = {a.strip().lower() for a in args.remove_aliases or []}
            aliases = [a for a in current.aliases or [] if a not in drop] + list(args.aliases or [])
    else:
        servings = [s.model_dump() for s in args.servings] if args.servings else []
        if args.nutrients and args.nutrients.basis == "per_serving" and not servings:
            servings = [
                {"label": "serving", "grams": args.nutrients.serving_grams, "default": True}
            ]
        aliases = list(args.aliases or [])
    food, before = food_svc.save_ours(
        ctx.db,
        user_id=ctx.user.id,
        food_id=args.food_id,
        name=args.name,
        brand=args.brand,
        nutrients=nutrients,
        servings=servings,
        aliases=aliases,
    )
    ctx.changes.record(
        "foods",
        "create" if before is None else "update",
        food.id,
        before,
        food_svc.food_snapshot(food),
    )
    return ("Created " if before is None else "Updated ") + food_line(food)


def delete_food(ctx: ToolContext, args: DeleteFood) -> str:
    food, before = food_svc.delete_ours(ctx.db, args.food_id)
    ctx.changes.record("foods", "delete", food.id, before, food_svc.food_snapshot(food))
    return f"Deleted household food #{food.id} {food.name}"


_HANDLERS = {
    "search_foods": (SearchFoods, search_foods),
    "get_entries": (GetEntries, get_entries),
    "log_entries": (LogEntries, log_entries),
    "update_entries": (UpdateEntries, update_entries),
    "delete_entries": (DeleteEntries, delete_entries),
    "save_food": (SaveFood, save_food),
    "delete_food": (DeleteFood, delete_food),
}

WRITE_TOOLS = {"log_entries", "update_entries", "delete_entries", "save_food", "delete_food"}


def run_tool(ctx: ToolContext, name: str, raw_input: Any) -> tuple[str, bool]:
    """Run one tool call. Returns (result text, is_error)."""
    handler = _HANDLERS.get(name)
    if handler is None:
        return f"Unknown tool {name}", True
    schema, fn = handler
    try:
        args = schema.model_validate(raw_input)
    except ValidationError as exc:
        problems = "; ".join(
            f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()
        )
        return f"Invalid input: {problems}", True
    try:
        with ctx.db.begin_nested():
            return fn(ctx, args), False
    except (ValueError, ToolError) as exc:
        return f"Error: {exc}", True
