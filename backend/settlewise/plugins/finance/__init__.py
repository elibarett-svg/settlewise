"""5.0 Financial Readiness Center - the money side of each life event."""

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core import events
from ...core.crud import register_crud
from ...core.db import get_db
from ...core.deps import get_current_user, get_owned
from ...core.models import LifeEvent, User
from ...core.plugin import ImpactItem, Plugin
from ...core.util import delete_rows, dump_rows
from . import service
from .models import Bill, Budget, BudgetLine, EventCost, Expense, SavingsGoal

Amount = Field(ge=0, le=10_000_000)


class BudgetIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    life_event_id: str | None = None
    is_active: bool = True


class BudgetPatch(BaseModel):
    name: str | None = None
    life_event_id: str | None = None
    is_active: bool | None = None


class LineIn(BaseModel):
    kind: str = Field(pattern="^(income|expense)$")
    category: str = "general"
    label: str = Field(min_length=1, max_length=120)
    amount: float = Amount
    day_of_month: int = Field(default=1, ge=1, le=31)


class LinePatch(BaseModel):
    kind: str | None = Field(default=None, pattern="^(income|expense)$")
    category: str | None = None
    label: str | None = None
    amount: float | None = Field(default=None, ge=0)
    day_of_month: int | None = Field(default=None, ge=1, le=31)


class LineOut(LineIn):
    id: str
    budget_id: str
    model_config = {"from_attributes": True}


class BudgetOut(BaseModel):
    id: str
    name: str
    life_event_id: str | None
    is_active: bool
    lines: list[LineOut] = []
    model_config = {"from_attributes": True}


class ExpenseIn(BaseModel):
    amount: float = Amount
    category: str = "general"
    spent_on: date
    note: str = ""
    budget_id: str | None = None
    life_event_id: str | None = None


class ExpenseOut(ExpenseIn):
    id: str
    model_config = {"from_attributes": True}


class BillIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    provider: str = ""
    category: str = "utilities"
    amount: float = Amount
    frequency: str = "monthly"
    next_due_date: date
    autopay: bool = False
    notes: str = ""

    @field_validator("frequency")
    @classmethod
    def _freq(cls, v):
        if v not in service.FREQUENCIES:
            raise ValueError(f"must be one of {service.FREQUENCIES}")
        return v


class BillPatch(BaseModel):
    name: str | None = None
    provider: str | None = None
    category: str | None = None
    amount: float | None = Field(default=None, ge=0)
    frequency: str | None = None
    next_due_date: date | None = None
    autopay: bool | None = None
    notes: str | None = None


class BillOut(BillIn):
    id: str
    model_config = {"from_attributes": True}


class GoalIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: str = Field(default="custom", pattern="^(emergency|moving|travel|education|custom)$")
    target_amount: float = Amount
    saved_amount: float = Field(default=0, ge=0)
    target_date: date | None = None


class GoalPatch(BaseModel):
    name: str | None = None
    kind: str | None = Field(default=None, pattern="^(emergency|moving|travel|education|custom)$")
    target_amount: float | None = Field(default=None, ge=0)
    saved_amount: float | None = Field(default=None, ge=0)
    target_date: date | None = None


class GoalOut(GoalIn):
    id: str
    model_config = {"from_attributes": True}


class ContributionIn(BaseModel):
    amount: float = Field(gt=0)


class CostIn(BaseModel):
    life_event_id: str
    label: str = Field(min_length=1, max_length=120)
    category: str = "general"
    amount: float = Amount
    due_date: date
    paid: bool = False


class CostPatch(BaseModel):
    label: str | None = None
    category: str | None = None
    amount: float | None = Field(default=None, ge=0)
    due_date: date | None = None
    paid: bool | None = None


class CostOut(CostIn):
    id: str
    offset_days: int | None
    model_config = {"from_attributes": True}


def _budget_out(db: Session, budget: Budget) -> BudgetOut:
    lines = db.scalars(select(BudgetLine).where(BudgetLine.budget_id == budget.id)).all()
    out = BudgetOut.model_validate(budget)
    out.lines = [LineOut.model_validate(line) for line in lines]
    return out


def _validate_links(db: Session, user: User, data: dict) -> None:
    if data.get("budget_id"):
        get_owned(db, Budget, data["budget_id"], user.id, "Budget")
    if data.get("life_event_id"):
        get_owned(db, LifeEvent, data["life_event_id"], user.id, "Life event")


def _bill_saved(db: Session, bill: Bill) -> None:
    events.bus.publish(db, events.BILL_SAVED, {"bill": bill})


def _bill_deleted(db: Session, bill: Bill) -> None:
    events.bus.publish(db, events.BILL_DELETED, {"bill": bill})


