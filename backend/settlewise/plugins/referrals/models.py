from datetime import date

from sqlalchemy import JSON, Boolean, Date, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ...core.db import Base, Entity

STATUS_FLOW = {
    "requested": {"accepted", "declined", "cancelled"},
    "accepted": {"scheduled", "completed", "cancelled"},
    "scheduled": {"completed", "accepted", "cancelled"},
    "completed": set(),
    "declined": {"requested"},
    "cancelled": {"requested"},
}
# Who acts next by default at each stage (6.3) - the user can override.
DEFAULT_NEXT_OWNER = {
    "requested": "provider",
    "accepted": "me",
    "scheduled": "me",
    "completed": "none",
    "declined": "me",
    "cancelled": "none",
}


class Provider(Entity, Base):
    __tablename__ = "providers"

    name: Mapped[str] = mapped_column(String(200), index=True)
    service_types: Mapped[list] = mapped_column(JSON, default=list)
    city: Mapped[str] = mapped_column(String(80), default="")
    province: Mapped[str] = mapped_column(String(2), default="")
    phone: Mapped[str] = mapped_column(String(40), default="")
    website: Mapped[str] = mapped_column(String(255), default="")
    languages: Mapped[list] = mapped_column(JSON, default=list)
    description: Mapped[str] = mapped_column(Text, default="")
    reviewed_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_sample: Mapped[bool] = mapped_column(Boolean, default=True)


class Referral(Entity, Base):
    __tablename__ = "referrals"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    life_event_id: Mapped[str | None] = mapped_column(ForeignKey("life_events.id", ondelete="SET NULL"), nullable=True)
    task_id: Mapped[str | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    provider_id: Mapped[str | None] = mapped_column(ForeignKey("providers.id", ondelete="SET NULL"), nullable=True)
    recipient_name: Mapped[str] = mapped_column(String(200))
    service_type: Mapped[str] = mapped_column(String(40), default="")
    reason: Mapped[str] = mapped_column(Text)
    info_needed: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(20), default="requested")
    next_owner: Mapped[str] = mapped_column(String(20), default="provider")
    follow_up_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    scheduled_for: Mapped[date | None] = mapped_column(Date, nullable=True)
    outcome: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(120), default="self")  # self | worker:<name>


class ReferralUpdate(Entity, Base):
    __tablename__ = "referral_updates"

    referral_id: Mapped[str] = mapped_column(ForeignKey("referrals.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(20))
    note: Mapped[str] = mapped_column(Text, default="")
    by: Mapped[str] = mapped_column(String(120), default="self")
