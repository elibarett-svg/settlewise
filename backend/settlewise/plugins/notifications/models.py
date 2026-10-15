from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ...core.db import Base, Entity


class Reminder(Entity, Base):
    """9.1 - something to alert the user about at ``remind_at``."""

    __tablename__ = "reminders"
    __table_args__ = (UniqueConstraint("user_id", "dedupe_key"),)

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # task | bill | follow_up | document | custom
    ref_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    dedupe_key: Mapped[str | None] = mapped_column(String(120), nullable=True)
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text, default="")
    link: Mapped[str] = mapped_column(String(255), default="")  # in-app route, e.g. /task/<id>
    remind_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    status: Mapped[str] = mapped_column(String(20), default="scheduled")  # scheduled | sent | cancelled
    source: Mapped[str] = mapped_column(String(10), default="auto")  # auto | manual


class Notification(Entity, Base):
    """9.4 - one inbox for every alert."""

    __tablename__ = "notifications"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    reminder_id: Mapped[str | None] = mapped_column(ForeignKey("reminders.id", ondelete="SET NULL"), nullable=True)
    kind: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text, default="")
    link: Mapped[str] = mapped_column(String(255), default="")
    status: Mapped[str] = mapped_column(String(20), default="unread")  # unread | read | done | dismissed | snoozed
    snoozed_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class NotificationPreference(Entity, Base):
    """9.2 - channels, timing and quiet hours."""

    __tablename__ = "notification_preferences"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    push_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    email_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    timezone: Mapped[str] = mapped_column(String(60), default="America/Toronto")
    quiet_start: Mapped[str] = mapped_column(String(5), default="21:00")
    quiet_end: Mapped[str] = mapped_column(String(5), default="08:00")
    reminder_hour: Mapped[int] = mapped_column(Integer, default=9)
    task_lead_days: Mapped[int] = mapped_column(Integer, default=1)
    bill_lead_days: Mapped[int] = mapped_column(Integer, default=3)
    follow_up_lead_days: Mapped[int] = mapped_column(Integer, default=0)
    document_lead_days: Mapped[list] = mapped_column(JSON, default=lambda: [90, 30, 7])


class PushToken(Entity, Base):
    __tablename__ = "push_tokens"
    __table_args__ = (UniqueConstraint("token"),)

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token: Mapped[str] = mapped_column(String(255))
    platform: Mapped[str] = mapped_column(String(10), default="unknown")  # ios | android | web
