from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ...core.db import Base, Entity


class SharingGrant(Entity, Base):
    """7.1/7.2 - who may see which fields, why, and until when."""

    __tablename__ = "sharing_grants"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    recipient_type: Mapped[str] = mapped_column(String(20))  # advisor | provider | household | other
    recipient_name: Mapped[str] = mapped_column(String(200))
    recipient_email: Mapped[str] = mapped_column(String(255), default="")
    recipient_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    fields: Mapped[list] = mapped_column(JSON, default=list)
    purpose: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AccessRequest(Entity, Base):
    """7.3 - an advisor or provider asks the user for access."""

    __tablename__ = "access_requests"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)  # data owner
    requester_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    requester_name: Mapped[str] = mapped_column(String(200))
    requester_type: Mapped[str] = mapped_column(String(20), default="advisor")
    fields: Mapped[list] = mapped_column(JSON, default=list)
    purpose: Mapped[str] = mapped_column(Text)
    duration_days: Mapped[int] = mapped_column(Integer, default=90)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | approved | declined
    grant_id: Mapped[str | None] = mapped_column(String(32), nullable=True)


class AuditEntry(Entity, Base):
    """7.5 - an append-only record of who accessed or changed sharing, and when."""

    __tablename__ = "audit_entries"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)  # data owner
    actor_user_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    actor_label: Mapped[str] = mapped_column(String(200))
    action: Mapped[str] = mapped_column(String(40))
    resource: Mapped[str] = mapped_column(String(80), default="")
    fields: Mapped[list] = mapped_column(JSON, default=list)
    detail: Mapped[str] = mapped_column(Text, default="")
