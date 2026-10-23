"""Run the makan agent over the eval cases and grade the resulting database state.

    uv run python -m evals.run --model claude-haiku-5-5 --effort low --reps 2
    uv run python -m evals.run --model claude-opus-5-5 --effort low --tags text
    uv run python -m evals.run --model claude-haiku-5-5 --effort low --no-cache --name haiku-low-nocache

Each (case, rep) gets its own SQLite copy of a template database with the reference foods loaded.
Results go to evals/results/<name>/: results.jsonl, errors.jsonl and traces/<case>_rep<k>.json.
"""

import argparse
import asyncio
import json
import random
import re
import shutil
import sys
import time
from dataclasses import asdict
from datetime import date, datetime
from pathlib import Path

import anthropic
from sqlalchemy import select

from evals.cases import CASES, Case, FoodCheck, Item
from makan import foods as food_svc
from makan import log as log_svc
from makan.agent import pricing
from makan.agent.prompt import SYSTEM_PROMPT
from makan.agent.runner import AgentConfig, run_turn
from makan.auth import upsert_user
from makan.config import get_settings
from makan.db import make_engine, session_scope, use_database
from makan.models import Entry, Food, Thread, Turn, User
from makan.photos import save_photo

ROOT = Path(__file__).parent
RESULTS = ROOT / "results"
PHOTOS = ROOT / "photos"
CASE_TIMEOUT_S = 240


def build_template(path: Path) -> None:
    from makan.migrate import upgrade_engine

    if path.exists():
        path.unlink()
    engine = make_engine(f"sqlite:///{path}")
    upgrade_engine(engine)
    use_database(engine)
    with session_scope() as db:
        food_svc.load_reference(db, get_settings().reference_dir, force=True)
    engine.dispose()


def _food_ref(db, ref: str, ours: dict[str, int]) -> int:
    kind, name = ref.split(":", 1)
    if kind == "ours":
        return ours[name]
    source = {"sg": "sgfoodid", "usda": "usda"}[kind]
    food_id = db.scalar(select(Food.id).where(Food.source == source, Food.name == name))
    if food_id is None:
        raise RuntimeError(f"setup food not found: {ref}")
    return food_id


def seed(case: Case) -> tuple[int, dict[str, int]]:
    with session_scope() as db:
        user = upsert_user(db, sub="eval:user", email="eval@example.com", name="Jia")
        upsert_user(db, sub="eval:partner", email="partner@example.com", name="Partner")
        ours: dict[str, int] = {}
        for spec in case.ours:
            food, _ = food_svc.save_ours(
                db,
                user_id=user.id,
                name=spec["name"],
                brand=spec.get("brand"),
                nutrients=spec["nutrients"],
                servings=spec["servings"],
                aliases=spec["aliases"],
            )
            ours[spec["key"]] = food.id
        for day, meal, ref, servings in case.entries:
            log_svc.add_entry(
                db,
                user,
                day=date.fromisoformat(day),
                meal=meal,
                food_id=_food_ref(db, ref, ours),
                servings=servings,
            )
        return user.id, ours


# --- grading -----------------------------------------------------------------------


def _in(value, bounds) -> bool:
    return value is not None and bounds[0] <= value <= bounds[1]


def _item_ok(
    item: Item, e: Entry, ours: dict[str, int], log_date: str, first_ids: set[int] | None = None
) -> bool:
    if not re.search(item.name, e.name, re.IGNORECASE):
        return False
    if item.from_first_turn and first_ids is not None and e.id not in first_ids:
        return False
    if item.meal and e.meal != item.meal:
        return False
    if e.date.isoformat() != (item.date or log_date):
        return False
    if item.kcal and not _in(e.kcal, item.kcal):
        return False
    if item.ours and e.food_id != ours.get(item.ours):
        return False
    return not (item.not_ours and e.food_id == ours.get(item.not_ours))


def _food_ok(check: FoodCheck, food: Food) -> list[str]:
    problems = []
    for nutrient in ("kcal", "protein_g", "carb_g", "fat_g"):
        bounds = getattr(check, nutrient)
        if bounds and not _in(getattr(food, nutrient), bounds):
            problems.append(f"{nutrient}={getattr(food, nutrient)} not in {bounds}")
    if check.serving_grams:
        grams = [s["grams"] for s in food.servings or []]
        if not any(_in(g, b) for g in grams for b in check.serving_grams):
            problems.append(f"servings {grams} miss {check.serving_grams}")
    aliases = set(food.aliases or [])
    for a in check.aliases_include:
        if a not in aliases:
            problems.append(f"alias '{a}' missing (has {sorted(aliases)})")
    for a in check.aliases_exclude:
        if a in aliases:
            problems.append(f"alias '{a}' should have moved")
    return problems


