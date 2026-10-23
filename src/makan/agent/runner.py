"""The agent loop: one user message in, tool calls against the log, a short reply out.

History is append-only. Each turn's API messages are stored as the API returned them and replayed
unchanged, which keeps the prompt cache warm and keeps thinking blocks valid.
"""

import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

import anthropic
from sqlalchemy import select
from sqlalchemy.orm import Session

from makan import foods as food_svc
from makan import log as log_svc
from makan.agent import pricing
from makan.agent.prompt import SYSTEM_PROMPT, build_context
from makan.agent.tools import TOOLS, WRITE_TOOLS, ToolContext, run_tool
from makan.config import get_settings
from makan.db import new_session
from makan.models import Change, Photo, Thread, Turn, User
from makan.photos import photo_b64

log = logging.getLogger(__name__)

# Models that accept server-side refusal fallbacks (`fallbacks: "default"`).
FALLBACK_MODELS = {"claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5"}
FALLBACK_BETA = "server-side-fallback-2026-07-01"


@dataclass(frozen=True)
class AgentConfig:
    model: str
    effort: str
    cache: bool = True
    cache_ttl: str = "5m"
    max_tokens: int = 16000
    max_iterations: int = 8

    @classmethod
    def from_settings(cls) -> "AgentConfig":
        s = get_settings()
        return cls(model=s.agent_model, effort=s.agent_effort, max_tokens=s.agent_max_tokens)


def _cache_control(config: AgentConfig) -> dict[str, str]:
    cc = {"type": "ephemeral"}
    if config.cache_ttl == "1h":
        cc["ttl"] = "1h"
    return cc


def _hydrate(
    messages: list[dict[str, Any]], db: Session, cache: dict[int, str]
) -> list[dict[str, Any]]:
    """Swap stored photo references for base64 image data."""
    out = []
    for msg in messages:
        content = msg["content"]
        if isinstance(content, list) and any(b.get("type") == "image" for b in content):
            blocks = []
            for b in content:
                if b.get("type") == "image" and b["source"].get("type") == "photo_ref":
                    photo_id = b["source"]["photo_id"]
                    if photo_id not in cache:
                        photo = db.get(Photo, photo_id)
                        cache[photo_id] = photo_b64(photo) if photo else ""
                    if cache[photo_id]:
                        blocks.append(
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": "image/jpeg",
                                    "data": cache[photo_id],
                                },
                            }
                        )
                    else:
                        blocks.append({"type": "text", "text": "(photo no longer available)"})
                else:
                    blocks.append(b)
            out.append({**msg, "content": blocks})
        else:
            out.append(msg)
    return out


def _get_thread(db: Session, user: User, day: date, model: str) -> Thread:
    thread = db.scalar(select(Thread).where(Thread.user_id == user.id, Thread.date == day))
    if thread is None:
        thread = Thread(user_id=user.id, date=day, model=model)
        db.add(thread)
        db.flush()
    return thread


def turn_changes(db: Session, turn_id: int) -> list[dict[str, Any]]:
    out = []
    for ch in db.scalars(select(Change).where(Change.turn_id == turn_id).order_by(Change.id)):
        snap = ch.after or ch.before or {}
        change = {
            "table": ch.table,
            "action": ch.action,
            "row_id": ch.row_id,
            "name": snap.get("name"),
            "kcal": snap.get("kcal"),
        }
        if ch.table == "foods":
            change.update(_food_change(snap))
        out.append(change)
    return out


def _food_change(snap: dict[str, Any]) -> dict[str, Any]:
    """A food's calories per its default serving (else per 100 g) and its aliases, for the change card."""
    servings = snap.get("servings") or []
    serving = next((s for s in servings if s.get("default")), None)
    kcal = snap.get("kcal")
    if serving is None:
        return {"serving": "100 g", "kcal": kcal, "aliases": snap.get("aliases") or []}
    return {
        "serving": serving["label"],
        "kcal": None if kcal is None else kcal * serving["grams"] / 100,
        "aliases": snap.get("aliases") or [],
    }


