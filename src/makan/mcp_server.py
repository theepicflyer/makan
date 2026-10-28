"""Read-only MCP server for analysis agents (e.g. a Claude fitness analyst on claude.ai).

claude.ai connectors need an OAuth server with dynamic client registration, so FastMCP's OIDCProxy
fronts Pocket ID: DCR on the outside, one pre-registered Pocket ID client on the inside. The caller
sees only the log of the person who signed in.
"""

from datetime import date
from typing import Annotated, Any

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from fastmcp.server.auth.oidc_proxy import OIDCProxy
from fastmcp.server.dependencies import get_access_token
from pydantic import Field
from sqlalchemy import select

from makan import foods as food_svc
from makan import log as log_svc
from makan.auth import upsert_user
from makan.config import get_settings
from makan.db import session_scope
from makan.models import MEALS, NUTRIENTS, Food, User

MAX_RANGE_DAYS = 400

INSTRUCTIONS = """\
Read-only access to one person's food log from makan, a calorie and macro tracker used in \
Singapore. Entries are grouped by date and meal (breakfast, lunch, dinner, snacks). Nutrients are \
totals for the portion eaten: kcal, protein_g, carb_g, fat_g, fibre_g, sugar_g, sodium_mg, \
sat_fat_g (null when the source food has no value). A day with zero entries means nothing was \
logged, not that nothing was eaten. Entries marked is_estimate were estimated (often from a photo) \
rather than taken from a database food. Start with get_profile for targets, then get_daily_totals \
for trends and get_food_log for detail."""


def build_auth() -> OIDCProxy | None:
    s = get_settings()
    if not s.oidc_config_url:
        return None
    return OIDCProxy(
        config_url=s.oidc_config_url,
        client_id=s.oidc_client_id,
        client_secret=s.oidc_client_secret,
        base_url=s.public_url,
        # No required_scopes: claude.ai requests none, and a scope check then rejects every call
        # with "missing required scopes (has [])". Pin the upstream scopes instead; Pocket ID
        # needs openid.
        extra_authorize_params={"scope": "openid profile email"},
        # Pocket ID rejects the RFC 8707 `resource` parameter claude.ai sends.
        forward_resource=False,
        # Registrations go through /register so they are inspectable records in the store.
        enable_cimd=False,
        # A DCR proxy that accepts any redirect URI is an open redirector.
        allowed_client_redirect_uris=s.dcr_redirect_uris,
    )


mcp = FastMCP(name="makan", instructions=INSTRUCTIONS, auth=build_auth())


def _user(db) -> User:
    settings = get_settings()
    token = get_access_token()
    if token is None:
        if not settings.oidc_config_url and settings.mcp_dev_user:
            name = settings.mcp_dev_user
            return upsert_user(
                db, sub=f"dev:{name.lower()}", email=f"{name.lower()}@dev.local", name=name
            )
        raise ToolError("Not authenticated")
    claims = token.claims or {}
    sub = claims.get("sub") or (claims.get("upstream_claims") or {}).get("sub")
    user = db.scalar(select(User).where(User.oidc_sub == sub)) if sub else None
    if user is None:
        raise ToolError(
            "No makan account for this login. Sign in to makan in a browser once, then retry."
        )
    return user


def _range(start_date: str, end_date: str) -> tuple[date, date]:
    try:
        start, end = date.fromisoformat(start_date), date.fromisoformat(end_date)
    except ValueError as exc:
        raise ToolError("Dates must be YYYY-MM-DD") from exc
    if end < start:
        raise ToolError("end_date is before start_date")
    if (end - start).days >= MAX_RANGE_DAYS:
        raise ToolError(f"Ask for at most {MAX_RANGE_DAYS} days at a time")
    return start, end


def _round(values: dict[str, float | None]) -> dict[str, float | None]:
    return {k: (None if v is None else round(v, 1)) for k, v in values.items()}


def _food_out(food: Food) -> dict[str, Any]:
    return {
        "food_id": food.id,
        "name": food.name,
        "brand": food.brand,
        "source": food_svc.SOURCE_LABEL[food.source],
        "per_100g": _round(food.nutrients()),
        "servings": food.servings or [],
        "aliases": food.aliases or [],
    }


@mcp.tool(annotations={"readOnlyHint": True})
def get_profile() -> dict[str, Any]:
    """The signed-in person's name, daily targets, timezone and today's date."""
    settings = get_settings()
    with session_scope() as db:
        user = _user(db)
        return {
            "name": user.name,
            "targets_per_day": log_svc.targets(user),
            "timezone": settings.timezone,
            "today": settings.today().isoformat(),
            "nutrients": list(NUTRIENTS),
            "meals": list(MEALS),
        }


@mcp.tool(annotations={"readOnlyHint": True})
def get_daily_totals(
    start_date: Annotated[str, Field(description="First day, YYYY-MM-DD")],
    end_date: Annotated[str, Field(description="Last day (inclusive), YYYY-MM-DD")],
) -> dict[str, Any]:
    """Nutrient totals for each day in a range, with the person's targets. Days with entries=0 weren't logged."""
    start, end = _range(start_date, end_date)
    with session_scope() as db:
        user = _user(db)
        return {
            "targets_per_day": log_svc.targets(user),
            "days": log_svc.daily_totals(db, user, start, end),
        }


@mcp.tool(annotations={"readOnlyHint": True})
def get_food_log(
    start_date: Annotated[str, Field(description="First day, YYYY-MM-DD")],
    end_date: Annotated[str, Field(description="Last day (inclusive), YYYY-MM-DD")],
) -> dict[str, Any]:
    """Every logged item in a date range, grouped by date and meal, with per-item nutrients."""
    start, end = _range(start_date, end_date)
    with session_scope() as db:
        user = _user(db)
        entries = log_svc.entries_between(db, user, start, end)
        sources = {
            f.id: f.source
            for f in db.scalars(
                select(Food).where(Food.id.in_({e.food_id for e in entries if e.food_id}))
            )
        }
        days: dict[str, dict[str, list]] = {}
        for e in entries:
            meals = days.setdefault(e.date.isoformat(), {m: [] for m in MEALS})
            meals.setdefault(e.meal, []).append(
                {
                    "name": e.name,
                    "portion": food_svc.describe_portion(e.servings, e.serving_label, e.grams),
                    "grams": e.grams,
                    "is_estimate": e.is_estimate,
                    "source": food_svc.SOURCE_LABEL.get(sources.get(e.food_id, ""), "custom"),
                    "note": e.note,
                    **_round(e.nutrients()),
                }
            )
        return {"days": days}


@mcp.tool(annotations={"readOnlyHint": True})
def search_foods(
    query: Annotated[str, Field(description="Food name, e.g. 'laksa' or 'greek yogurt'")],
    limit: Annotated[int, Field(ge=1, le=25)] = 10,
) -> dict[str, Any]:
    """Search the shared food database (household foods, SG FoodID, USDA). Nutrients are per 100 g."""
    with session_scope() as db:
        _user(db)
        return {"results": [_food_out(h.food) for h in food_svc.search(db, query, limit=limit)]}


@mcp.tool(annotations={"readOnlyHint": True})
def list_household_foods() -> dict[str, Any]:
    """The household's own foods (packaged items and usual orders), with servings and aliases."""
    with session_scope() as db:
        _user(db)
        return {"foods": [_food_out(f) for f in food_svc.ours_foods(db)]}