def _match(items: list, entries: list, ok) -> dict[int, int]:
    """Maximum matching of expected items to entries (Kuhn's algorithm). Returns item -> entry index."""
    owner: dict[int, int] = {}

    def assign(i: int, seen: set[int]) -> bool:
        for j, e in enumerate(entries):
            if j in seen or not ok(items[i], e):
                continue
            seen.add(j)
            if j not in owner or assign(owner[j], seen):
                owner[j] = i
                return True
        return False

    for i in range(len(items)):
        assign(i, set())
    return {i: j for j, i in owner.items()}


def grade(
    case: Case, user_id: int, ours: dict[str, int], reply: str, first: dict | None = None
) -> tuple[dict, list[str]]:
    failures: list[str] = []
    first_ids = set(first["ids"]) if first else None
    with session_scope() as db:
        dates = [date.fromisoformat(d) for d in case.check_dates]
        entries = list(
            db.scalars(
                select(Entry)
                .where(Entry.user_id == user_id, Entry.date.in_(dates))
                .order_by(Entry.id)
            )
        )
        required = [i for i in case.expect or [] if not i.optional]
        # Bipartite matching, so an entry that fits two expectations can't starve the second.
        pairs = _match(
            required, entries, lambda i, e: _item_ok(i, e, ours, case.log_date, first_ids)
        )
        hit = len(pairs)
        for idx, item in enumerate(required):
            if idx not in pairs:
                near = [
                    f"{e.date} {e.meal} {e.name} {e.kcal}"
                    for e in entries
                    if re.search(item.name, e.name, re.IGNORECASE)
                ]
                failures.append(
                    f"missing {item.meal} /{item.name}/ {item.kcal or ''} (near: {near or 'none'})"
                )
        unmatched = [e for j, e in enumerate(entries) if j not in pairs.values()]
        for item in [i for i in case.expect or [] if i.optional]:
            match = next(
                (e for e in unmatched if _item_ok(item, e, ours, case.log_date, first_ids)), None
            )
            if match is not None:
                unmatched.remove(match)
        if case.expect is not None and case.strict_count:
            failures += [f"unexpected {e.date} {e.meal} {e.name} {e.kcal}" for e in unmatched]
        elif case.expect is not None:
            meals = {i.meal for i in case.expect}
            failures += [
                f"unexpected {e.date} {e.meal} {e.name}" for e in unmatched if e.meal not in meals
            ]

        food_checks = 0
        for check in case.foods:
            candidates = [
                f
                for f in food_svc.ours_foods(db)
                if re.search(check.name, f"{f.brand or ''} {f.name}".strip(), re.IGNORECASE)
                or re.search(check.name, f.name, re.IGNORECASE)
            ]
            best = None
            for f in candidates:
                problems = _food_ok(check, f)
                if not problems:
                    best = []
                    break
                if best is None or len(problems) < len(best):
                    best = problems
            if best is None:
                failures.append(f"no household food /{check.name}/")
            elif best:
                failures.append(f"food /{check.name}/: " + "; ".join(best))
            else:
                food_checks += 1

        day_entries = [e for e in entries if e.date.isoformat() == case.log_date]
        total = sum(e.kcal or 0 for e in day_entries)
        if case.total_kcal and not _in(total, case.total_kcal):
            failures.append(f"day total {total:.0f} kcal not in {case.total_kcal}")
        for pattern in case.forbid:
            failures += [
                f"should be gone: {e.date} {e.meal} {e.name}"
                for e in entries
                if re.search(pattern, e.name, re.IGNORECASE)
            ]
        if case.total_drop and first:
            drop = first["total"] - total
            if not _in(drop, case.total_drop):
                failures.append(f"day total fell {drop:.0f} kcal, expected {case.total_drop}")
        if case.reply_protein:
            protein = sum(e.protein_g or 0 for e in day_entries)
            numbers = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", reply)]
            if not any(abs(n - protein) <= 3 for n in numbers):
                failures.append(f"reply doesn't state protein ≈{protein:.0f} g")

    checks = len(required) + len(case.foods)
    score = (hit + food_checks) / checks if checks else (1.0 if not failures else 0.0)
    g = {"pass": 0.0 if failures else 1.0, "items": round(score, 3)}
    if case.ref_kcal:
        g["kcal_err"] = round(abs(total - case.ref_kcal) / case.ref_kcal, 3)
    return g, failures


# --- one case ----------------------------------------------------------------------


