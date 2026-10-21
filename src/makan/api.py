"""JSON API for the web app."""

import json
from datetime import date, datetime, time
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from makan import foods as food_svc
from makan import log as log_svc
from makan.agent.runner import AgentConfig, run_turn, serialize_turn, undo_turn
from makan.auth import current_user
from makan.config import get_settings
from makan.db import get_db
from makan.models import MEALS, NUTRIENTS, Entry, Food, Photo, Pin, SavedMeal, Thread, Turn, User
from makan.photos import PhotoError, save_photo

router = APIRouter(prefix="/api")

MAX_UPLOAD_BYTES = 15 * 1024 * 1024


def _day(value: str) -> date:
    try:
        return log_svc.parse_day(value)
    except log_svc.LogError as exc:
        raise HTTPException(400, str(exc)) from exc


def _bad_request(exc: Exception) -> HTTPException:
    return HTTPException(400, str(exc))


# --- serializers -----------------------------------------------------------------


def food_out(food: Food) -> dict[str, Any]:
    return {
        "id": food.id,
        "source": food.source,
        "source_label": food_svc.SOURCE_LABEL[food.source],
        "name": food.name,
        "brand": food.brand,
        "description": food.description,
        "category": food.category,
        "per_100g": food.nutrients(),
        "servings": food.servings or [],
        "aliases": food.aliases or [],
        "editable": food.source == "ours",
    }


def entry_out(entry: Entry) -> dict[str, Any]:
    return {
        "id": entry.id,
        "date": entry.date.isoformat(),
        "meal": entry.meal,
        "food_id": entry.food_id,
        "name": entry.name,
        "portion": food_svc.describe_portion(entry.servings, entry.serving_label, entry.grams),
        "servings": entry.servings,
        "serving_label": entry.serving_label,
        "grams": entry.grams,
        "is_estimate": entry.is_estimate,
        "note": entry.note,
        "photo_id": entry.photo_id,
        "origin": entry.origin,
        **entry.nutrients(),
    }


def user_out(user: User) -> dict[str, Any]:
    settings = get_settings()
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "targets": log_svc.targets(user),
        "today": settings.today().isoformat(),
        "timezone": settings.timezone,
    }


# --- me / days -------------------------------------------------------------------


class MeUpdate(BaseModel):
    name: str | None = None
    targets: dict[str, float | None] | None = None


@router.get("/me")
def me(user: User = Depends(current_user)):
    return user_out(user)


