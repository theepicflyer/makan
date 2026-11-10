from datetime import UTC, date, datetime, timedelta

import pytest
from anthropic.types.beta import BetaTextBlock, BetaToolUseBlock
from sqlalchemy import select

from bao.agent.runner import AgentConfig, run_turn
from bao.auth import upsert_user
from bao.db import session_scope
from bao.models import Change, EntryEdit, Thread, Turn
from tests.conftest import food_id
from tests.test_agent import NOW, FakeClient, _msg, _reply, _run

DAY = date(2026, 3, 3)


def _user_id(sub: str) -> int:
    with session_scope() as s:
        return upsert_user(s, sub=sub, email=None, name=sub.split(":")[1].title()).id


def _seed_turn(user_id: int, day: date, *, status="ok", text="hi", age=timedelta(0)) -> int:
    """A thread and one turn written straight to the database, as a finished turn leaves them."""
    with session_scope() as s:
        thread = Thread(user_id=user_id, date=day, model="claude-haiku-5-5")
        s.add(thread)
        s.flush()
        turn = Turn(
            thread_id=thread.id,
            user_text=text,
            reply_text="Logged.",
            messages=[{"role": "user", "content": [{"type": "text", "text": text}]}],
            status=status,
            created_at=datetime.now(UTC) - age,
        )
        s.add(turn)
        s.flush()
        return turn.id


@pytest.fixture
def alice_id(logged_in):
    return _user_id("dev:alice")


def test_rate_a_turn(logged_in, alice_id):
    turn_id = _seed_turn(alice_id, DAY)
    url = f"/api/agent/turns/{turn_id}/rating"

    r = logged_in.put(url, json={"rating": -1})
    assert r.status_code == 200, r.text
    assert (r.json()["rating"], r.json()["rating_note"]) == (-1, None)
    r = logged_in.put(url, json={"rating": -1, "note": "  wrong portion "})
    assert r.json()["rating_note"] == "wrong portion"
    # Tapping thumbs down again without a note keeps the note.
    assert logged_in.put(url, json={"rating": -1}).json()["rating_note"] == "wrong portion"

    up = logged_in.put(url, json={"rating": 1}).json()
    assert (up["rating"], up["rating_note"]) == (1, None)
    cleared = logged_in.put(url, json={"rating": None}).json()
    assert cleared["rating"] is None
    with session_scope() as s:
        assert s.get(Turn, turn_id).rated_at is None

    assert logged_in.put(url, json={"rating": 2}).status_code == 422


def test_rating_someone_elses_turn_is_not_found(logged_in):
    other = _user_id("dev:carol")
    turn_id = _seed_turn(other, DAY)
    r = logged_in.put(f"/api/agent/turns/{turn_id}/rating", json={"rating": 1})
    assert r.status_code == 404
    assert logged_in.put("/api/agent/turns/999999/rating", json={"rating": 1}).status_code == 404
    with session_scope() as s:
        assert s.get(Turn, turn_id).rating is None


async def test_rating_never_reaches_the_agent(logged_in, alice_id):
    fake = FakeClient([_reply("Logged."), _reply("Sure.")])
    first = await _run(fake, alice_id, "kopi c")
    turn_id = first[-1]["turn"]["id"]
    note = "zzz-rating-note-zzz"
    r = logged_in.put(f"/api/agent/turns/{turn_id}/rating", json={"rating": -1, "note": note})
    assert r.status_code == 200

    await _run(fake, alice_id, "and teh", thread_id=first[0]["thread_id"])
    sent = repr(fake.requests[1])
    assert note not in sent and "rating" not in sent
    # The replayed history is still byte-identical to what the first request sent.
    previous = fake.requests[0]["messages"]
    assert fake.requests[1]["messages"][: len(previous)] == previous