def _trace(messages: list[dict]) -> list[dict]:
    out: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
    for m in messages:
        content = m["content"]
        if isinstance(content, str):
            out.append({"role": m["role"], "content": content})
            continue
        thinking = None
        for b in content:
            t = b.get("type")
            if t == "text":
                out.append(
                    {
                        "role": m["role"],
                        "content": b["text"],
                        **({"thinking": thinking} if thinking else {}),
                    }
                )
                thinking = None
            elif t == "image":
                out.append({"role": "user", "content": "[photo]"})
            elif t == "thinking":
                thinking = b.get("thinking") or None
            elif t == "tool_use":
                out.append(
                    {
                        "role": "tool_call",
                        "name": b["name"],
                        "content": json.dumps(b["input"], indent=2),
                        **({"thinking": thinking} if thinking else {}),
                    }
                )
                thinking = None
            elif t == "tool_result":
                out.append(
                    {
                        "role": "tool_result",
                        "content": b["content"]
                        if isinstance(b["content"], str)
                        else json.dumps(b["content"]),
                    }
                )
    return out


async def run_case(
    case: Case, rep: int, config: AgentConfig, template: Path, out: Path, client
) -> dict:
    db_path = out / "dbs" / f"{case.id}_rep{rep}.db"
    shutil.copy(template, db_path)
    engine = make_engine(f"sqlite:///{db_path}")
    use_database(engine)
    try:
        user_id, ours = seed(case)
        now = datetime.fromisoformat(case.now).replace(tzinfo=get_settings().tz)
        log_date = date.fromisoformat(case.log_date)
        start = time.monotonic()
        reply = ""
        timings: list[dict] = []
        first: dict | None = None
        thread_id: int | None = None
        for index, msg in enumerate(case.msgs):
            photo_ids = []
            if msg.photo:
                with session_scope() as db:
                    photo_ids.append(save_photo(db, user_id, (PHOTOS / msg.photo).read_bytes()).id)
            timing: dict = {"turn": index}
            turn_start = time.monotonic()
            async for event in run_turn(
                user_id=user_id,
                log_date=log_date,
                text=msg.text,
                photo_ids=photo_ids,
                thread_id=thread_id,
                config=config,
                client=client,
                now=now,
            ):
                elapsed = round(time.monotonic() - turn_start, 2)
                if event["type"] == "turn":
                    thread_id = event["thread_id"]
                if event["type"] == "changed":
                    timing.setdefault("changed_s", elapsed)
                if event["type"] == "text":
                    timing.setdefault("first_text_s", elapsed)
                if event["type"] == "done":
                    timing["done_s"] = elapsed
                if event["type"] == "error":
                    raise RuntimeError(event["message"])
                if event["type"] == "done":
                    reply = event["turn"]["reply_text"]
                    if event["turn"]["status"] != "ok":
                        raise RuntimeError(f"turn status {event['turn']['status']}")
            timings.append(timing)
            if index == 0 and len(case.msgs) > 1:
                with session_scope() as db:
                    day_entries = db.scalars(select(Entry).where(Entry.user_id == user_id)).all()
                    first = {
                        "ids": [e.id for e in day_entries],
                        "total": sum(e.kcal or 0 for e in day_entries if e.date == log_date),
                    }
        latency = time.monotonic() - start

        usage = pricing.empty_usage()
        messages: list[dict] = []
        models = set()
        with session_scope() as db:
            turns = db.scalars(
                select(Turn).join(Thread).where(Thread.user_id == user_id).order_by(Turn.id)
            )
            for t in turns:
                for k in usage:
                    usage[k] += t.usage.get(k, 0)
                models.add(t.usage.get("model"))
                messages += t.messages
        tool_calls = sum(
            1
            for m in messages
            if m["role"] == "assistant"
            for b in m["content"]
            if b.get("type") == "tool_use"
        )
        g, failures = grade(case, user_id, ours, reply, first)
        model = models.pop() if len(models) == 1 else ",".join(sorted(m for m in models if m))
        if model != config.model:
            failures.append(f"served by {model}, requested {config.model}")
            g["pass"] = 0.0
        row = {
            "prompt_id": case.id,
            "rep": rep,
            "prompt": " ⏎ ".join(m.text or f"[photo {m.photo}]" for m in case.msgs),
            "tags": case.tags,
            "status": "ok",
            "grade": g,
            "failures": failures,
            "reply": reply,
            "model": model,
            "effort": config.effort,
            "cache": config.cache,
            "usage": {
                "input_tokens": usage["input"],
                "output_tokens": usage["output"],
                "cache_read_input_tokens": usage["cache_read"],
                "cache_creation_input_tokens": usage["cache_write_5m"] + usage["cache_write_1h"],
            },
            "api_calls": usage["calls"],
            "tool_calls": tool_calls,
            "latency_s": round(latency, 2),
            "turns": timings,
            "first_turn": first,
            "cost_usd": round(pricing.cost(config.model, usage), 6),
        }
        (out / "traces" / f"{case.id}_rep{rep}.json").write_text(
            json.dumps(_trace(messages), indent=1, ensure_ascii=False)
        )
        return row
    finally:
        engine.dispose()


