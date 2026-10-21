"""Food lookup, search, portions, and the editable household ("ours") list."""

import gzip
import hashlib
import json
import logging
import math
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from makan.models import NUTRIENTS, Entry, Food, Meta

log = logging.getLogger(__name__)

SOURCE_BOOST = {"ours": 12.0, "sgfoodid": 2.0, "usda": 0.0}
SOURCE_LABEL = {"ours": "Ours", "sgfoodid": "SG FoodID", "usda": "USDA"}
_TOKEN = re.compile(r"[\w']+", re.UNICODE)


class FoodError(ValueError):
    pass


# --- full-text index ---------------------------------------------------------


def _fts_extra(food: Food) -> str:
    parts = [*(food.aliases or []), food.brand or ""]
    return " ".join(p for p in parts if p)


def index_food(db: Session, food: Food) -> None:
    db.execute(text("DELETE FROM food_fts WHERE rowid = :id"), {"id": food.id})
    if food.deleted_at is None:
        db.execute(
            text("INSERT INTO food_fts(rowid, name, extra) VALUES (:id, :name, :extra)"),
            {"id": food.id, "name": food.name, "extra": _fts_extra(food)},
        )


def _fts_query(q: str, mode: str) -> str | None:
    tokens = [t.lower() for t in _TOKEN.findall(q) if t.strip("'")]
    if not tokens:
        return None
    joiner = " AND " if mode == "and" else " OR "
    return joiner.join(f'"{t.replace(chr(34), "")}"*' for t in tokens)


# Spelling variants seen in hawker orders, tried as alternative queries.
_VARIANTS = [
    (re.compile(r"\bbee hoon\b"), "beehoon"),
    (re.compile(r"\bsiew\b"), "siu"),
    (re.compile(r"\bkachang\b"), "kacang"),
    (re.compile(r"\bk(?:ue|oa)y teow\b"), "kway teow"),
    (re.compile(r"\bwonton\b"), "wanton"),
    (re.compile(r"\bkosong\b"), "kosong"),
]


def _query_variants(q: str) -> list[str]:
    base = " ".join(t.lower() for t in _TOKEN.findall(q))
    variants = [base]
    alt = base
    for pattern, repl in _VARIANTS:
        alt = pattern.sub(repl, alt)
    if " peng" in f" {alt}" and "peng" in alt.split():
        alt = "iced " + " ".join(t for t in alt.split() if t != "peng")
    if alt != base:
        variants.append(alt)
    return variants


@dataclass
class SearchHit:
    food: Food
    score: float


def search(
    db: Session, q: str, limit: int = 10, sources: tuple[str, ...] | None = None
) -> list[SearchHit]:
    q = q.strip()
    if not q:
        return []
    best: dict[int, float] = {}
    for variant in _query_variants(q):
        for mode in ("and", "or"):
            match = _fts_query(variant, mode)
            if match is None:
                break
            found = db.execute(
                text(
                    "SELECT rowid, bm25(food_fts, 10.0, 6.0) AS rank FROM food_fts "
                    "WHERE food_fts MATCH :m ORDER BY rank LIMIT 300"
                ),
                {"m": match},
            ).all()
            # An all-words match outranks any partial match.
            penalty = 0.0 if mode == "and" else 15.0
            for rowid, rank in found:
                best[rowid] = min(best.get(rowid, 1e9), rank + penalty)
            if found:
                break
    if not best:
        return []
    rows = sorted(best.items(), key=lambda r: r[1])[:300]
    ids = [r[0] for r in rows]
    foods = {
        f.id: f for f in db.scalars(select(Food).where(Food.id.in_(ids), Food.deleted_at.is_(None)))
    }
    popularity = dict(
        db.execute(
            select(Entry.food_id, func.count())
            .where(Entry.food_id.in_(ids))
            .group_by(Entry.food_id)
        ).all()
    )
    q_forms = set(_query_variants(q))
    hits = []
    for food_id, rank in rows:
        food = foods.get(food_id)
        if food is None or (sources and food.source not in sources):
            continue
        score = -rank + SOURCE_BOOST.get(food.source, 0.0)
        score += 2.0 * math.log2(1 + popularity.get(food_id, 0))
        name_norm = " ".join(t.lower() for t in _TOKEN.findall(food.name))
        if name_norm in q_forms:
            score += 8.0
        if any(a.lower().strip() in q_forms for a in food.aliases or []):
            score += 20.0
        # Short names are usually the generic item ("Egg, whole, raw" over "Egg, whole, cooked, ...").
        score -= 0.04 * len(food.name)
        hits.append(SearchHit(food, score))
    hits.sort(key=lambda h: h.score, reverse=True)
    # USDA repeats many foods across its Foundation, SR Legacy and FNDDS sets; keep the best-ranked one.
    out, seen_names = [], set()
    for h in hits:
        key = (h.food.source, h.food.name.lower())
        if h.food.source == "usda" and key in seen_names:
            continue
        seen_names.add(key)
        out.append(h)
        if len(out) >= limit:
            break
    return out


