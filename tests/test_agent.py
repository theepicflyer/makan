import io
from datetime import date, datetime

import pytest
from anthropic.types.beta import BetaMessage, BetaTextBlock, BetaToolUseBlock, BetaUsage
from PIL import Image
from sqlalchemy import select

from makan.agent.runner import AgentConfig, run_turn, undo_turn
from makan.auth import upsert_user
from makan.db import session_scope
from makan.models import Entry, Turn
from makan.photos import save_photo
from tests.conftest import food_id

DAY = date(2026, 3, 3)
NOW = datetime(2026, 3, 3, 21, 0)


def _msg(content, stop):
    return BetaMessage(
        id="msg_x",
        type="message",
        role="assistant",
        model="claude-haiku-5-5",
        content=content,
        stop_reason=stop,
        stop_sequence=None,
        usage=BetaUsage(
            input_tokens=10,
            output_tokens=5,
            cache_read_input_tokens=100,
            cache_creation_input_tokens=50,
        ),
    )


class _Stream:
    def __init__(self, message):
        self.message = message

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def __aiter__(self):
        return self

    async def __anext__(self):
        raise StopAsyncIteration

    async def get_final_message(self):
        return self.message


class FakeClient:
    """Replays scripted responses and records each request."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []
        self.beta = self
        self.messages = self

    def stream(self, **params):
        self.requests.append(params)
        return _Stream(self.responses.pop(0))


async def _run(client, user_id, text, photo_ids=None, thread_id=None, day=DAY):
    events = [
        e
        async for e in run_turn(
            user_id=user_id,
            log_date=day,
            text=text,
            photo_ids=photo_ids,
            thread_id=thread_id,
            config=AgentConfig("claude-haiku-5-5", "low"),
            client=client,
            now=NOW,
        )
    ]
    assert events[-1]["type"] == "done", events[-1]
    return events


@pytest.fixture
def user_id(client):
    with session_scope() as db:
        return upsert_user(db, sub="dev:agenttest", email=None, name="Agent Test").id


async def test_turn_logs_and_replays_history(db, user_id):
    kopi = food_id(db, "Kopi C")
    client = FakeClient(
        [
            _msg(
                [
                    BetaToolUseBlock(
                        id="tu_1",
                        type="tool_use",
                        name="log_entries",
                        input={"entries": [{"meal": "breakfast", "food_id": kopi}]},
                    )
                ],
                "tool_use",
            ),
            _msg([BetaTextBlock(type="text", text="Logged kopi C.")], "end_turn"),
            _msg([BetaTextBlock(type="text", text="You had 130 kcal.")], "end_turn"),
        ]
    )
    events = await _run(client, user_id, "kopi c for breakfast")
    assert events[-1]["turn"]["reply_text"] == "Logged kopi C."
    assert any(e["type"] == "changed" for e in events)

    first = client.requests[0]
    assert first["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert first["cache_control"] == {"type": "ephemeral"}
    assert [t["name"] for t in first["tools"]] == sorted(t["name"] for t in first["tools"])
    assert "<context>" in first["messages"][0]["content"][-1]["text"]

    await _run(client, user_id, "how many calories?", thread_id=events[0]["thread_id"])
    # The second turn replays the first turn byte-for-byte as a prefix.
    previous = client.requests[1]["messages"]
    assert client.requests[2]["messages"][: len(previous)] == previous
    with session_scope() as s:
        entries = s.scalars(select(Entry).where(Entry.user_id == user_id)).all()
        assert [e.name for e in entries] == ["Kopi C"]
        turn = s.scalars(select(Turn).order_by(Turn.id)).first()
        assert turn.usage["cache_read"] == 200 and turn.cost_usd > 0


def _reply(text):
    return _msg([BetaTextBlock(type="text", text=text)], "end_turn")


async def test_each_bao_session_is_a_new_thread(db, user_id, client):
    with session_scope() as s:
        other_id = upsert_user(s, sub="dev:other", email=None, name="Other").id
    fake = FakeClient([_reply(str(i)) for i in range(5)])

    first = (await _run(fake, user_id, "hi"))[0]["thread_id"]
    same = (await _run(fake, user_id, "and?", thread_id=first))[0]["thread_id"]
    assert same == first
    assert len(fake.requests[1]["messages"]) == 3

    fresh = (await _run(fake, user_id, "hello again"))[0]["thread_id"]
    assert fresh != first
    assert len(fake.requests[2]["messages"]) == 1

    # A thread id only continues the caller's own thread for the same log date.
    other_day = (await _run(fake, user_id, "x", thread_id=first, day=date(2026, 3, 4)))[0]
    other_user = (await _run(fake, other_id, "x", thread_id=first))[0]
    assert {other_day["thread_id"], other_user["thread_id"]}.isdisjoint({first, fresh})
    assert len(fake.requests[3]["messages"]) == len(fake.requests[4]["messages"]) == 1


async def test_undo_removes_agent_entries(db, user_id):
    toast = food_id(db, "Kaya toast")
    client = FakeClient(
        [
            _msg(
                [
                    BetaToolUseBlock(
                        id="tu_2",
                        type="tool_use",
                        name="log_entries",
                        input={
                            "entries": [
                                {
                                    "meal": "snacks",
                                    "food_id": toast,
                                    "servings": 2,
                                    "serving": "slice",
                                }
                            ]
                        },
                    )
                ],
                "tool_use",
            ),
            _msg([BetaTextBlock(type="text", text="Done.")], "end_turn"),
        ]
    )
    events = await _run(client, user_id, "2 slices kaya toast")
    turn_id = events[-1]["turn"]["id"]
    with session_scope() as s:
        assert s.scalars(
            select(Entry).where(Entry.user_id == user_id, Entry.meal == "snacks")
        ).all()
        from makan.models import User

        undo_turn(s, s.get(User, user_id), turn_id)
    with session_scope() as s:
        assert not s.scalars(
            select(Entry).where(Entry.user_id == user_id, Entry.meal == "snacks")
        ).all()


async def test_tool_errors_go_back_to_the_model(db, user_id):
    client = FakeClient(
        [
            _msg(
                [
                    BetaToolUseBlock(
                        id="tu_3",
                        type="tool_use",
                        name="log_entries",
                        input={"entries": [{"meal": "brunch"}]},
                    )
                ],
                "tool_use",
            ),
            _msg([BetaTextBlock(type="text", text="Sorry.")], "end_turn"),
        ]
    )
    await _run(client, user_id, "something")
    result = client.requests[1]["messages"][-1]["content"][0]
    assert result["is_error"] is True and "meal" in result["content"]


async def test_several_photos_are_numbered_and_linked_to_entries(db, user_id):
    def jpeg():
        buf = io.BytesIO()
        Image.new("RGB", (8, 8)).save(buf, "JPEG")
        return buf.getvalue()

    with session_scope() as s:
        photo_ids = [save_photo(s, user_id, jpeg()).id for _ in range(2)]
    laksa = food_id(db, "Laksa")
    client = FakeClient(
        [
            _msg(
                [
                    BetaToolUseBlock(
                        id="tu_4",
                        type="tool_use",
                        name="log_entries",
                        input={
                            "entries": [
                                {"meal": "lunch", "food_id": laksa, "photo": 2},
                                {"meal": "lunch", "name": "Teh (est.)", "kcal": 80},
                            ]
                        },
                    )
                ],
                "tool_use",
            ),
            _msg([BetaTextBlock(type="text", text="Logged.")], "end_turn"),
        ]
    )
    events = await _run(client, user_id, "lunch", photo_ids)
    content = client.requests[0]["messages"][-1]["content"]
    assert [b["type"] for b in content] == ["text", "image", "text", "image", "text"]
    assert content[2]["text"] == "Photo 2:"
    assert events[-1]["turn"]["photo_ids"] == photo_ids
    with session_scope() as s:
        entries = s.scalars(select(Entry).where(Entry.user_id == user_id).order_by(Entry.id)).all()
        assert [e.photo_id for e in entries[-2:]] == [photo_ids[1], None]


async def test_saved_food_change_shows_kcal_per_default_serving(db, user_id):
    client = FakeClient(
        [
            _msg(
                [
                    BetaToolUseBlock(
                        id="tu_f",
                        type="tool_use",
                        name="save_food",
                        input={
                            "name": "Test Soy Milk",
                            "nutrients": {"basis": "per_100g", "kcal": 58},
                            "servings": [{"label": "glass", "grams": 200, "default": True}],
                            "aliases": ["test soy milk"],
                        },
                    )
                ],
                "tool_use",
            ),
            _msg([BetaTextBlock(type="text", text="Saved.")], "end_turn"),
        ]
    )
    events = await _run(client, user_id, "save this milk")
    [change] = events[-1]["turn"]["changes"]
    assert change["table"] == "foods" and change["action"] == "create"
    assert change["serving"] == "glass"
    assert change["kcal"] == pytest.approx(116)
    assert change["aliases"] == ["test soy milk"]