def build_router() -> APIRouter:
    r = APIRouter(prefix="/finance", tags=["5.0 Finance"])

    # --- 5.1 Budgets ---------------------------------------------------------------
    @r.get("/budgets", response_model=list[BudgetOut])
    def list_budgets(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        return [_budget_out(db, b) for b in db.scalars(select(Budget).where(Budget.user_id == user.id))]

    @r.post("/budgets", response_model=BudgetOut, status_code=201, summary="5.1 Create Budget")
    def create_budget(body: BudgetIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        _validate_links(db, user, body.model_dump())
        budget = Budget(user_id=user.id, **body.model_dump())
        db.add(budget)
        db.flush()
        return _budget_out(db, budget)

    @r.get("/budgets/{budget_id}", response_model=BudgetOut)
    def read_budget(budget_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        return _budget_out(db, get_owned(db, Budget, budget_id, user.id))

    @r.patch("/budgets/{budget_id}", response_model=BudgetOut)
    def update_budget(
        budget_id: str, body: BudgetPatch, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ):
        budget = get_owned(db, Budget, budget_id, user.id)
        data = body.model_dump(exclude_unset=True)
        _validate_links(db, user, data)
        for k, v in data.items():
            setattr(budget, k, v)
        return _budget_out(db, budget)

    @r.delete("/budgets/{budget_id}", status_code=204)
    def delete_budget(budget_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        db.delete(get_owned(db, Budget, budget_id, user.id))

    @r.post("/budgets/{budget_id}/lines", response_model=LineOut, status_code=201)
    def add_line(budget_id: str, body: LineIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        get_owned(db, Budget, budget_id, user.id)
        line = BudgetLine(user_id=user.id, budget_id=budget_id, **body.model_dump())
        db.add(line)
        db.flush()
        return line

    @r.patch("/lines/{line_id}", response_model=LineOut)
    def update_line(
        line_id: str, body: LinePatch, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ):
        line = get_owned(db, BudgetLine, line_id, user.id, "Budget line")
        for k, v in body.model_dump(exclude_unset=True).items():
            setattr(line, k, v)
        return line

    @r.delete("/lines/{line_id}", status_code=204)
    def delete_line(line_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        db.delete(get_owned(db, BudgetLine, line_id, user.id, "Budget line"))

    @r.get("/budgets/{budget_id}/summary", summary="5.2 Track Expenses (planned vs actual)")
    def budget_summary(
        budget_id: str,
        month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        budget = get_owned(db, Budget, budget_id, user.id)
        when = date.fromisoformat(f"{month}-01") if month else date.today()
        return service.budget_summary(db, budget, when)

    # --- 5.2 Expenses --------------------------------------------------------------
    @r.get("/expenses", response_model=list[ExpenseOut])
    def list_expenses(
        month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
        budget_id: str | None = None,
        life_event_id: str | None = None,
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        stmt = select(Expense).where(Expense.user_id == user.id)
        if month:
            start = date.fromisoformat(f"{month}-01")
            stmt = stmt.where(Expense.spent_on >= start, Expense.spent_on < service.add_months(start, 1))
        if budget_id:
            stmt = stmt.where(Expense.budget_id == budget_id)
        if life_event_id:
            stmt = stmt.where(Expense.life_event_id == life_event_id)
        return db.scalars(stmt.order_by(Expense.spent_on.desc())).all()

    register_crud(
        r,
        "/expenses",
        Expense,
        ExpenseIn,
        ExpenseIn,
        ExpenseOut,
        label="Expense",
        validate=_validate_links,
        summary="5.2 Track Expenses",
        include_list=False,
    )

    # --- 5.3 Bills -----------------------------------------------------------------
    register_crud(
        r,
        "/bills",
        Bill,
        BillIn,
        BillPatch,
        BillOut,
        label="Bill",
        order_by=Bill.next_due_date,
        after_save=_bill_saved,
        before_delete=_bill_deleted,
        summary="5.3 Manage Recurring Bills",
    )

    @r.post("/bills/{bill_id}/paid", response_model=BillOut, summary="Mark paid and move to the next due date")
    def bill_paid(bill_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        bill = get_owned(db, Bill, bill_id, user.id)
        nxt = service.next_occurrence(bill.next_due_date, bill.frequency)
        if nxt is None:
            raise HTTPException(409, "One-time bill - delete it once paid")
        bill.next_due_date = nxt
        _bill_saved(db, bill)
        return bill

    # --- 5.4 Savings goals ---------------------------------------------------------
    register_crud(
        r, "/goals", SavingsGoal, GoalIn, GoalPatch, GoalOut, label="Savings goal", summary="5.4 Set Savings Goals"
    )

    @r.post("/goals/{goal_id}/contribute", response_model=GoalOut)
    def contribute(
        goal_id: str, body: ContributionIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ):
        goal = get_owned(db, SavingsGoal, goal_id, user.id, "Savings goal")
        goal.saved_amount = round(goal.saved_amount + body.amount, 2)
        return goal

    # --- 5.6 Costs linked to life events --------------------------------------------
    @r.get("/event-costs", response_model=list[CostOut])
    def list_costs(
        life_event_id: str | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ):
        stmt = select(EventCost).where(EventCost.user_id == user.id)
        if life_event_id:
            stmt = stmt.where(EventCost.life_event_id == life_event_id)
        return db.scalars(stmt.order_by(EventCost.due_date)).all()

    register_crud(
        r,
        "/event-costs",
        EventCost,
        CostIn,
        CostPatch,
        CostOut,
        label="Event cost",
        validate=_validate_links,
        summary="5.6 Link Costs to Life Event",
        include_list=False,
    )

    # --- 5.5 Forecast ----------------------------------------------------------------
    @r.get("/forecast", summary="5.5 Forecast Cash Flow")
    def cash_forecast(
        days: int = Query(default=90, ge=7, le=366),
        starting_balance: float = 0.0,
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        return service.forecast(db, user.id, days, starting_balance)

    @r.get("/overview")
    def overview(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        lines = service.active_lines(db, user.id)
        bills = db.scalars(select(Bill).where(Bill.user_id == user.id)).all()
        goals = db.scalars(select(SavingsGoal).where(SavingsGoal.user_id == user.id)).all()
        soon = date.today() + timedelta(days=30)
        income = sum(line.amount for line in lines if line.kind == "income")
        planned = sum(line.amount for line in lines if line.kind == "expense")
        bills_monthly = sum(b.amount * service.MONTHLY_FACTOR.get(b.frequency, 1) for b in bills)
        return {
            "monthly_income": round(income, 2),
            "monthly_planned_expenses": round(planned, 2),
            "monthly_bills": round(bills_monthly, 2),
            "monthly_surplus": round(income - planned - bills_monthly, 2),
            "bills_due_30_days": [
                BillOut.model_validate(b).model_dump(mode="json") for b in bills if b.next_due_date <= soon
            ],
            "goals": [
                {
                    **GoalOut.model_validate(g).model_dump(mode="json"),
                    "percent": round(100 * g.saved_amount / g.target_amount) if g.target_amount else 0,
                }
                for g in goals
            ],
        }

    return r


class FinancePlugin(Plugin):
    name = "finance"
    feature_id = "5.0"
    title = "Financial Readiness Center"
    functions = {
        "5.1": "Create Budget",
        "5.2": "Track Expenses",
        "5.3": "Manage Recurring Bills",
        "5.4": "Set Savings Goals",
        "5.5": "Forecast Cash Flow",
        "5.6": "Link Costs to Life Event",
    }

    def build_router(self):
        return build_router()

    def setup(self, ctx):
        def on_event_created(db: Session, payload):
            ev = payload["life_event"]
            for cost in payload.get("costs", []):
                offset = cost.get("offset_days", 0)
                db.add(
                    EventCost(
                        user_id=ev.user_id,
                        life_event_id=ev.id,
                        label=cost["label"],
                        category=cost.get("category", "general"),
                        amount=cost.get("amount", 0),
                        offset_days=offset,
                        due_date=ev.key_date + timedelta(days=offset),
                    )
                )
            db.flush()

        ctx.bus.subscribe(events.LIFE_EVENT_CREATED, on_event_created)

    def propose_impact(self, db, life_event, old_date, new_date):
        items = []
        costs = db.scalars(
            select(EventCost).where(EventCost.life_event_id == life_event.id, EventCost.paid.is_(False))
        ).all()
        for cost in costs:
            proposed = (
                new_date + timedelta(days=cost.offset_days)
                if cost.offset_days is not None
                else cost.due_date + (new_date - old_date)
            )
            if proposed == cost.due_date:
                continue
            items.append(
                ImpactItem(
                    plugin=self.name,
                    kind="cost",
                    ref_id=cost.id,
                    category="budget",
                    action="recalculate",
                    title=f"{cost.label} (${cost.amount:,.0f})",
                    reason="Expected cost moves with the key date; your cash-flow forecast will be recalculated.",
                    current_value=cost.due_date.isoformat(),
                    proposed_value=proposed.isoformat(),
                )
            )
        return items

    def apply_impact(self, db, life_event, items, delta_days):
        for item in items:
            cost = db.get(EventCost, item.ref_id)
            if cost and cost.user_id == life_event.user_id and item.proposed_value:
                cost.due_date = date.fromisoformat(item.proposed_value)

    def export_user_data(self, db, user_id):
        return {
            "budgets": [
                _budget_out(db, b).model_dump(mode="json")
                for b in db.scalars(select(Budget).where(Budget.user_id == user_id))
            ],
            "expenses": dump_rows(db, Expense, ExpenseOut, user_id),
            "bills": dump_rows(db, Bill, BillOut, user_id),
            "goals": dump_rows(db, SavingsGoal, GoalOut, user_id),
            "event_costs": dump_rows(db, EventCost, CostOut, user_id),
        }

    def delete_user_data(self, db, user_id):
        delete_rows(db, user_id, EventCost, Expense, BudgetLine, Budget, Bill, SavingsGoal)


plugin = FinancePlugin()