# --- portions ----------------------------------------------------------------


def normalize_label(label: str) -> str:
    label = label.strip().lower()
    label = re.sub(r"\(s\)|\(es\)", "", label)
    label = re.sub(r"^(1|one|a|an)\s+", "", label)
    return re.sub(r"\s+", " ", label).strip()


def default_serving(food: Food) -> dict[str, Any] | None:
    servings = food.servings or []
    for s in servings:
        if s.get("default"):
            return s
    return servings[0] if servings else None


def find_serving(food: Food, label: str | None) -> dict[str, Any] | None:
    if not label:
        return default_serving(food)
    want = normalize_label(label)
    servings = food.servings or []
    for s in servings:
        if normalize_label(s["label"]) == want:
            return s
    for s in servings:
        have = normalize_label(s["label"])
        if have.startswith(want) or want.startswith(have) or want in have.split():
            return s
    return None


@dataclass
class Portion:
    grams: float
    servings: float | None
    serving_label: str | None


def resolve_portion(
    food: Food,
    servings: float | None = None,
    serving: str | None = None,
    grams: float | None = None,
) -> Portion:
    if grams is not None:
        if grams <= 0:
            raise FoodError("grams must be positive")
        return Portion(grams=grams, servings=None, serving_label=None)
    count = 1.0 if servings is None else servings
    if count <= 0:
        raise FoodError("servings must be positive")
    s = find_serving(food, serving)
    if s is None and serving:
        unit = re.fullmatch(r"(\d+(?:\.\d+)?)?\s*(g|gram|grams|ml)", normalize_label(serving))
        if unit:
            per = float(unit.group(1) or 1)
            if per == 1:
                return Portion(grams=count, servings=None, serving_label=None)
            return Portion(grams=per * count, servings=count, serving_label=f"{per:g} g")
    if s is None:
        if serving:
            known = ", ".join(x["label"] for x in food.servings or []) or "none"
            raise FoodError(
                f"'{food.name}' has no '{serving}' serving (known: {known}). Pass grams instead."
            )
        return Portion(grams=100.0 * count, servings=count, serving_label="100 g")
    return Portion(grams=s["grams"] * count, servings=count, serving_label=s["label"])


def scale(food: Food, grams: float) -> dict[str, float | None]:
    factor = grams / 100.0
    return {
        n: (None if getattr(food, n) is None else round(getattr(food, n) * factor, 2))
        for n in NUTRIENTS
    }


def describe_portion(servings: float | None, serving_label: str | None, grams: float | None) -> str:
    if serving_label and servings is not None:
        qty = f"{servings:g}"
        return f"{qty} × {serving_label}" + (f" ({grams:g} g)" if grams else "")
    if grams is not None:
        return f"{grams:g} g"
    return ""


# --- household foods ---------------------------------------------------------


def ours_foods(db: Session) -> list[Food]:
    return list(
        db.scalars(
            select(Food).where(Food.source == "ours", Food.deleted_at.is_(None)).order_by(Food.name)
        )
    )


def ours_fingerprint(foods: list[Food]) -> str:
    payload = [
        (f.id, f.name, f.brand, f.aliases, f.servings, [getattr(f, n) for n in NUTRIENTS])
        for f in foods
    ]
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[
        :16
    ]


