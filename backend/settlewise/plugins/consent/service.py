from datetime import date
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.db import as_utc, utcnow
from ...core.models import LifeEvent, User
from ...core.plugin import registry
from .models import AuditEntry, SharingGrant

FIELD_CATALOGUE: dict[str, str] = {
    "profile.contact": "Name, phone and contact email",
    "profile.address": "Current address",
    "profile.status": "Immigration status and arrival date",
    "household": "Household members",
    "documents": "Document list and expiry dates (numbers are never shared)",
    "plans": "Life events and plan progress",
    "tasks": "Tasks and due dates",
    "referrals": "Referrals and follow-ups",
    "finance.summary": "Monthly budget summary and upcoming bills",
}


def audit(
    db: Session,
    owner_id: str,
    action: str,
    actor_label: str,
    *,
    actor_user_id: str | None = None,
    resource: str = "",
    fields: list[str] | None = None,
    detail: str = "",
) -> None:
    db.add(
        AuditEntry(
            user_id=owner_id,
            actor_user_id=actor_user_id,
            actor_label=actor_label,
            action=action,
            resource=resource,
            fields=fields or [],
            detail=detail,
        )
    )


def is_active(grant: SharingGrant) -> bool:
    return grant.revoked_at is None and as_utc(grant.expires_at) > utcnow()


def grant_status(grant: SharingGrant) -> str:
    if grant.revoked_at:
        return "revoked"
    return "active" if is_active(grant) else "expired"


def active_grant(db: Session, owner_id: str, viewer_id: str) -> SharingGrant | None:
    grants = db.scalars(
        select(SharingGrant).where(SharingGrant.user_id == owner_id, SharingGrant.recipient_user_id == viewer_id)
    )
    live = [g for g in grants if is_active(g)]
    return max(live, key=lambda g: as_utc(g.expires_at)) if live else None


def require_fields(db: Session, owner_id: str, viewer: User, needed: list[str]) -> SharingGrant:
    grant = active_grant(db, owner_id, viewer.id)
    if grant is None:
        raise HTTPException(403, "This person has not shared their information with you, or access has expired")
    missing = [f for f in needed if f not in grant.fields]
    if missing:
        raise HTTPException(403, f"Not shared with you: {', '.join(missing)}")
    return grant


def shared_view(
    db: Session,
    owner_id: str,
    viewer: User,
    grant: SharingGrant,
    fields: list[str] | None = None,
    purpose: str = "viewed shared information",
) -> dict[str, Any]:
    """Return only the fields the grant allows, and record the access in the audit log."""
    fields = [f for f in (fields or grant.fields) if f in grant.fields]
    out: dict[str, Any] = {}
    owner = db.get(User, owner_id)
    if registry.is_enabled("profile"):
        from ..profile import DocumentOut
        from ..profile.models import Document, HouseholdMember, Profile

        profile = db.scalar(select(Profile).where(Profile.user_id == owner_id))
        if "profile.contact" in fields:
            out["contact"] = {
                "full_name": owner.full_name,
                "phone": profile.phone if profile else "",
                "email": profile.contact_email if profile else owner.email,
            }
        if "profile.address" in fields and profile:
            out["address"] = {
                "address_line": profile.address_line,
                "city": profile.city,
                "province": profile.province,
                "postal_code": profile.postal_code,
            }
        if "profile.status" in fields and profile:
            out["status"] = {
                "immigration_status": profile.immigration_status,
                "arrival_date": profile.arrival_date.isoformat() if profile.arrival_date else None,
            }
        if "household" in fields:
            out["household"] = [
                {"full_name": m.full_name, "relationship": m.relationship}
                for m in db.scalars(select(HouseholdMember).where(HouseholdMember.user_id == owner_id))
            ]
        if "documents" in fields:
            out["documents"] = [
                {k: v for k, v in DocumentOut.of(d).model_dump(mode="json").items() if k != "number_masked"}
                for d in db.scalars(select(Document).where(Document.user_id == owner_id))
            ]
    if "plans" in fields and registry.is_enabled("tasks"):
        from ..tasks import service as task_service

        out["plans"] = [
            {
                "id": ev.id,
                "title": ev.title,
                "event_type": ev.event_type,
                "key_date": ev.key_date.isoformat(),
                "status": ev.status,
                "progress": task_service.progress(db, ev.id),
            }
            for ev in db.scalars(select(LifeEvent).where(LifeEvent.user_id == owner_id))
        ]
    if "tasks" in fields and registry.is_enabled("tasks"):
        from ..tasks import service as task_service

        tasks = task_service.search(db, owner_id, status="open")
        out["tasks"] = [
            {
                "id": t.id,
                "title": t.title,
                "status": t.status,
                "category": t.category,
                "due_date": t.due_date.isoformat() if t.due_date else None,
                "overdue": bool(t.due_date and t.due_date < date.today()),
            }
            for t in tasks
        ]
    if "referrals" in fields and registry.is_enabled("referrals"):
        from ..referrals.models import Referral

        out["referrals"] = [
            {
                "id": r.id,
                "recipient_name": r.recipient_name,
                "status": r.status,
                "next_owner": r.next_owner,
                "follow_up_date": r.follow_up_date.isoformat() if r.follow_up_date else None,
                "reason": r.reason,
            }
            for r in db.scalars(select(Referral).where(Referral.user_id == owner_id))
        ]
    if "finance.summary" in fields and registry.is_enabled("finance"):
        from ..finance import service as fin

        lines = fin.active_lines(db, owner_id)
        out["finance_summary"] = {
            "monthly_income": sum(line.amount for line in lines if line.kind == "income"),
            "monthly_planned_expenses": sum(line.amount for line in lines if line.kind == "expense"),
        }
    audit(
        db,
        owner_id,
        "viewed",
        viewer.full_name or viewer.email,
        actor_user_id=viewer.id,
        resource="shared_view",
        fields=fields,
        detail=purpose,
    )
    return out
