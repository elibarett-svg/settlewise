import logging
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.config import Settings
from ...core.db import as_utc, utcnow
from .models import Notification, NotificationPreference, PushToken, Reminder

log = logging.getLogger("settlewise.notifications")


def prefs_for(db: Session, user_id: str) -> NotificationPreference:
    prefs = db.scalar(select(NotificationPreference).where(NotificationPreference.user_id == user_id))
    if prefs is None:
        prefs = NotificationPreference(user_id=user_id)
        db.add(prefs)
        db.flush()
    return prefs


def _tz(prefs: NotificationPreference) -> ZoneInfo:
    try:
        return ZoneInfo(prefs.timezone)
    except Exception:
        return ZoneInfo("America/Toronto")


def at_local_hour(prefs: NotificationPreference, day: date) -> datetime:
    return datetime.combine(day, time(hour=prefs.reminder_hour), tzinfo=_tz(prefs))


def upsert_auto(
    db: Session,
    user_id: str,
    *,
    kind: str,
    ref_id: str,
    key: str,
    title: str,
    body: str,
    link: str,
    remind_at: datetime | None,
) -> None:
    """Create, move or cancel an automatic reminder identified by ``key``."""
    existing = db.scalar(select(Reminder).where(Reminder.user_id == user_id, Reminder.dedupe_key == key))
    if remind_at is not None:
        remind_at = remind_at.astimezone(UTC)  # stored in UTC (SQLite keeps no offset)
    if remind_at is None:
        if existing and existing.status == "scheduled":
            existing.status = "cancelled"
        return
    if existing is None:
        db.add(
            Reminder(
                user_id=user_id,
                kind=kind,
                ref_id=ref_id,
                dedupe_key=key,
                title=title,
                body=body,
                link=link,
                remind_at=remind_at,
                source="auto",
            )
        )
    else:
        moved = as_utc(existing.remind_at) != remind_at
        existing.title, existing.body, existing.link = title, body, link
        if moved or existing.status == "cancelled":
            existing.remind_at, existing.status = remind_at, "scheduled"
    db.flush()


def cancel_for_ref(db: Session, user_id: str, ref_id: str) -> None:
    for rem in db.scalars(
        select(Reminder).where(Reminder.user_id == user_id, Reminder.ref_id == ref_id, Reminder.status == "scheduled")
    ):
        rem.status = "cancelled"


def schedule_for_date(db: Session, user_id: str, due: date | None, lead_days: int) -> datetime | None:
    """Reminder time for something due on ``due``: lead_days before, at the user's reminder hour.
    If that moment has passed but the item is not yet due, remind as soon as possible."""
    if due is None:
        return None
    prefs = prefs_for(db, user_id)
    when = at_local_hour(prefs, due - timedelta(days=lead_days))
    now = utcnow()
    if when <= now:
        return now if due >= now.astimezone(_tz(prefs)).date() else None
    return when


def in_quiet_hours(prefs: NotificationPreference, moment: datetime) -> datetime | None:
    """If ``moment`` falls in quiet hours return when they end, else None."""
    local = moment.astimezone(_tz(prefs))
    start = time.fromisoformat(prefs.quiet_start)
    end = time.fromisoformat(prefs.quiet_end)
    now_t = local.timetz().replace(tzinfo=None)
    if start == end:
        return None
    overnight = start > end
    quiet = (now_t >= start or now_t < end) if overnight else (start <= now_t < end)
    if not quiet:
        return None
    end_day = local.date() + timedelta(days=1) if overnight and now_t >= start else local.date()
    return datetime.combine(end_day, end, tzinfo=_tz(prefs))


def send_push(settings: Settings, tokens: list[str], title: str, body: str, link: str) -> None:
    if not tokens or not settings.expo_push_url:
        return
    messages = [{"to": t, "title": title, "body": body, "sound": "default", "data": {"link": link}} for t in tokens]
    try:
        httpx.post(settings.expo_push_url, json=messages, timeout=10).raise_for_status()
    except httpx.HTTPError as exc:  # never fail the dispatch loop on a push error
        log.warning("Push delivery failed: %s", exc)


def deliver(db: Session, settings: Settings, user_id: str, title: str, body: str, link: str) -> None:
    prefs = prefs_for(db, user_id)
    if prefs.push_enabled:
        tokens = list(db.scalars(select(PushToken.token).where(PushToken.user_id == user_id)))
        send_push(settings, tokens, title, body, link)


def dispatch_due(db: Session, settings: Settings, now: datetime | None = None) -> int:
    """9.3 Send Notifications - turn due reminders into inbox items and push alerts,
    respecting each user's quiet hours. Safe to run repeatedly (cron or background loop)."""
    now = now or utcnow()
    sent = 0
    due = db.scalars(select(Reminder).where(Reminder.status == "scheduled", Reminder.remind_at <= now)).all()
    for rem in due:
        prefs = prefs_for(db, rem.user_id)
        quiet_until = in_quiet_hours(prefs, now)
        if quiet_until:
            rem.remind_at = quiet_until.astimezone(UTC)
            continue
        db.add(
            Notification(
                user_id=rem.user_id, reminder_id=rem.id, kind=rem.kind, title=rem.title, body=rem.body, link=rem.link
            )
        )
        rem.status = "sent"
        deliver(db, settings, rem.user_id, rem.title, rem.body, rem.link)
        sent += 1
    woken = db.scalars(
        select(Notification).where(Notification.status == "snoozed", Notification.snoozed_until <= now)
    ).all()
    for note in woken:
        if in_quiet_hours(prefs_for(db, note.user_id), now):
            continue
        note.status, note.snoozed_until = "unread", None
        deliver(db, settings, note.user_id, note.title, note.body, note.link)
        sent += 1
    db.flush()
    return sent