def turn_photo_ids(turn: Turn) -> list[int]:
    """The photos sent with a turn, read from its stored user message (turn.photo_id is only the first)."""
    content = turn.messages[0]["content"] if turn.messages else []
    return [
        b["source"]["photo_id"]
        for b in content
        if isinstance(b, dict)
        and b.get("type") == "image"
        and b["source"].get("type") == "photo_ref"
    ]


def serialize_turn(db: Session, turn: Turn) -> dict[str, Any]:
    return {
        "id": turn.id,
        "user_text": turn.user_text,
        "photo_ids": turn_photo_ids(turn),
        "reply_text": turn.reply_text,
        "status": turn.status,
        "undone": turn.undone_at is not None,
        "changes": turn_changes(db, turn.id),
        "cost_usd": round(turn.cost_usd, 5),
        "created_at": turn.created_at.isoformat(),
    }


async def run_turn(
    *,
    user_id: int,
    log_date: date,
    text: str,
    photo_ids: list[int] | None = None,
    config: AgentConfig | None = None,
    client: anthropic.AsyncAnthropic | None = None,
    now: datetime | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Run one agent turn, yielding UI events. The final event is 'done' or 'error'."""
    config = config or AgentConfig.from_settings()
    client = client or anthropic.AsyncAnthropic(api_key=get_settings().anthropic_api_key)
    now = now or get_settings().now()
    photo_ids = photo_ids or []
    db = new_session()
    try:
        user = db.get(User, user_id)
        assert user is not None
        thread = _get_thread(db, user, log_date, config.model)
        prior = list(
            db.scalars(
                select(Turn)
                .where(Turn.thread_id == thread.id, Turn.status == "ok")
                .order_by(Turn.id)
            )
        )
        ours = food_svc.ours_foods(db)
        fingerprint = food_svc.ours_fingerprint(ours)
        context = build_context(
            db,
            user,
            now=now,
            log_date=log_date,
            include_foods=thread.foods_fingerprint != fingerprint,
            include_frequent=not prior,
        )

        content: list[dict[str, Any]] = []
        for number, photo_id in enumerate(photo_ids, 1):
            if len(photo_ids) > 1:
                content.append({"type": "text", "text": f"Photo {number}:"})
            content.append({"type": "image", "source": {"type": "photo_ref", "photo_id": photo_id}})
        content.append(
            {"type": "text", "text": f"{context}\n\n{text.strip() or '(photo only, no message)'}"}
        )
        turn = Turn(
            thread_id=thread.id,
            user_text=text,
            photo_id=photo_ids[0] if photo_ids else None,
            messages=[{"role": "user", "content": content}],
            status="running",
        )
        db.add(turn)
        db.commit()
        yield {"type": "turn", "turn_id": turn.id}

        history: list[dict[str, Any]] = [m for t in prior for m in t.messages]
        photo_cache: dict[int, str] = {}
        usage = pricing.empty_usage()
        turn_messages = list(turn.messages)
        changes = log_svc.ChangeLog(db, turn.id)
        ctx = ToolContext(db=db, user=user, log_date=log_date, changes=changes, photo_ids=photo_ids)
        reply_parts: list[str] = []
        status = "ok"
        model_used = config.model

        system = [{"type": "text", "text": SYSTEM_PROMPT}]
        params: dict[str, Any] = {
            "model": config.model,
            "max_tokens": config.max_tokens,
            "tools": TOOLS,
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": config.effort},
        }
        betas: list[str] = []
        if config.cache:
            system[0]["cache_control"] = _cache_control(config)
            params["cache_control"] = _cache_control(config)
        if config.model in FALLBACK_MODELS:
            params["fallbacks"] = "default"
            betas.append(FALLBACK_BETA)
        params["system"] = system

        for _ in range(config.max_iterations):
            messages = _hydrate(history + turn_messages, db, photo_cache)
            async with client.beta.messages.stream(
                **params, messages=messages, betas=betas
            ) as stream:
                async for event in stream:
                    if event.type == "text":
                        yield {"type": "text", "delta": event.text}
                final = await stream.get_final_message()
            pricing.add_usage(usage, final.usage)
            model_used = final.model or config.model
            assistant_content = [b.to_dict(mode="json") for b in final.content]
            turn_messages.append({"role": "assistant", "content": assistant_content})
            texts = [b.text for b in final.content if b.type == "text"]

            if final.stop_reason == "refusal":
                reply_parts = ["Sorry, I couldn't process that one."]
                status = "refused"
                break
            tool_uses = [b for b in final.content if b.type == "tool_use"]
            if final.stop_reason == "max_tokens" and tool_uses:
                turn_messages.pop()
                reply_parts = [
                    "That was too long for me to finish. Try splitting it into smaller messages."
                ]
                status = "error"
                break
            if not tool_uses:
                reply_parts = texts
                break
            if texts:
                yield {"type": "text", "delta": "\n"}

            results = []
            wrote: set[str] = set()
            for block in tool_uses:
                yield {"type": "tool", "name": block.name}
                result, is_error = run_tool(ctx, block.name, block.input)
                if block.name in WRITE_TOOLS and not is_error:
                    wrote.add(block.name)
                results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result,
                        **({"is_error": True} if is_error else {}),
                    }
                )
            turn_messages.append({"role": "user", "content": results})
            db.commit()
            if wrote:
                yield {"type": "changed", "dates": sorted(d.isoformat() for d in ctx.days_touched)}
        else:
            reply_parts = reply_parts or [
                "I stopped before finishing. Check the log and tell me what's missing."
            ]
            status = "error"

        turn.messages = turn_messages
        turn.reply_text = "\n".join(p.strip() for p in reply_parts if p.strip())
        turn.usage = usage | {"model": model_used}
        turn.cost_usd = pricing.cost(model_used, usage)
        # Only "ok" turns are replayed as history; the others may end mid tool call.
        turn.status = status
        if status == "ok":
            thread.foods_fingerprint = fingerprint
        db.commit()
        yield {
            "type": "done",
            "turn": serialize_turn(db, turn),
            "dates": sorted(d.isoformat() for d in ctx.days_touched),
        }
    except anthropic.APIError as exc:
        db.rollback()
        log.exception("agent API error")
        _mark_failed(db, locals().get("turn"))
        yield {
            "type": "error",
            "message": f"The assistant is unavailable right now ({exc.__class__.__name__}).",
        }
    except Exception:
        db.rollback()
        log.exception("agent turn failed")
        _mark_failed(db, locals().get("turn"))
        yield {
            "type": "error",
            "message": "Something went wrong. Nothing after the last confirmed change was saved.",
        }
    finally:
        db.close()


def _mark_failed(db: Session, turn: Turn | None) -> None:
    if turn is None or turn.id is None:
        return
    try:
        fresh = db.get(Turn, turn.id)
        if fresh is not None:
            fresh.status = "error"
            fresh.reply_text = fresh.reply_text or "Something went wrong."
            db.commit()
    except Exception:  # noqa: BLE001 - best effort while already handling a failure
        db.rollback()


def undo_turn(db: Session, user: User, turn_id: int) -> Turn:
    turn = db.get(Turn, turn_id)
    if turn is None:
        raise log_svc.LogError(f"No turn {turn_id}")
    thread = db.get(Thread, turn.thread_id)
    if thread is None or thread.user_id != user.id:
        raise log_svc.LogError(f"No turn {turn_id}")
    if turn.undone_at is None:
        log_svc.undo_changes(db, turn.id)
        turn.undone_at = datetime.now(get_settings().tz)
        db.flush()
    return turn
