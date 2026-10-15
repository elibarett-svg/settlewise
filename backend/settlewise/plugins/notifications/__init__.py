"""9.0 Notifications & Reminders - due dates, follow-ups and document expiries in one inbox."""

import asyncio
import logging
from datetime import UTC, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...core import db as core_db
from ...core import events
from ...core.config import get_settings
from ...core.db import get_db, utcnow
from ...core.deps import get_current_user, get_owned
from ...core.models import User
from ...core.plugin import Plugin
from ...core.util import delete_rows
from . import service
from .models import Notification, NotificationPreference, PushToken, Reminder

log = logging.getLogger("settlewise.notifications")


class ReminderIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    body: str = ""
    remind_at: datetime
    kind: str = Field(default="custom", pattern="^(task|bill|follow_up|document|custom)$")
    ref_id: str | None = None
    link: str = ""


class ReminderPatch(BaseModel):
    title: str | None = None
    body: str | None = None
    remind_at: datetime | None = None


class ReminderOut(BaseModel):
    id: str
    kind: str
    ref_id: str | None
    title: str
    body: str
    link: str
    remind_at: datetime
    status: str
    source: str
    model_config = {"from_attributes": True}


class NotificationOut(BaseModel):
    id: str
    kind: str
    title: str
    body: str
    link: str
    status: str
    snoozed_until: datetime | None
    created_at: datetime
    model_config = {"from_attributes": True}


class NotificationAction(BaseModel):
    action: str = Field(pattern="^(read|done|dismiss|snooze|unread)$")
    snooze_minutes: int = Field(default=24 * 60, ge=5, le=60 * 24 * 30)


class PrefsIn(BaseModel):
    push_enabled: bool | None = None
    email_enabled: bool | None = None
    timezone: str | None = None
    quiet_start: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    quiet_end: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    reminder_hour: int | None = Field(default=None, ge=0, le=23)
    task_lead_days: int | None = Field(default=None, ge=0, le=60)
    bill_lead_days: int | None = Field(default=None, ge=0, le=60)
    follow_up_lead_days: int | None = Field(default=None, ge=0, le=60)
    document_lead_days: list[int] | None = None

    @field_validator("quiet_start", "quiet_end")
    @classmethod
    def _time(cls, v):
        if v is not None:
            time.fromisoformat(v)
        return v


class PrefsOut(BaseModel):
    push_enabled: bool
    email_enabled: bool
    timezone: str
    quiet_start: str
    quiet_end: str
    reminder_hour: int
    task_lead_days: int
    bill_lead_days: int
    follow_up_lead_days: int
    document_lead_days: list[int]
    model_config = {"from_attributes": True}


class PushTokenIn(BaseModel):
    token: str = Field(min_length=10, max_length=255)
    platform: str = Field(default="unknown", pattern="^(ios|android|web|unknown)$")


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