@router.patch("/me")
def update_me(body: MeUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.name:
        user.name = body.name.strip()
    if body.targets is not None:
        try:
            log_svc.touch_user_targets(user, body.targets)
        except log_svc.LogError as exc:
            raise _bad_request(exc) from exc
    db.flush()
    return user_out(user)


@router.get("/days/{day}")
def get_day(day: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    d = _day(day)
    entries = log_svc.entries_between(db, user, d, d)
    by_meal: dict[str, list] = {m: [] for m in MEALS}
    for e in entries:
        by_meal.setdefault(e.meal, []).append(entry_out(e))
    return {
        "date": d.isoformat(),
        "meals": by_meal,
        "meal_totals": {m: log_svc.totals([e for e in entries if e.meal == m]) for m in MEALS},
        "totals": log_svc.totals(entries),
        "targets": log_svc.targets(user),
    }


@router.get("/history")
def history(start: str, end: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s, e = _day(start), _day(end)
    if (e - s).days > 400:
        raise HTTPException(400, "range too long")
    return {"days": log_svc.daily_totals(db, user, s, e), "targets": log_svc.targets(user)}


# --- entries ---------------------------------------------------------------------


class EntryIn(BaseModel):
    date: str
    meal: Literal["breakfast", "lunch", "dinner", "snacks"]
    food_id: int | None = None
    servings: float | None = Field(default=None, gt=0)
    serving: str | None = None
    grams: float | None = Field(default=None, gt=0)
    name: str | None = None
    nutrients: dict[str, float | None] | None = None
    note: str | None = None
    origin: Literal["manual", "quick"] = "manual"


class EntryPatch(BaseModel):
    date: str | None = None
    meal: Literal["breakfast", "lunch", "dinner", "snacks"] | None = None
    food_id: int | None = None
    servings: float | None = Field(default=None, gt=0)
    serving: str | None = None
    grams: float | None = Field(default=None, gt=0)
    name: str | None = None
    nutrients: dict[str, float | None] | None = None
    note: str | None = None


class CopyIn(BaseModel):
    entry_ids: list[int]
    date: str
    meal: Literal["breakfast", "lunch", "dinner", "snacks"]


@router.post("/entries")
def create_entry(body: EntryIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    try:
        entry = log_svc.add_entry(
            db, user, day=_day(body.date), meal=body.meal, food_id=body.food_id, servings=body.servings,
            serving=body.serving, grams=body.grams, name=body.name, nutrients=body.nutrients,
            note=body.note, origin=body.origin,
        )
    except ValueError as exc:
        raise _bad_request(exc) from exc
    return entry_out(entry)


@router.patch("/entries/{entry_id}")
def patch_entry(entry_id: int, body: EntryPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    try:
        entry = log_svc.update_entry(
            db, user, entry_id, day=_day(body.date) if body.date else None, meal=body.meal,
            food_id=body.food_id, servings=body.servings, serving=body.serving, grams=body.grams,
            name=body.name, nutrients=body.nutrients, note=body.note,
        )
    except ValueError as exc:
        raise _bad_request(exc) from exc
    return entry_out(entry)


@router.delete("/entries/{entry_id}")
def remove_entry(entry_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    try:
        log_svc.delete_entry(db, user, entry_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"ok": True}


@router.post("/entries/copy")
def copy_entries(body: CopyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    try:
        entries = log_svc.copy_entries(db, user, body.entry_ids, _day(body.date), body.meal)
    except ValueError as exc:
        raise _bad_request(exc) from exc
    return {"entries": [entry_out(e) for e in entries]}


# --- foods -----------------------------------------------------------------------


class FoodIn(BaseModel):
    name: str | None = None
    brand: str | None = None
    description: str | None = None
    basis: Literal["per_100g", "per_serving"] = "per_100g"
    serving_grams: float | None = Field(default=None, gt=0)
    nutrients: dict[str, float | None] | None = None
    servings: list[dict[str, Any]] | None = None
    aliases: list[str] | None = None


def _per_100g(body: FoodIn) -> dict[str, float | None] | None:
    if body.nutrients is None:
        return None
    values = {k: v for k, v in body.nutrients.items() if k in NUTRIENTS}
    if body.basis == "per_serving":
        if not body.serving_grams:
            raise HTTPException(400, "serving_grams is required for per-serving nutrients")
        factor = 100.0 / body.serving_grams
        values = {k: (None if v is None else round(v * factor, 2)) for k, v in values.items()}
    return values


@router.get("/foods/search")
def search_foods(q: str, limit: int = 20, user: User = Depends(current_user), db: Session = Depends(get_db)):
    hits = food_svc.search(db, q, limit=min(max(limit, 1), 50))
    return {"results": [food_out(h.food) for h in hits]}


@router.get("/foods/ours")
def list_ours(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {"foods": [food_out(f) for f in food_svc.ours_foods(db)]}


@router.get("/foods/{food_id}")
def get_food(food_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    try:
        return food_out(food_svc.get_food(db, food_id, include_deleted=True))
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/foods")
def create_food(body: FoodIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    try:
        food, _ = food_svc.save_ours(
            db, user_id=user.id, name=body.name, brand=body.brand, description=body.description,
            nutrients=_per_100g(body), servings=body.servings or [], aliases=body.aliases or [],
        )
    except ValueError as exc:
        raise _bad_request(exc) from exc
    return food_out(food)


@router.patch("/foods/{food_id}")
def patch_food(food_id: int, body: FoodIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    try:
        food, _ = food_svc.save_ours(
            db, user_id=user.id, food_id=food_id, name=body.name, brand=body.brand,
            description=body.description, nutrients=_per_100g(body), servings=body.servings, aliases=body.aliases,
        )
    except ValueError as exc:
        raise _bad_request(exc) from exc
    return food_out(food)


@router.delete("/foods/{food_id}")
def remove_food(food_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    try:
        food_svc.delete_ours(db, food_id)
    except ValueError as exc:
        raise _bad_request(exc) from exc
    return {"ok": True}


# --- quick adds ------------------------------------------------------------------


class PinIn(BaseModel):
    food_id: int
    serving_label: str | None = None
    servings: float | None = Field(default=None, gt=0)
    grams: float | None = Field(default=None, gt=0)


class SavedMealIn(BaseModel):
    name: str
    items: list[dict[str, Any]] | None = None
    entry_ids: list[int] | None = None


class LogSavedIn(BaseModel):
    date: str
    meal: Literal["breakfast", "lunch", "dinner", "snacks"]


@router.get("/quick")
def quick(meal: str | None = None, day: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return log_svc.quick_items(db, user, meal=meal, day=_day(day) if day else get_settings().today())


@router.post("/pins")
def add_pin(body: PinIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    try:
        food = food_svc.get_food(db, body.food_id)
        food_svc.resolve_portion(food, body.servings, body.serving_label, body.grams)
    except ValueError as exc:
        raise _bad_request(exc) from exc
    position = (db.scalar(select(func.max(Pin.position)).where(Pin.user_id == user.id)) or 0) + 1
    pin = Pin(user_id=user.id, food_id=food.id, serving_label=body.serving_label, servings=body.servings, grams=body.grams, position=position)
    db.add(pin)
    db.flush()
    return {"id": pin.id}


@router.delete("/pins/{pin_id}")
def remove_pin(pin_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    pin = db.get(Pin, pin_id)
    if pin is None or pin.user_id != user.id:
        raise HTTPException(404)
    db.delete(pin)
    return {"ok": True}


@router.post("/saved-meals")
def add_saved_meal(body: SavedMealIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    items = body.items or []
    for entry_id in body.entry_ids or []:
        entry = db.get(Entry, entry_id)
        if entry is None or entry.user_id != user.id or entry.food_id is None:
            continue
        items.append({
            "food_id": entry.food_id,
            "serving_label": entry.serving_label,
            "servings": entry.servings,
            "grams": None if entry.serving_label else entry.grams,
            "name": entry.name,
        })
    if not body.name.strip() or not items:
        raise HTTPException(400, "A saved meal needs a name and at least one database food")
    meal = SavedMeal(user_id=user.id, name=body.name.strip(), items=items)
    db.add(meal)
    db.flush()
    return {"id": meal.id, "name": meal.name, "items": meal.items}


@router.delete("/saved-meals/{meal_id}")
def remove_saved_meal(meal_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    meal = db.get(SavedMeal, meal_id)
    if meal is None or meal.user_id != user.id:
        raise HTTPException(404)
    db.delete(meal)
    return {"ok": True}


@router.post("/saved-meals/{meal_id}/log")
def log_saved(meal_id: int, body: LogSavedIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    try:
        entries = log_svc.log_saved_meal(db, user, meal_id, _day(body.date), body.meal)
    except ValueError as exc:
        raise _bad_request(exc) from exc
    return {"entries": [entry_out(e) for e in entries]}


# --- assistant -------------------------------------------------------------------


def _sse(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event, default=str)}\n\n"


@router.post("/agent/turns")
async def agent_turn(
    date_: str = Form(alias="date"),
    text: str = Form(""),
    photo: UploadFile | None = File(None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    day = _day(date_)
    photo_id = None
    if photo is not None and photo.filename:
        data = await photo.read()
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "Photo too large")
        try:
            photo_id = save_photo(db, user.id, data).id
        except PhotoError as exc:
            raise _bad_request(exc) from exc
    if not text.strip() and photo_id is None:
        raise HTTPException(400, "Say something or attach a photo")
    db.commit()
    user_id = user.id

    async def events():
        async for event in run_turn(user_id=user_id, log_date=day, text=text, photo_id=photo_id, config=AgentConfig.from_settings()):
            yield _sse(event)

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/agent/threads/{day}")
def agent_thread(day: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    d = _day(day)
    thread = db.scalar(select(Thread).where(Thread.user_id == user.id, Thread.date == d))
    if thread is None:
        return {"turns": []}
    turns = db.scalars(select(Turn).where(Turn.thread_id == thread.id).order_by(Turn.id))
    return {"turns": [serialize_turn(db, t) for t in turns]}


@router.post("/agent/turns/{turn_id}/undo")
def agent_undo(turn_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    try:
        turn = undo_turn(db, user, turn_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return serialize_turn(db, turn)


@router.get("/photos/{photo_id}")
def get_photo(photo_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    photo = db.get(Photo, photo_id)
    if photo is None or photo.user_id != user.id:
        raise HTTPException(404)
    return FileResponse(get_settings().photo_dir / photo.path, media_type=photo.media_type)


@router.get("/usage")
def usage(user: User = Depends(current_user), db: Session = Depends(get_db)):
    settings = get_settings()
    month_start = datetime.combine(settings.today().replace(day=1), time.min, tzinfo=settings.tz)
    rows = db.execute(
        select(Thread.date, Turn.cost_usd)
        .join(Thread, Turn.thread_id == Thread.id)
        .where(Thread.user_id == user.id, Turn.created_at >= month_start)
    ).all()
    month = sum(cost for _, cost in rows)
    return {"month_usd": round(month, 4), "turns": len(rows), "model": get_settings().agent_model}


@router.get("/about")
def about():
    manifest_path = get_settings().reference_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    return {"reference": manifest}
