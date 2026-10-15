"""Synthetic demo data - the Project Vision's illustrative persona, Sarah.

Sarah is fictional: a 34-year-old software engineer from the Philippines who
recently arrived in Toronto. Re-running the seed is safe (it skips existing users).
"""

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .core.config import Settings
from .core.models import User
from .core.plugin import registry
from .core.security import hash_password

SARAH_EMAIL = "sarah@example.com"
WORKER_EMAIL = "worker@example.com"


def _user(db: Session, email: str, name: str, password: str, role: str = "newcomer") -> tuple[User, bool]:
    user = db.scalar(select(User).where(User.email == email))
    if user:
        return user, False
    user = User(email=email, full_name=name, password_hash=hash_password(password), role=role)
    db.add(user)
    db.flush()
    return user, True


def seed_demo(db: Session, settings: Settings) -> str:
    sarah, created = _user(db, SARAH_EMAIL, "Sarah Santos", settings.seed_demo_password)
    if not created:
        return "Demo data already present"
    today = date.today()

    if registry.is_enabled("profile"):
        from .plugins.profile.models import Document, Profile

        db.add(
            Profile(
                user_id=sarah.id,
                immigration_status="permanent_resident",
                arrival_date=today - timedelta(days=120),
                country_of_origin="Philippines",
                preferred_language="English",
                phone="416-555-0199",
                contact_email=SARAH_EMAIL,
                address_line="100 Example St, Unit 4",
                city="Toronto",
                province="ON",
                postal_code="M5V 0A0",
                employment_status="employed",
            )
        )
        from .core import events

        for doc in [
            Document(
                user_id=sarah.id,
                doc_type="passport",
                label="Philippine passport",
                number_last4="7731",
                expires_on=today + timedelta(days=400),
            ),
            Document(
                user_id=sarah.id,
                doc_type="pr_card",
                label="PR card",
                number_last4="0042",
                expires_on=today + timedelta(days=1700),
            ),
            Document(
                user_id=sarah.id,
                doc_type="insurance_policy",
                label="Tenant insurance",
                issuer="Trillium Home & Tenant Insurance (sample)",
                expires_on=today + timedelta(days=60),
            ),
        ]:
            db.add(doc)
            db.flush()
            events.bus.publish(db, events.DOCUMENT_SAVED, {"document": doc})

    move = None
    if registry.is_enabled("planning"):
        from .plugins.planning import EventIn, create_life_event

        move = create_life_event(
            db,
            sarah.id,
            EventIn(event_type="moving", key_date=today + timedelta(days=30), title="Move to the new apartment"),
        )
        create_life_event(
            db,
            sarah.id,
            EventIn(event_type="new_job", key_date=today - timedelta(days=10), title="New job at a software company"),
        )
        from .core import events
        from .plugins.tasks import service as task_service
        from .plugins.tasks.models import Task

        for task in db.scalars(select(Task).where(Task.life_event_id == move.id, Task.offset_days <= -45)):
            task_service.mark_status(db, task, "done")
            events.bus.publish(db, events.TASK_SAVED, {"task": task})

    if registry.is_enabled("finance"):
        from .plugins.finance.models import Bill, Budget, BudgetLine, SavingsGoal

        budget = Budget(user_id=sarah.id, name="Monthly budget")
        db.add(budget)
        db.flush()
        for kind, cat, label, amount, day in [
            ("income", "salary", "Salary (net)", 5200, 1),
            ("expense", "housing", "Rent", 2400, 1),
            ("expense", "food", "Groceries", 600, 5),
            ("expense", "travel", "Transit", 156, 1),
            ("expense", "personal", "Personal and other", 400, 15),
        ]:
            db.add(
                BudgetLine(
                    user_id=sarah.id,
                    budget_id=budget.id,
                    kind=kind,
                    category=cat,
                    label=label,
                    amount=amount,
                    day_of_month=day,
                )
            )
        from .core import events

        for bill in [
            Bill(
                user_id=sarah.id,
                name="Phone plan",
                provider="Sample Mobile",
                category="utilities",
                amount=55,
                next_due_date=today + timedelta(days=5),
            ),
            Bill(
                user_id=sarah.id,
                name="Internet",
                provider="Sample Internet",
                category="utilities",
                amount=70,
                next_due_date=today + timedelta(days=12),
                autopay=True,
            ),
        ]:
            db.add(bill)
            db.flush()
            events.bus.publish(db, events.BILL_SAVED, {"bill": bill})
        db.add(
            SavingsGoal(
                user_id=sarah.id, name="Emergency fund", kind="emergency", target_amount=9000, saved_amount=3200
            )
        )

    if registry.is_enabled("referrals") and move is not None:
        from .plugins.referrals import ReferralIn, create_referral
        from .plugins.referrals.models import Provider

        agency = db.scalar(select(Provider).where(Provider.name.like("Harbourfront%")))
        create_referral(
            db,
            sarah.id,
            ReferralIn(
                provider_id=agency.id if agency else None,
                recipient_name=None if agency else "Settlement agency",
                reason="Help finding a family doctor near the new apartment",
                info_needed=["New address", "Health card"],
                life_event_id=move.id,
            ),
        )

    if registry.is_enabled("worker_portal"):
        from .plugins.consent import create_grant

        worker, _ = _user(db, WORKER_EMAIL, "Amara Okafor (settlement worker)", settings.seed_demo_password, "worker")
        create_grant(
            db,
            sarah,
            recipient_type="advisor",
            recipient_name=worker.full_name,
            recipient_email=WORKER_EMAIL,
            fields=["plans", "tasks", "referrals"],
            purpose="Settlement support for my move",
            duration_days=60,
        )

    return f"Seeded demo users ({SARAH_EMAIL}{', ' + WORKER_EMAIL if registry.is_enabled('worker_portal') else ''})"