def get_food(db: Session, food_id: int, *, include_deleted: bool = False) -> Food:
    food = db.get(Food, food_id)
    if food is None or (food.deleted_at is not None and not include_deleted):
        raise FoodError(f"No food with id {food_id}")
    return food


def _clean_servings(servings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen = set()
    for s in servings:
        label = str(s.get("label", "")).strip()
        grams = float(s.get("grams") or 0)
        if not label or grams <= 0:
            raise FoodError("each serving needs a label and grams > 0")
        key = normalize_label(label)
        if key in seen:
            continue
        seen.add(key)
        out.append({"label": label, "grams": round(grams, 2), "default": bool(s.get("default"))})
    if out and not any(s["default"] for s in out):
        out[0]["default"] = True
    if sum(s["default"] for s in out) > 1:
        first = next(i for i, s in enumerate(out) if s["default"])
        for i, s in enumerate(out):
            s["default"] = i == first
    return out


def _clean_aliases(aliases: list[str]) -> list[str]:
    out = []
    for a in aliases:
        a = a.strip().lower()
        if a and a not in out:
            out.append(a)
    return out


def food_snapshot(food: Food) -> dict[str, Any]:
    return {
        "name": food.name,
        "brand": food.brand,
        "description": food.description,
        "servings": food.servings,
        "aliases": food.aliases,
        "deleted_at": food.deleted_at.isoformat() if food.deleted_at else None,
        **food.nutrients(),
    }


def save_ours(
    db: Session,
    *,
    user_id: int | None,
    food_id: int | None = None,
    name: str | None = None,
    brand: str | None = None,
    description: str | None = None,
    nutrients: dict[str, float | None] | None = None,
    servings: list[dict[str, Any]] | None = None,
    aliases: list[str] | None = None,
) -> tuple[Food, dict[str, Any] | None]:
    """Create or update a household food. Returns the food and its prior snapshot (None if new)."""
    if food_id is not None:
        food = get_food(db, food_id)
        if food.source != "ours":
            raise FoodError(
                f"'{food.name}' is reference data ({SOURCE_LABEL[food.source]}) and can't be edited"
            )
        before = food_snapshot(food)
    else:
        if not name or not name.strip():
            raise FoodError("a new food needs a name")
        if not nutrients or nutrients.get("kcal") is None:
            raise FoodError("a new food needs kcal per 100 g")
        food = Food(source="ours", created_by=user_id, servings=[], aliases=[], meta={})
        db.add(food)
        before = None
    if name is not None:
        food.name = name.strip()
    if brand is not None:
        food.brand = brand.strip() or None
    if description is not None:
        food.description = description.strip() or None
    if nutrients is not None:
        for n in NUTRIENTS:
            if n in nutrients:
                value = nutrients[n]
                if value is not None and value < 0:
                    raise FoodError(f"{n} can't be negative")
                setattr(food, n, value)
    if servings is not None:
        food.servings = _clean_servings(servings)
    if aliases is not None:
        new_aliases = _clean_aliases(aliases)
        # An alias points to one household food; taking it moves it off any other.
        for other in ours_foods(db):
            if other is not food and set(other.aliases or []) & set(new_aliases):
                other.aliases = [a for a in other.aliases if a not in new_aliases]
                db.flush()
                index_food(db, other)
        food.aliases = new_aliases
    db.flush()
    index_food(db, food)
    return food, before


def delete_ours(db: Session, food_id: int) -> tuple[Food, dict[str, Any]]:
    food = get_food(db, food_id)
    if food.source != "ours":
        raise FoodError(f"'{food.name}' is reference data and can't be deleted")
    before = food_snapshot(food)
    food.deleted_at = datetime.now(UTC)
    db.flush()
    index_food(db, food)
    return food, before


def restore_food(db: Session, food_id: int, snapshot: dict[str, Any] | None) -> None:
    """Put a household food back to a snapshot (None removes a food that was created)."""
    food = db.get(Food, food_id)
    if food is None:
        return
    if snapshot is None:
        food.deleted_at = datetime.now(UTC)
    else:
        for key in ("name", "brand", "description", "servings", "aliases", *NUTRIENTS):
            setattr(food, key, snapshot.get(key))
        food.deleted_at = (
            datetime.fromisoformat(snapshot["deleted_at"]) if snapshot.get("deleted_at") else None
        )
    db.flush()
    index_food(db, food)


# --- reference data ----------------------------------------------------------


def _apply_reference_aliases(db: Session, reference_dir: Path) -> None:
    path = reference_dir / "aliases.json"
    if not path.exists():
        return
    curated = {k: v for k, v in json.loads(path.read_text()).items() if not k.startswith("_")}
    for key, aliases in curated.items():
        source, name = key.split(":", 1)
        food = db.scalar(
            select(Food).where(Food.source == source, Food.name == name, Food.deleted_at.is_(None))
        )
        if food is None:
            log.warning("aliases.json: no %s food named %r", source, name)
            continue
        food.aliases = _clean_aliases(aliases)
    db.flush()


_USDA_NOISE = re.compile(
    r"\s*\(Includes foods for USDA's Food Distribution Program\)", re.IGNORECASE
)


def _reference_files(reference_dir: Path) -> list[Path]:
    return sorted(reference_dir.glob("*.jsonl.gz"))


def reference_fingerprint(reference_dir: Path) -> str:
    h = hashlib.sha256()
    for p in [*_reference_files(reference_dir), reference_dir / "aliases.json"]:
        if not p.exists():
            continue
        h.update(p.name.encode())
        h.update(p.read_bytes())
    return h.hexdigest()[:16]


def load_reference(db: Session, reference_dir: Path, *, force: bool = False) -> int:
    """Upsert the read-only reference foods. Ids stay stable so old log entries keep their links."""
    files = _reference_files(reference_dir)
    if not files:
        return 0
    fingerprint = reference_fingerprint(reference_dir)
    current = db.get(Meta, "reference_fingerprint")
    if current is not None and current.value == fingerprint and not force:
        return 0

    existing = {
        (source, ref): food_id
        for food_id, source, ref in db.execute(
            select(Food.id, Food.source, Food.source_ref).where(Food.source != "ours")
        ).all()
    }
    seen: set[tuple[str, str]] = set()
    count = 0
    for path in files:
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            for line in fh:
                rec = json.loads(line)
                key = (rec["source"], str(rec["source_ref"]))
                seen.add(key)
                values = {
                    "source": rec["source"],
                    "source_ref": str(rec["source_ref"]),
                    "name": _USDA_NOISE.sub("", rec["name"]).strip(),
                    "brand": rec.get("brand"),
                    "description": rec.get("description"),
                    "category": rec.get("category"),
                    "servings": rec.get("servings") or [],
                    "aliases": [],
                    "meta": rec.get("meta") or {},
                    "deleted_at": None,
                    **{n: rec["per_100g"].get(n) for n in NUTRIENTS},
                }
                if key in existing:
                    db.execute(
                        Food.__table__.update().where(Food.id == existing[key]).values(**values)
                    )
                else:
                    result = db.execute(Food.__table__.insert().values(**values))
                    existing[key] = result.inserted_primary_key[0]
                count += 1

    _apply_reference_aliases(db, reference_dir)

    gone = [fid for key, fid in existing.items() if key not in seen]
    if gone:
        db.execute(
            Food.__table__.update().where(Food.id.in_(gone)).values(deleted_at=datetime.now(UTC))
        )

    # Rebuild the index for reference rows in one pass.
    ours_ids = [f.id for f in ours_foods(db)]
    db.execute(text("DELETE FROM food_fts"))
    db.execute(
        text(
            "INSERT INTO food_fts(rowid, name, extra) "
            "SELECT id, name, COALESCE(brand, '') FROM foods "
            "WHERE source != 'ours' AND deleted_at IS NULL AND aliases = '[]'"
        )
    )
    aliased = select(Food).where(
        Food.source != "ours", Food.deleted_at.is_(None), Food.aliases != []
    )
    for food in [*db.scalars(aliased), *db.scalars(select(Food).where(Food.id.in_(ours_ids)))]:
        index_food(db, food)

    if current is None:
        db.add(Meta(key="reference_fingerprint", value=fingerprint))
    else:
        current.value = fingerprint
    db.flush()
    return count
