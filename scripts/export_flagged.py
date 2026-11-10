"""Export the assistant turns worth a second look, to review where Bao goes wrong.

A turn is flagged when it got a thumbs down, ended in an error (or never finished), or logged
entries that someone later changed or deleted by hand. Each comes with what was said, the full
transcript, the rating note, what it changed, the hand edits and the paths of its photos.

    uv run --no-project python -I scripts/export_flagged.py --db data/runtime/makan.db
    uv run --no-project python -I scripts/export_flagged.py --db makan.db --since 2026-11-01 --format markdown --out flagged.md

The database is opened read-only. Photo paths assume the photos sit beside it in photos/, as in DATA_DIR.
"""

import argparse
import json
import sqlite3
import sys
from pathlib import Path


def _json(value):
    return json.loads(value) if isinstance(value, str) else value


def _photo_ids(messages) -> list[int]:
    if not messages:
        return []
    content = messages[0].get("content")
    if not isinstance(content, list):
        return []
    return [
        b["source"]["photo_id"]
        for b in content
        if isinstance(b, dict)
        and b.get("type") == "image"
        and b["source"].get("type") == "photo_ref"
    ]


def flagged_turns(db: sqlite3.Connection, photo_dir: Path, since: str | None) -> list[dict]:
    db.row_factory = sqlite3.Row
    where = "WHERE substr(t.created_at, 1, 10) >= :since" if since else ""
    turns = db.execute(
        f"""
        SELECT t.*, th.user_id, th.date AS log_date
        FROM turns t JOIN threads th ON th.id = t.thread_id
        {where}
        ORDER BY t.id
        """,
        {"since": since},
    ).fetchall()
    out = []
    for t in turns:
        changes = [
            {
                "table": c["table"],
                "action": c["action"],
                "row_id": c["row_id"],
                "before": _json(c["before"]),
                "after": _json(c["after"]),
            }
            for c in db.execute("SELECT * FROM changes WHERE turn_id = ? ORDER BY id", (t["id"],))
        ]
        logged = sorted(
            {c["row_id"] for c in changes if c["table"] == "entries" and c["action"] != "delete"}
        )
        edits = []
        if logged:
            marks = ",".join("?" * len(logged))
            edits = [
                {
                    "entry_id": e["entry_id"],
                    "action": e["action"],
                    "before": _json(e["before"]),
                    "after": _json(e["after"]),
                    "created_at": e["created_at"],
                }
                for e in db.execute(
                    f"SELECT * FROM entry_edits WHERE user_id = ? AND entry_id IN ({marks})"
                    " AND created_at >= ? ORDER BY id",
                    (t["user_id"], *logged, t["created_at"]),
                )
            ]

        reasons = []
        if t["rating"] == -1:
            reasons.append("thumbs_down")
        if t["status"] in ("error", "running"):
            reasons.append("error" if t["status"] == "error" else "unfinished")
        if edits:
            reasons.append("hand_edited")
        if not reasons:
            continue

        messages = _json(t["messages"]) or []
        photos = []
        for photo_id in _photo_ids(messages):
            row = db.execute("SELECT path FROM photos WHERE id = ?", (photo_id,)).fetchone()
            photos.append(str(photo_dir / row["path"]) if row else None)
        out.append(
            {
                "turn_id": t["id"],
                "thread_id": t["thread_id"],
                "user_id": t["user_id"],
                "log_date": t["log_date"],
                "created_at": t["created_at"],
                "app_version": t["app_version"],
                "model": (_json(t["usage"]) or {}).get("model"),
                "reasons": reasons,
                "status": t["status"],
                "error": t["error"],
                "rating": t["rating"],
                "rating_note": t["rating_note"],
                "undone": t["undone_at"] is not None,
                "user_text": t["user_text"],
                "reply_text": t["reply_text"],
                "photos": photos,
                "changes": changes,
                "hand_edits": edits,
                "messages": messages,
            }
        )
    return out


def to_markdown(turns: list[dict]) -> str:
    lines = [f"# Flagged turns ({len(turns)})", ""]
    for t in turns:
        lines += [
            f"## Turn {t['turn_id']}: {', '.join(t['reasons'])}",
            "",
            f"- Log date: {t['log_date']}; sent: {t['created_at']}; user {t['user_id']}; thread {t['thread_id']}",
            f"- Status: {t['status']}" + (f" ({t['error']})" if t["error"] else ""),
            f"- App version: {t['app_version'] or 'unknown'}; model: {t['model'] or 'unknown'}",
        ]
        if t["rating"] is not None:
            lines.append(
                f"- Rating: {t['rating']:+d}"
                + (f", note: {t['rating_note']}" if t["rating_note"] else "")
            )
        if t["undone"]:
            lines.append("- Undone")
        for path in t["photos"]:
            lines.append(f"- Photo: {path or '(missing)'}")
        lines += [
            "",
            "**User:**",
            "",
            t["user_text"] or "(no text)",
            "",
            "**Reply:**",
            "",
            t["reply_text"] or "(none)",
            "",
        ]
        for title, key in (
            ("Changes", "changes"),
            ("Hand edits", "hand_edits"),
            ("Transcript", "messages"),
        ):
            if t[key]:
                lines += [
                    f"**{title}:**",
                    "",
                    "```json",
                    json.dumps(t[key], indent=2, ensure_ascii=False),
                    "```",
                    "",
                ]
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--db", required=True, type=Path, help="the SQLite database (makan.db)")
    ap.add_argument("--since", help="only turns sent on or after this date, YYYY-MM-DD (UTC)")
    ap.add_argument("--format", choices=("json", "markdown"), default="json")
    ap.add_argument("--out", type=Path, help="write here instead of stdout")
    args = ap.parse_args()

    db = sqlite3.connect(f"file:{args.db.resolve()}?mode=ro", uri=True)
    try:
        turns = flagged_turns(db, args.db.resolve().parent / "photos", args.since)
    finally:
        db.close()
    text = (
        to_markdown(turns)
        if args.format == "markdown"
        else json.dumps(turns, indent=2, ensure_ascii=False)
    )
    if args.out:
        args.out.write_text(text + "\n")
        print(f"{len(turns)} flagged turns written to {args.out}", file=sys.stderr)
    else:
        print(text)


if __name__ == "__main__":
    main()
