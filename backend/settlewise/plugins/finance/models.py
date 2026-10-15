from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ...core.db import Base, Entity


def Money():  # noqa: N802 - column factory
    return mapped_column(Numeric(12, 2, asdecimal=False), default=0)


class Budget(Entity, Base):
    __tablename__ = "budgets"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    life_event_id: Mapped[str | None] = mapped_column(ForeignKey("life_events.id", ondelete="SET NULL"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class BudgetLine(Entity, Base):
    __tablename__ = "budget_lines"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    budget_id: Mapped[str] = mapped_column(ForeignKey("budgets.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(10))  # income | expense
    category: Mapped[str] = mapped_column(String(40), default="general")
    label: Mapped[str] = mapped_column(String(120))
    amount: Mapped[float] = Money()  # per month
    day_of_month: Mapped[int] = mapped_column(Integer, default=1)


class Expense(Entity, Base):
    __tablename__ = "expenses"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    budget_id: Mapped[str | None] = mapped_column(ForeignKey("budgets.id", ondelete="SET NULL"), nullable=True)
    life_event_id: Mapped[str | None] = mapped_column(ForeignKey("life_events.id", ondelete="SET NULL"), nullable=True)
    category: Mapped[str] = mapped_column(String(40), default="general")
    amount: Mapped[float] = Money()
    spent_on: Mapped[date] = mapped_column(Date)
    note: Mapped[str] = mapped_column(Text, default="")


class Bill(Entity, Base):
    __tablename__ = "bills"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    provider: Mapped[str] = mapped_column(String(120), default="")
    category: Mapped[str] = mapped_column(String(40), default="utilities")
    amount: Mapped[float] = Money()
    frequency: Mapped[str] = mapped_column(String(12), default="monthly")
    next_due_date: Mapped[date] = mapped_column(Date)
    autopay: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str] = mapped_column(Text, default="")


class SavingsGoal(Entity, Base):
    __tablename__ = "savings_goals"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(20), default="custom")  # emergency | moving | travel | custom
    target_amount: Mapped[float] = Money()
    saved_amount: Mapped[float] = Money()
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)


class EventCost(Entity, Base):
    """5.6 An expected cost attached to a life event, anchored to its key date."""

    __tablename__ = "event_costs"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    life_event_id: Mapped[str] = mapped_column(ForeignKey("life_events.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(40), default="general")
    amount: Mapped[float] = Money()
    offset_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    due_date: Mapped[date] = mapped_column(Date)
    paid: Mapped[bool] = mapped_column(Boolean, default=False)