def regrade(out: Path) -> None:
    """Re-grade every finished row from its saved database, after a grader fix."""
    from evals.cases import BY_ID

    path = out / "results.jsonl"
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    for row in rows:
        case = BY_ID[row["prompt_id"]]
        engine = make_engine(f"sqlite:///{out / 'dbs' / f'{case.id}_rep{row["rep"]}.db'}")
        use_database(engine)
        with session_scope() as db:
            user_id = db.scalar(select(User.id).where(User.oidc_sub == "eval:user"))
            ours_ids = list(
                db.scalars(select(Food.id).where(Food.source == "ours").order_by(Food.id))
            )
        ours = {spec["key"]: ours_ids[i] for i, spec in enumerate(case.ours)}
        row["grade"], row["failures"] = grade(
            case, user_id, ours, row["reply"], row.get("first_turn")
        )
        engine.dispose()
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
    print(f"regraded {len(rows)} rows in {path}", file=sys.stderr)


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--model", default="claude-haiku-5-5")
    p.add_argument("--effort", default="low")
    p.add_argument("--reps", type=int, default=1)
    p.add_argument("--tags", default="", help="comma list; a case runs if it has any of them")
    p.add_argument("--cases", default="", help="comma list of case ids")
    p.add_argument("--no-cache", action="store_true")
    p.add_argument("--cache-ttl", default="5m")
    p.add_argument("--concurrency", type=int, default=6)
    p.add_argument("--name", default=None)
    p.add_argument("--regrade", action="store_true", help="re-grade saved results, no API calls")
    args = p.parse_args()

    config = AgentConfig(
        model=args.model, effort=args.effort, cache=not args.no_cache, cache_ttl=args.cache_ttl
    )
    name = (
        args.name
        or f"{args.model.removeprefix('claude-')}-{args.effort}{'-nocache' if args.no_cache else ''}"
    )
    out = RESULTS / name
    if args.regrade:
        regrade(out)
        return
    (out / "traces").mkdir(parents=True, exist_ok=True)
    (out / "dbs").mkdir(exist_ok=True)
    (out / "config.json").write_text(json.dumps(asdict(config), indent=1))

    cases = CASES
    if args.cases:
        wanted = set(args.cases.split(","))
        cases = [c for c in cases if c.id in wanted]
    if args.tags:
        tags = set(args.tags.split(","))
        cases = [c for c in cases if tags & set(c.tags)]

    results_path = out / "results.jsonl"
    done = set()
    if results_path.exists():
        for line in results_path.read_text().splitlines():
            row = json.loads(line)
            done.add((row["prompt_id"], row["rep"]))
    todo = [(c, r) for c in cases for r in range(args.reps) if (c.id, r) not in done]
    print(f"{name}: {len(todo)} runs ({len(done)} already done)", file=sys.stderr)

    template = RESULTS / "_template.db"
    if not template.exists():
        build_template(template)

    client = anthropic.AsyncAnthropic(api_key=get_settings().anthropic_api_key, max_retries=4)
    sem = asyncio.Semaphore(args.concurrency)
    lock = asyncio.Lock()

    async def one(case: Case, rep: int) -> None:
        async with sem:
            await asyncio.sleep(random.random() * 0.5)
            try:
                row = await asyncio.wait_for(
                    run_case(case, rep, config, template, out, client), CASE_TIMEOUT_S
                )
                async with lock:
                    with results_path.open("a") as fh:
                        fh.write(json.dumps(row, ensure_ascii=False) + "\n")
                mark = "PASS" if row["grade"]["pass"] else "FAIL"
                print(
                    f"  {mark} {case.id}#{rep} ${row['cost_usd']:.4f} {row['latency_s']}s {'; '.join(row['failures'])[:300]}",
                    file=sys.stderr,
                )
            except Exception as exc:  # noqa: BLE001 - every failure is recorded, not raised
                kind = "timeout" if isinstance(exc, TimeoutError) else type(exc).__name__
                async with lock:
                    with (out / "errors.jsonl").open("a") as fh:
                        fh.write(
                            json.dumps(
                                {
                                    "prompt_id": case.id,
                                    "rep": rep,
                                    "class": kind,
                                    "message": str(exc)[:500],
                                }
                            )
                            + "\n"
                        )
                print(f"  ERROR {case.id}#{rep} {kind}: {str(exc)[:200]}", file=sys.stderr)

    await asyncio.gather(*(one(c, r) for c, r in todo))
    print(f"wrote {results_path}", file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main())
