import base64
import json
import os
from datetime import date, datetime

import http_ece
import pytest
import requests
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from sqlalchemy import select

from makan import reminders
from makan.auth import upsert_user
from makan.config import get_settings
from makan.db import session_scope
from makan.models import Entry, PushSubscription, User

TZ = get_settings().tz


def at(day: int, hour: int, minute: int = 0, month: int = 10) -> datetime:
    return datetime(2026, month, day, hour, minute, tzinfo=TZ)


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


class FakePushService(requests.adapters.BaseAdapter):
    """Stands in for FCM and friends: records each request and answers with one status."""

    def __init__(self, status: int = 201):
        super().__init__()
        self.status = status
        self.requests: list[requests.PreparedRequest] = []

    def send(self, request, **kwargs):
        self.requests.append(request)
        response = requests.Response()
        response.status_code = self.status
        response.request = request
        response.url = request.url
        response._content = b""
        return response

    def close(self):
        pass

    def to(self, endpoint: str) -> list[requests.PreparedRequest]:
        return [r for r in self.requests if r.url == endpoint]


def fake_push(status: int = 201) -> tuple[requests.Session, FakePushService]:
    service = FakePushService(status)
    session = requests.Session()
    session.mount("https://", service)
    return session, service


class Device:
    """A browser's side of a subscription: its key pair and auth secret, so a test can read what it got."""

    def __init__(self, name: str):
        self.endpoint = f"https://fcm.googleapis.com/fcm/send/{name}"
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.auth = os.urandom(16)

    @property
    def p256dh(self) -> str:
        return b64(
            self.key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
        )

    def json(self) -> dict:
        return {"endpoint": self.endpoint, "keys": {"p256dh": self.p256dh, "auth": b64(self.auth)}}

    def read(self, request: requests.PreparedRequest) -> dict:
        body = http_ece.decrypt(request.body, private_key=self.key, auth_secret=self.auth)
        return json.loads(body)


def make_user(name: str, reminder_time: str = "21:00", device: Device | None = None) -> int:
    with session_scope() as db:
        user = upsert_user(db, sub=f"dev:{name.lower()}", email=None, name=name)
        user.reminder_time = reminder_time
        if device:
            db.flush()
            db.add(
                PushSubscription(
                    user_id=user.id,
                    endpoint=device.endpoint,
                    p256dh=device.p256dh,
                    auth=b64(device.auth),
                )
            )
        db.flush()
        return user.id


def log_meals(user_id: int, day: date, *meals: str) -> None:
    with session_scope() as db:
        for meal in meals:
            db.add(Entry(user_id=user_id, date=day, meal=meal, name="Kopi C", kcal=90))


# --- the API ----------------------------------------------------------------------


def test_push_key_is_a_p256_point(logged_in):
    key = logged_in.get("/api/push/key").json()["key"]
    raw = base64.urlsafe_b64decode(key + "=" * (-len(key) % 4))
    assert len(raw) == 65 and raw[0] == 4


def test_reminder_time_is_part_of_me(logged_in):
    assert logged_in.get("/api/me").json()["reminder_time"] == "21:00"
    assert (
        logged_in.patch("/api/me", json={"reminder_time": "07:30"}).json()["reminder_time"]
        == "07:30"
    )
    for bad in ("7:30", "24:00", "21:60", "nine"):
        assert logged_in.patch("/api/me", json={"reminder_time": bad}).status_code == 400
    logged_in.patch("/api/me", json={"reminder_time": "21:00"})


def test_subscriptions_only_for_push_services(logged_in):
    device = Device("refused")
    for endpoint in (
        "https://evil.example/push",
        "http://fcm.googleapis.com/fcm/send/x",
        "https://google.com.evil.example/x",
        "https://127.0.0.1/x",
    ):
        r = logged_in.post("/api/push/subscriptions", json={**device.json(), "endpoint": endpoint})
        assert r.status_code == 400


def test_subscribe_and_unsubscribe(logged_in, db):
    device = Device("alice-phone")
    assert logged_in.post("/api/push/subscriptions", json=device.json()).status_code == 200
    sub = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == device.endpoint))
    assert db.get(User, sub.user_id).name == "Alice"
    # refreshing the same device is fine
    assert logged_in.post("/api/push/subscriptions", json=device.json()).status_code == 200
    logged_in.post("/api/push/unsubscribe", json={"endpoint": device.endpoint})
    db.expire_all()
    assert (
        db.scalar(select(PushSubscription).where(PushSubscription.endpoint == device.endpoint))
        is None
    )