def build_router() -> APIRouter:
    r = APIRouter(prefix="/notifications", tags=["9.0 Notifications"])

    @r.get("", response_model=list[NotificationOut], summary="9.4 View Notifications")
    def inbox(
        status: str | None = None,
        limit: int = 100,
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        stmt = select(Notification).where(Notification.user_id == user.id)
        if status:
            stmt = stmt.where(Notification.status == status)
        else:
            stmt = stmt.where(Notification.status.in_(["unread", "read"]))
        return db.scalars(stmt.order_by(Notification.created_at.desc()).limit(limit)).all()

    @r.get("/unread-count")
    def unread(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        count = db.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user.id, Notification.status == "unread")
        )
        return {"unread": count or 0}

    @r.post("/read-all", status_code=204)
    def read_all(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        for n in db.scalars(
            select(Notification).where(Notification.user_id == user.id, Notification.status == "unread")
        ):
            n.status = "read"

    @r.post("/{notification_id}/action", response_model=NotificationOut, summary="9.5 Manage Notifications")
    def act(
        notification_id: str,
        body: NotificationAction,
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        note = get_owned(db, Notification, notification_id, user.id)
        if body.action == "snooze":
            note.status, note.snoozed_until = "snoozed", utcnow() + timedelta(minutes=body.snooze_minutes)
        else:
            note.status = {"read": "read", "unread": "unread", "done": "done", "dismiss": "dismissed"}[body.action]
            note.snoozed_until = None
        return note

    # --- 9.1 Reminders --------------------------------------------------------------
    @r.get("/reminders", response_model=list[ReminderOut])
    def reminders(include_past: bool = False, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        stmt = select(Reminder).where(Reminder.user_id == user.id)
        if not include_past:
            stmt = stmt.where(Reminder.status == "scheduled")
        return db.scalars(stmt.order_by(Reminder.remind_at)).all()

    @r.post("/reminders", response_model=ReminderOut, status_code=201, summary="9.1 Set Reminders")
    def create_reminder(body: ReminderIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        rem = Reminder(user_id=user.id, source="manual", **{**body.model_dump(), "remind_at": _utc(body.remind_at)})
        db.add(rem)
        db.flush()
        return rem

    @r.patch("/reminders/{reminder_id}", response_model=ReminderOut)
    def edit_reminder(
        reminder_id: str, body: ReminderPatch, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ):
        rem = get_owned(db, Reminder, reminder_id, user.id)
        data = body.model_dump(exclude_unset=True)
        if data.get("remind_at"):
            data["remind_at"] = _utc(data["remind_at"])
            rem.status = "scheduled"
        for k, v in data.items():
            setattr(rem, k, v)
        return rem

    @r.delete("/reminders/{reminder_id}", status_code=204)
    def cancel_reminder(reminder_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        get_owned(db, Reminder, reminder_id, user.id).status = "cancelled"

    # --- 9.2 Preferences ------------------------------------------------------------
    @r.get("/preferences", response_model=PrefsOut)
    def get_prefs(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        return service.prefs_for(db, user.id)

    @r.put("/preferences", response_model=PrefsOut, summary="9.2 Set Notification Preferences")
    def set_prefs(body: PrefsIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        prefs = service.prefs_for(db, user.id)
        if body.timezone:
            from zoneinfo import ZoneInfo

            try:
                ZoneInfo(body.timezone)
            except Exception as exc:
                raise HTTPException(422, "Unknown timezone") from exc
        for k, v in body.model_dump(exclude_unset=True).items():
            setattr(prefs, k, v)
        return prefs

    # --- Push tokens (Expo) -----------------------------------------------------------
    @r.post("/push-tokens", status_code=204)
    def register_token(body: PushTokenIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        existing = db.scalar(select(PushToken).where(PushToken.token == body.token))
        if existing:
            existing.user_id, existing.platform = user.id, body.platform
        else:
            db.add(PushToken(user_id=user.id, token=body.token, platform=body.platform))

    @r.delete("/push-tokens/{token}", status_code=204)
    def remove_token(token: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        row = db.scalar(select(PushToken).where(PushToken.token == token, PushToken.user_id == user.id))
        if row:
            db.delete(row)

    @r.post("/dispatch", summary="Dev only: send due reminders now")
    def dispatch_now(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        settings = get_settings()
        if not settings.is_dev:
            raise HTTPException(404)
        return {"sent": service.dispatch_due(db, settings)}

    return r


class NotificationsPlugin(Plugin):
    name = "notifications"
    feature_id = "9.0"
    title = "Notifications & Reminders"
    functions = {
        "9.1": "Set Reminders",
        "9.2": "Set Notification Preferences",
        "9.3": "Send Notifications",
        "9.4": "View Notifications",
        "9.5": "Manage Notifications",
    }

    def build_router(self):
        return build_router()

    def setup(self, ctx):
        bus = ctx.bus

        def on_task(db: Session, payload):
            task = payload["task"]
            prefs = service.prefs_for(db, task.user_id)
            open_ = task.status not in ("done", "skipped")
            when = service.schedule_for_date(db, task.user_id, task.due_date, prefs.task_lead_days) if open_ else None
            service.upsert_auto(
                db,
                task.user_id,
                kind="task",
                ref_id=task.id,
                key=f"task:{task.id}",
                title=f"Due {task.due_date:%b %d}: {task.title}" if task.due_date else task.title,
                body=task.guidance[:200] if task.guidance else "Open SettleWise to review this task.",
                link=f"/task/{task.id}",
                remind_at=when,
            )

        def on_task_deleted(db: Session, payload):
            service.cancel_for_ref(db, payload["task"].user_id, payload["task"].id)

        def on_document(db: Session, payload):
            doc = payload["document"]
            service.cancel_for_ref(db, doc.user_id, doc.id)
            if not doc.expires_on:
                return
            prefs = service.prefs_for(db, doc.user_id)
            label = doc.label or doc.doc_type.replace("_", " ").title()
            for lead in sorted(set(prefs.document_lead_days or [])):
                when = service.at_local_hour(prefs, doc.expires_on - timedelta(days=lead))
                if when <= utcnow():
                    continue
                service.upsert_auto(
                    db,
                    doc.user_id,
                    kind="document",
                    ref_id=doc.id,
                    key=f"document:{doc.id}:{lead}",
                    title=f"{label} expires in {lead} days",
                    body=f"Expiry date: {doc.expires_on:%B %d, %Y}. Check how long renewal takes.",
                    link="/documents",
                    remind_at=when,
                )

        def on_document_deleted(db: Session, payload):
            service.cancel_for_ref(db, payload["document"].user_id, payload["document"].id)

        def on_bill(db: Session, payload):
            bill = payload["bill"]
            prefs = service.prefs_for(db, bill.user_id)
            service.upsert_auto(
                db,
                bill.user_id,
                kind="bill",
                ref_id=bill.id,
                key=f"bill:{bill.id}",
                title=f"{bill.name} ${bill.amount:,.2f} due {bill.next_due_date:%b %d}",
                body="Autopay is on." if bill.autopay else "Remember to pay this bill.",
                link="/finance",
                remind_at=service.schedule_for_date(db, bill.user_id, bill.next_due_date, prefs.bill_lead_days),
            )

        def on_bill_deleted(db: Session, payload):
            service.cancel_for_ref(db, payload["bill"].user_id, payload["bill"].id)

        def on_referral(db: Session, payload):
            ref = payload["referral"]
            prefs = service.prefs_for(db, ref.user_id)
            open_ = ref.status in ("requested", "accepted", "scheduled")
            who = "you" if ref.next_owner == "me" else ref.recipient_name
            service.upsert_auto(
                db,
                ref.user_id,
                kind="follow_up",
                ref_id=ref.id,
                key=f"referral:{ref.id}",
                title=f"Follow up: {ref.recipient_name}",
                body=f"Status: {ref.status}. Next to act: {who}.",
                link=f"/referral/{ref.id}",
                remind_at=service.schedule_for_date(db, ref.user_id, ref.follow_up_date, prefs.follow_up_lead_days)
                if open_
                else None,
            )

        def on_event_closed(db: Session, payload):
            from ..tasks import service as task_service

            ev = payload["life_event"]
            for task in task_service.event_tasks(db, ev.id):
                service.cancel_for_ref(db, ev.user_id, task.id)

        bus.subscribe(events.TASK_SAVED, on_task)
        bus.subscribe(events.TASK_DELETED, on_task_deleted)
        bus.subscribe(events.DOCUMENT_SAVED, on_document)
        bus.subscribe(events.DOCUMENT_DELETED, on_document_deleted)
        bus.subscribe(events.BILL_SAVED, on_bill)
        bus.subscribe(events.BILL_DELETED, on_bill_deleted)
        bus.subscribe(events.REFERRAL_SAVED, on_referral)
        bus.subscribe(events.LIFE_EVENT_CLOSED, on_event_closed)

    async def run_background(self, ctx):
        interval = ctx.settings.notification_dispatch_interval_seconds

        def tick():
            with core_db.SessionLocal() as db:
                sent = service.dispatch_due(db, ctx.settings)
                db.commit()
                return sent

        while True:
            try:
                sent = await asyncio.to_thread(tick)
                if sent:
                    log.info("Dispatched %s notification(s)", sent)
            except Exception:
                log.exception("Reminder dispatch failed")
            await asyncio.sleep(interval)

    def export_user_data(self, db, user_id):
        return {
            "reminders": [
                ReminderOut.model_validate(r).model_dump(mode="json")
                for r in db.scalars(select(Reminder).where(Reminder.user_id == user_id))
            ],
            "notifications": [
                NotificationOut.model_validate(n).model_dump(mode="json")
                for n in db.scalars(select(Notification).where(Notification.user_id == user_id))
            ],
            "preferences": PrefsOut.model_validate(service.prefs_for(db, user_id)).model_dump(),
        }

    def delete_user_data(self, db, user_id):
        delete_rows(db, user_id, Notification, Reminder, NotificationPreference, PushToken)


plugin = NotificationsPlugin()
