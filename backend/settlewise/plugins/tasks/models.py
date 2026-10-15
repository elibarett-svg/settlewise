from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ...core.db import Base, Entity

OPEN_STATUSES = ("todo", "in_progress", "needs_review")
CLOSED_STATUSES = ("done", "skipped")
STATUSES = OPEN_STATUSES + CLOSED_STATUSES


class Task(Entity, Base):
    __tablename__ = "tasks"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    life_event_id: Mapped[str | None] = mapped_column(
        ForeignKey("life_events.id", ondelete="CASCADE"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(40), default="general")
    owner: Mapped[str] = mapped_column(String(120), default="me")  # me | household member | provider name
    priority: Mapped[str] = mapped_column(String(10), default="medium")  # low | medium | high
    status: Mapped[str] = mapped_column(String(20), default="todo")
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    # Template linkage: anchored tasks keep their offset from the event's key date.
    template_key: Mapped[str | None] = mapped_column(String(60), nullable=True)
    offset_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    date_sensitive: Mapped[bool] = mapped_column(Boolean, default=False)
    external_party: Mapped[str] = mapped_column(String(120), default="")
    guidance: Mapped[str] = mapped_column(Text, default="")
    source_ids: Mapped[list] = mapped_column(JSON, default=list)


class TaskDependency(Base):
    """``task_id`` cannot start until ``depends_on_id`` is done (4.3)."""

    __tablename__ = "task_dependencies"
    __table_args__ = (UniqueConstraint("task_id", "depends_on_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    depends_on_id: Mapped[str] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)


class ImpactReview(Entity, Base):
    """A proposed key-date change and everything it affects, awaiting the user's approval (4.4)."""

    __tablename__ = "impact_reviews"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    life_event_id: Mapped[str] = mapped_column(ForeignKey("life_events.id", ondelete="CASCADE"), index=True)
    old_date: Mapped[date] = mapped_column(Date)
    new_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | applied | dismissed | superseded
    items: Mapped[list] = mapped_column(JSON, default=list)
    approved_item_ids: Mapped[list] = mapped_column(JSON, default=list)
