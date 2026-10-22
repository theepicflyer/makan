"""Daily reminders to log food, sent as Web Push notifications.

Each user picks a time (users.reminder_time, in the app's timezone). Once a minute the scheduler finds users
whose time has come for the current log date, and unless breakfast, lunch and dinner are already logged,
notifies every device they turned reminders on for (push_subscriptions). Push services answer 404 or 410 for
a device that unsubscribed or expired; its subscription is dropped.
"""

import asyncio
import base64
import json
import logging
import re
import threading
from datetime import date, datetime, time, timedelta
from typing import Any
from urllib.parse import urlparse

import requests
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from py_vapid import Vapid
from pywebpush import WebPushException, webpush
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from makan import log as log_svc
from makan.config import Settings, get_settings
from makan.db import session_scope
from makan.models import PushSubscription, User

log = logging.getLogger("makan.reminders")

MAIN_MEALS = ("breakfast", "lunch", "dinner")
# A reminder missed while the server was down still goes out this late; after that it waits for tomorrow.
GRACE = timedelta(hours=2)
# The push services browsers use: Google's for Chrome and other Chromium browsers (fcm.googleapis.com;
# open-source Chromium builds get jmt17.google.com), Mozilla's, Apple's and Microsoft's.
# Subscriptions elsewhere are refused, so the server only ever posts to these.
PUSH_HOSTS = (
    "googleapis.com",
    "google.com",
    "push.services.mozilla.com",
    "push.apple.com",
    "notify.windows.com",
)
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")

_vapid: Vapid | None = None
# the scheduler's thread and request threads can both reach for the key first
_vapid_lock = threading.Lock()
_http = requests.Session()


class Gone(Exception):
    """The push service no longer knows this device: it unsubscribed, or the subscription expired."""


# --- keys -------------------------------------------------------------------------


def vapid() -> Vapid:
    """The server's VAPID key, made on first use and kept in the data directory beside the session secret.
    Subscriptions are tied to it, so losing it means turning reminders on again on every device."""
    global _vapid
    with _vapid_lock:
        if _vapid is None:
            settings = get_settings()
            path = settings.data_dir / "vapid_private.pem"
            if not path.exists():
                settings.data_dir.mkdir(parents=True, exist_ok=True)
                key = Vapid()
                key.generate_keys()
                key.save_key(str(path))
                path.chmod(0o600)
            _vapid = Vapid.from_file(str(path))
        return _vapid


def public_key() -> str:
    """The VAPID public key as browsers want it for pushManager.subscribe: base64url, uncompressed point."""
    raw = vapid().public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def subject(settings: Settings) -> str:
    """Who push services can contact about our messages: VAPID wants a bare https:// host or a mailto:."""
    if settings.vapid_subject:
        return settings.vapid_subject
    url = urlparse(settings.public_url)
    return f"https://{url.hostname}" if url.scheme == "https" else "mailto:makan@localhost"


def check_endpoint(endpoint: str) -> None:
    url = urlparse(endpoint)
    host = url.hostname or ""
    if url.scheme != "https" or not any(host == h or host.endswith(f".{h}") for h in PUSH_HOSTS):
        raise ValueError("That isn't a push service this server sends to")


# --- times ------------------------------------------------------------------------


def parse_time(value: str) -> time:
    if not _TIME.match(value):
        raise ValueError("Use a time like 21:00")
    return time.fromisoformat(value)


def time_label(value: str) -> str:
    t = parse_time(value)
    return f"{(t.hour % 12) or 12}:{t.minute:02d} {'am' if t.hour < 12 else 'pm'}"


def log_day(now: datetime, settings: Settings) -> date:
    """The log date at `now`: before the rollover hour it's still the previous day (as settings.today())."""
    return (now - timedelta(hours=settings.day_rollover_hour)).date()


def due_at(reminder_time: str, day: date, settings: Settings) -> datetime:
    """When the reminder for a log date goes out. A time before the rollover hour (say 00:30) is the night
    after that date, still part of its day."""
    t = parse_time(reminder_time)
    on = day + timedelta(days=1) if t.hour < settings.day_rollover_hour else day
    return datetime.combine(on, t, tzinfo=settings.tz)