def test_test_notification(logged_in, db, monkeypatch):
    device = Device("alice-test")
    logged_in.post("/api/push/subscriptions", json=device.json())
    session, service = fake_push()
    monkeypatch.setattr(reminders, "_http", session)
    assert logged_in.post("/api/push/test", json={"endpoint": device.endpoint}).status_code == 200
    message = device.read(service.to(device.endpoint)[0])
    assert message["title"] == "Reminders are on"
    assert "9:00 pm" in message["body"]

    # a device the push service has forgotten is dropped, and the user told to turn reminders on again
    session, service = fake_push(410)
    monkeypatch.setattr(reminders, "_http", session)
    r = logged_in.post("/api/push/test", json={"endpoint": device.endpoint})
    assert r.status_code == 410
    assert (
        db.scalar(select(PushSubscription).where(PushSubscription.endpoint == device.endpoint))
        is None
    )


# --- the scheduler ----------------------------------------------------------------


def test_reminder_goes_out_once_at_its_time():
    device = Device("cora")
    make_user("Cora", "21:00", device)
    session, service = fake_push()
    reminders.tick(at(22, 20, 59), session)
    assert not service.to(device.endpoint)
    reminders.tick(at(22, 21, 0), session)
    reminders.tick(at(22, 21, 1), session)
    sent = service.to(device.endpoint)
    assert len(sent) == 1
    message = device.read(sent[0])
    assert message == {
        "title": "Time to log your food",
        "body": "Nothing logged today yet. Tell Bao what you ate.",
        "url": "/day/2026-10-22",
    }
    # signed with our VAPID key, short-lived, and replacing any earlier reminder still queued
    assert sent[0].headers["Authorization"].endswith(f"k={reminders.public_key()}")
    assert sent[0].headers["TTL"] == str(4 * 3600)
    assert sent[0].headers["Topic"] == "reminder"
    # and again the next day
    reminders.tick(at(23, 21, 0), session)
    assert len(service.to(device.endpoint)) == 2


def test_reminder_names_the_meals_still_missing():
    device = Device("dev")
    user_id = make_user("Dev", "20:00", device)
    log_meals(user_id, date(2026, 10, 22), "breakfast", "snacks")
    session, service = fake_push()
    reminders.tick(at(22, 20, 0), session)
    body = device.read(service.to(device.endpoint)[0])["body"]
    assert body == "Lunch and dinner aren't logged yet. Tell Bao what you ate."


def test_no_reminder_once_the_day_is_logged():
    device = Device("eve")
    user_id = make_user("Eve", "20:00", device)
    log_meals(user_id, date(2026, 10, 22), "breakfast", "lunch", "dinner")
    session, service = fake_push()
    reminders.tick(at(22, 20, 0), session)
    assert not service.to(device.endpoint)
    with session_scope() as db:
        assert db.get(User, user_id).reminded_on == date(2026, 10, 22)


def test_late_reminders_give_up_after_the_grace_period():
    device = Device("finn")
    make_user("Finn", "18:00", device)
    session, service = fake_push()
    reminders.tick(at(22, 20, 1), session)
    assert not service.to(device.endpoint)
    reminders.tick(at(22, 19, 59), session)
    assert len(service.to(device.endpoint)) == 1


def test_after_midnight_belongs_to_the_day_before():
    device = Device("gus")
    make_user("Gus", "00:30", device)
    session, service = fake_push()
    reminders.tick(at(23, 0, 30), session)
    assert device.read(service.to(device.endpoint)[0])["url"] == "/day/2026-10-22"


def test_gone_devices_are_dropped():
    device = Device("hana")
    make_user("Hana", "21:00", device)
    session, _ = fake_push(410)
    assert reminders.tick(at(22, 21, 0), session) == 0
    with session_scope() as db:
        assert (
            db.scalar(select(PushSubscription).where(PushSubscription.endpoint == device.endpoint))
            is None
        )


def test_changing_the_time_never_fires_at_once():
    device = Device("ivy")
    user_id = make_user("Ivy", "21:00", device)
    session, service = fake_push()
    with session_scope() as db:
        # at 21:30, moving the time to 21:15 waits for tomorrow...
        reminders.set_time(db.get(User, user_id), "21:15", now=at(22, 21, 30))
    reminders.tick(at(22, 21, 31), session)
    assert not service.to(device.endpoint)
    with session_scope() as db:
        # ...and moving it to 22:00 still reminds tonight
        reminders.set_time(db.get(User, user_id), "22:00", now=at(22, 21, 32))
    reminders.tick(at(22, 22, 0), session)
    assert len(service.to(device.endpoint)) == 1


@pytest.mark.parametrize(
    ("value", "label"), [("21:00", "9:00 pm"), ("00:05", "12:05 am"), ("12:30", "12:30 pm")]
)
def test_time_label(value, label):
    assert reminders.time_label(value) == label
