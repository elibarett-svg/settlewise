from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ...core.db import Base, Entity


class Profile(Entity, Base):
    __tablename__ = "profiles"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)
    immigration_status: Mapped[str] = mapped_column(String(40), default="permanent_resident")
    arrival_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    country_of_origin: Mapped[str] = mapped_column(String(80), default="")
    preferred_language: Mapped[str] = mapped_column(String(40), default="English")
    phone: Mapped[str] = mapped_column(String(40), default="")
    contact_email: Mapped[str] = mapped_column(String(255), default="")
    address_line: Mapped[str] = mapped_column(String(255), default="")
    city: Mapped[str] = mapped_column(String(80), default="")
    province: Mapped[str] = mapped_column(String(2), default="ON")
    postal_code: Mapped[str] = mapped_column(String(10), default="")
    employment_status: Mapped[str] = mapped_column(String(40), default="")
    has_vehicle: Mapped[bool] = mapped_column(Boolean, default=False)


class HouseholdMember(Entity, Base):
    __tablename__ = "household_members"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    full_name: Mapped[str] = mapped_column(String(200))
    relationship: Mapped[str] = mapped_column(String(40))  # spouse | child | parent | other
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")


class Document(Entity, Base):
    """A key document. The full number is never stored - only the last 4 characters."""

    __tablename__ = "documents"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    member_id: Mapped[str | None] = mapped_column(
        ForeignKey("household_members.id", ondelete="SET NULL"), nullable=True
    )
    doc_type: Mapped[str] = mapped_column(String(40))  # passport | pr_card | work_permit | ...
    label: Mapped[str] = mapped_column(String(200), default="")
    issuer: Mapped[str] = mapped_column(String(120), default="")
    number_last4: Mapped[str] = mapped_column(String(4), default="")
    issued_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    expires_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")