def settle(user: User, now: datetime | None = None) -> None:
    """After the time changes or reminders are turned on: a time already past today waits for tomorrow
    rather than firing at once, and one still to come today goes out today."""
    settings = get_settings()
    now = now or settings.now()
    day = log_day(now, settings)
    user.reminded_on = day if due_at(user.reminder_time, day, settings) <= now else None


def set_time(user: User, value: str, now: datetime | None = None) -> None:
    parse_time(value)
    user.reminder_time = value
    settle(user, now)


# --- messages ---------------------------------------------------------------------


def reminder_for(db: Session, user: User, day: date) -> dict[str, Any] | None:
    """The notification for a log date, or None when breakfast, lunch and dinner are all logged."""
    logged = {e.meal for e in log_svc.entries_between(db, user, day, day)}
    missing = [m for m in MAIN_MEALS if m not in logged]
    if not missing:
        return None
    if not logged:
        body = "Nothing logged today yet. Tell Bao what you ate."
    else:
        names = missing[0] if len(missing) == 1 else f"{', '.join(missing[:-1])} and {missing[-1]}"
        verb = "isn't" if len(missing) == 1 else "aren't"
        body = f"{names.capitalize()} {verb} logged yet. Tell Bao what you ate."
    return {"title": "Time to log your food", "body": body, "url": f"/day/{day.isoformat()}"}


def confirmation(user: User) -> dict[str, Any]:
    return {
        "title": "Reminders are on",
        "body": f"You'll get one at {time_label(user.reminder_time)} on days you haven't logged yet.",
        "url": "/settings",
    }


# --- sending ----------------------------------------------------------------------


def subscription_info(sub: PushSubscription) -> dict[str, Any]:
    return {"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}}


def push(
    info: dict[str, Any], message: dict[str, Any], http: requests.Session | None = None
) -> None:
    """Encrypt and send one notification. Raises Gone when the device is no longer subscribed."""
    try:
        webpush(
            info,
            data=json.dumps(message),
            vapid_private_key=vapid(),
            vapid_claims={"sub": subject(get_settings())},
            # a reminder that couldn't be delivered within a few hours isn't worth showing
            ttl=4 * 3600,
            # a newer reminder replaces one still waiting for an offline phone
            headers={"Topic": "reminder", "Urgency": "normal"},
            timeout=10,
            requests_session=http or _http,
        )
    except WebPushException as exc:
        if exc.status_code in (404, 410):
            raise Gone from exc
        raise


def deliver(
    outbox: list[tuple[int, dict[str, Any], dict[str, Any]]], http: requests.Session | None = None
) -> int:
    """Send (subscription id, subscription info, message) triples outside any transaction, then drop the
    subscriptions that are gone. Returns how many were delivered."""
    sent = 0
    gone: list[int] = []
    for sub_id, info, message in outbox:
        try:
            push(info, message, http)
            sent += 1
        except Gone:
            gone.append(sub_id)
        except Exception:
            log.warning("reminder to subscription %s failed", sub_id, exc_info=True)
    if gone:
        with session_scope() as db:
            db.execute(delete(PushSubscription).where(PushSubscription.id.in_(gone)))
    return sent


def tick(now: datetime | None = None, http: requests.Session | None = None) -> int:
    """Send the reminders that are due at `now`. Each user's day is marked settled before anything is sent,
    in a short transaction, so a slow push service never holds the database."""
    settings = get_settings()
    now = now or settings.now()
    day = log_day(now, settings)
    outbox: list[tuple[int, dict[str, Any], dict[str, Any]]] = []
    with session_scope() as db:
        users = db.scalars(select(User).where(User.id.in_(select(PushSubscription.user_id))))
        for user in users:
            if user.reminded_on == day:
                continue
            at = due_at(user.reminder_time, day, settings)
            if not at <= now < at + GRACE:
                continue
            user.reminded_on = day
            message = reminder_for(db, user, day)
            if message is None:
                continue
            subs = db.scalars(select(PushSubscription).where(PushSubscription.user_id == user.id))
            outbox += [(sub.id, subscription_info(sub), message) for sub in subs]
    return deliver(outbox, http)


async def run() -> None:
    """The scheduler: check just after each minute turns, for as long as the app runs."""
    while True:
        try:
            await asyncio.to_thread(tick)
        except Exception:
            log.exception("reminder check failed")
        await asyncio.sleep(61 - datetime.now().second)
