import calendar
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.models import LifeEvent
from .models import Bill, Budget, BudgetLine, EventCost, Expense, SavingsGoal

FREQUENCIES = ("once", "weekly", "biweekly", "monthly", "quarterly", "yearly")
MONTHLY_FACTOR = {"once": 0, "weekly": 52 / 12, "biweekly": 26 / 12, "monthly": 1, "quarterly": 1 / 3, "yearly": 1 / 12}


def add_months(d: date, months: int) -> date:
    month = d.month - 1 + months
    year = d.year + month // 12
    month = month % 12 + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def next_occurrence(d: date, frequency: str) -> date | None:
    return {
        "weekly": lambda: d + timedelta(days=7),
        "biweekly": lambda: d + timedelta(days=14),
        "monthly": lambda: add_months(d, 1),
        "quarterly": lambda: add_months(d, 3),
        "yearly": lambda: add_months(d, 12),
    }.get(frequency, lambda: None)()


def bill_occurrences(bill: Bill, start: date, end: date) -> list[date]:
    out, current = [], bill.next_due_date
    while current and current <= end:
        if current >= start:
            out.append(current)
        current = next_occurrence(current, bill.frequency)
    return out


def active_lines(db: Session, user_id: str) -> list[BudgetLine]:
    stmt = (
        select(BudgetLine)
        .join(Budget, Budget.id == BudgetLine.budget_id)
        .where(BudgetLine.user_id == user_id, Budget.is_active.is_(True))
    )
    return list(db.scalars(stmt))


def forecast(
    db: Session, user_id: str, days: int, starting_balance: float, today: date | None = None
) -> dict[str, Any]:
    """5.5 Forecast Cash Flow - project the balance from budget lines, bills and
    unpaid life-event costs. A key-date change moves event costs, so the forecast
    follows automatically (5.6)."""
    today = today or date.today()
    end = today + timedelta(days=days)
    flows: list[dict[str, Any]] = []

    for line in active_lines(db, user_id):
        month_start = date(today.year, today.month, 1)
        while month_start <= end:
            day = min(line.day_of_month, calendar.monthrange(month_start.year, month_start.month)[1])
            when = month_start.replace(day=day)
            if today <= when <= end:
                sign = 1 if line.kind == "income" else -1
                flows.append({"date": when, "label": line.label, "amount": sign * line.amount, "source": "budget"})
            month_start = add_months(month_start, 1)

    for bill in db.scalars(select(Bill).where(Bill.user_id == user_id)):
        for when in bill_occurrences(bill, today, end):
            flows.append({"date": when, "label": bill.name, "amount": -bill.amount, "source": "bill"})

    costs = db.scalars(
        select(EventCost)
        .join(LifeEvent, LifeEvent.id == EventCost.life_event_id)
        .where(EventCost.user_id == user_id, EventCost.paid.is_(False), LifeEvent.status == "active")
    )
    for cost in costs:
        when = max(cost.due_date, today)  # overdue unpaid costs count today
        if when <= end:
            flows.append(
                {
                    "date": when,
                    "label": cost.label,
                    "amount": -cost.amount,
                    "source": "life_event",
                    "life_event_id": cost.life_event_id,
                }
            )

    by_day: dict[date, float] = defaultdict(float)
    for f in flows:
        by_day[f["date"]] += f["amount"]
    balance, points = starting_balance, []
    lowest = {"date": today.isoformat(), "balance": round(starting_balance, 2)}
    for i in range(days + 1):
        d = today + timedelta(days=i)
        balance += by_day.get(d, 0.0)
        points.append({"date": d.isoformat(), "balance": round(balance, 2)})
        if balance < lowest["balance"]:
            lowest = {"date": d.isoformat(), "balance": round(balance, 2)}

    emergency = db.scalar(select(SavingsGoal).where(SavingsGoal.user_id == user_id, SavingsGoal.kind == "emergency"))
    warnings = []
    if lowest["balance"] < 0:
        warnings.append(f"Your balance is projected to go below zero on {lowest['date']}.")
    if emergency and emergency.saved_amount < emergency.target_amount:
        warnings.append(f"Emergency fund is at {emergency.saved_amount:.0f} of {emergency.target_amount:.0f}.")
    flows.sort(key=lambda f: f["date"])
    return {
        "start_date": today.isoformat(),
        "end_date": end.isoformat(),
        "starting_balance": starting_balance,
        "ending_balance": round(balance, 2),
        "lowest": lowest,
        "points": points,
        "flows": [{**f, "date": f["date"].isoformat(), "amount": round(f["amount"], 2)} for f in flows],
        "warnings": warnings,
    }


def budget_summary(db: Session, budget: Budget, month: date) -> dict[str, Any]:
    """5.2 Track Expenses - planned vs actual by category for one month."""
    start = month.replace(day=1)
    end = add_months(start, 1) - timedelta(days=1)
    lines = db.scalars(select(BudgetLine).where(BudgetLine.budget_id == budget.id)).all()
    expenses = db.scalars(
        select(Expense).where(Expense.budget_id == budget.id, Expense.spent_on >= start, Expense.spent_on <= end)
    ).all()
    categories: dict[str, dict[str, float]] = defaultdict(lambda: {"planned": 0.0, "actual": 0.0})
    income = 0.0
    for line in lines:
        if line.kind == "income":
            income += line.amount
        else:
            categories[line.category]["planned"] += line.amount
    for e in expenses:
        categories[e.category]["actual"] += e.amount
    rows = [
        {
            "category": c,
            "planned": round(v["planned"], 2),
            "actual": round(v["actual"], 2),
            "remaining": round(v["planned"] - v["actual"], 2),
        }
        for c, v in sorted(categories.items())
    ]
    planned = sum(r["planned"] for r in rows)
    actual = sum(r["actual"] for r in rows)
    return {
        "month": start.strftime("%Y-%m"),
        "income": round(income, 2),
        "planned_expenses": round(planned, 2),
        "actual_expenses": round(actual, 2),
        "planned_surplus": round(income - planned, 2),
        "categories": rows,
    }