def test_day_turns(logged_in, alice_id):
    day = date(2026, 4, 1)
    first = _seed_turn(alice_id, day, text="breakfast")
    second = _seed_turn(alice_id, day, text="lunch", status="error")
    stuck = _seed_turn(alice_id, day, text="dinner", status="running", age=timedelta(hours=1))
    live = _seed_turn(alice_id, day, text="snack", status="running")
    _seed_turn(alice_id, date(2026, 4, 2), text="next day")
    _seed_turn(_user_id("dev:carol"), day, text="carol's")

    r = logged_in.get("/api/agent/turns", params={"date": "2026-04-01"})
    assert r.status_code == 200, r.text
    turns = r.json()["turns"]
    assert [t["id"] for t in turns] == [first, second, stuck, live]
    assert [t["user_text"] for t in turns] == ["breakfast", "lunch", "dinner", "snack"]
    assert len({t["thread_id"] for t in turns}) == 4
    # A turn left running long ago never finished; one just sent is still going.
    assert [t["status"] for t in turns] == ["ok", "error", "error", "running"]
    assert {"rating", "rating_note", "changes", "photo_ids"} <= turns[0].keys()

    assert logged_in.get("/api/agent/turns", params={"date": "2026-04-03"}).json() == {"turns": []}
    assert logged_in.get("/api/agent/turns", params={"date": "nope"}).status_code == 400


class _Boom:
    def __init__(self):
        self.beta = self
        self.messages = self

    def stream(self, **params):
        raise RuntimeError("socket closed " + "x" * 1000)


async def test_failed_turn_keeps_the_error(db, alice_id, monkeypatch):
    from bao.config import get_settings

    monkeypatch.setattr(get_settings(), "app_version", "v9.9.9")
    events = [
        e
        async for e in run_turn(
            user_id=alice_id,
            log_date=DAY,
            text="kopi",
            config=AgentConfig("claude-haiku-5-5", "low"),
            client=_Boom(),
            now=NOW,
        )
    ]
    assert events[-1]["type"] == "error"
    with session_scope() as s:
        turn = s.get(Turn, events[0]["turn_id"])
        assert turn.status == "error"
        assert turn.error.startswith("RuntimeError: socket closed")
        assert len(turn.error) == 500
        assert turn.app_version == "v9.9.9"


async def test_hand_edits_of_agent_entries_are_logged(db, logged_in, alice_id):
    kopi = food_id(db, "Kopi C")
    fake = FakeClient(
        [
            _msg(
                [
                    BetaToolUseBlock(
                        id="tu_e",
                        type="tool_use",
                        name="log_entries",
                        input={
                            "entries": [
                                {"meal": "breakfast", "food_id": kopi},
                                {"meal": "breakfast", "food_id": kopi},
                            ]
                        },
                    )
                ],
                "tool_use",
            ),
            _msg([BetaTextBlock(type="text", text="Logged.")], "end_turn"),
        ]
    )
    events = await _run(fake, alice_id, "2 kopi c", day=date(2026, 5, 1))
    edited, deleted = [c["row_id"] for c in events[-1]["turn"]["changes"]]
    manual = logged_in.post(
        "/api/entries", json={"date": "2026-05-01", "meal": "lunch", "food_id": kopi}
    ).json()["id"]

    assert logged_in.patch(f"/api/entries/{edited}", json={"servings": 2}).status_code == 200
    assert logged_in.delete(f"/api/entries/{deleted}").status_code == 200
    assert logged_in.patch(f"/api/entries/{manual}", json={"servings": 2}).status_code == 200
    assert logged_in.delete(f"/api/entries/{manual}").status_code == 200

    with session_scope() as s:
        edits = s.scalars(select(EntryEdit).where(EntryEdit.user_id == alice_id)).all()
        assert [(e.entry_id, e.action) for e in edits] == [(edited, "update"), (deleted, "delete")]
        assert edits[0].before["servings"] == 1 and edits[0].after["servings"] == 2
        assert edits[1].before["name"] == "Kopi C" and edits[1].after is None
        # Undo still sees only the agent's own changes.
        turn_id = events[-1]["turn"]["id"]
        assert len(s.scalars(select(Change).where(Change.turn_id == turn_id)).all()) == 2
