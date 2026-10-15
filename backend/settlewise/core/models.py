from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base, Entity


class User(Entity, Base):
    """An account. Feature data lives in plugin tables keyed by user_id."""

    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(200), default="")
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="newcomer")  # newcomer | worker | admin
    display_language: Mapped[str] = mapped_column(String(10), default="en")
    totp_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Bumped on sign-out-everywhere and password change to invalidate old tokens.
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    reset_token_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)


class LifeEvent(Entity, Base):
    """A case: one life event (moving, travel, new job...) that ties tasks,
    costs, referrals and reminders from many plugins into one connected plan."""

    __tablename__ = "life_events"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(200))
    key_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | closed
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")
