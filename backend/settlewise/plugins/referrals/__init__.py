"""6.0 Referral & Handoff Management - who was contacted, why, and who acts next."""

from datetime import date, datetime, timedelta
from pathlib import Path

import yaml
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ...core import events
from ...core.db import get_db
from ...core.deps import get_current_user, get_owned
from ...core.models import LifeEvent, User
from ...core.plugin import ImpactItem, Plugin
from ...core.util import delete_rows
from .models import DEFAULT_NEXT_OWNER, STATUS_FLOW, Provider, Referral, ReferralUpdate

NEXT_OWNER = "^(me|provider|household|none)$"


class ProviderOut(BaseModel):
    id: str
    name: str
    service_types: list[str]
    city: str
    province: str
    phone: str
    website: str
    languages: list[str]
    description: str
    reviewed_on: date | None
    is_sample: bool
    model_config = {"from_attributes": True}


class ReferralIn(BaseModel):
    recipient_name: str | None = Field(default=None, max_length=200)
    provider_id: str | None = None
    service_type: str = ""
    reason: str = Field(min_length=1)
    info_needed: list[str] = []
    life_event_id: str | None = None
    task_id: str | None = None
    follow_up_date: date | None = None


class StatusIn(BaseModel):
    status: str
    note: str = ""
    scheduled_for: date | None = None
    outcome: str | None = None


class ReferralPatch(BaseModel):
    next_owner: str | None = Field(default=None, pattern=NEXT_OWNER)
    follow_up_date: date | None = None
    reason: str | None = None
    info_needed: list[str] | None = None


class UpdateOut(BaseModel):
    status: str
    note: str
    by: str
    created_at: datetime
    model_config = {"from_attributes": True}


class ReferralOut(BaseModel):
    id: str
    recipient_name: str
    provider_id: str | None
    service_type: str
    reason: str
    info_needed: list[str]
    life_event_id: str | None
    task_id: str | None
    status: str
    next_owner: str
    follow_up_date: date | None
    scheduled_for: date | None
    outcome: str
    created_by: str
    follow_up_overdue: bool = False
    allowed_transitions: list[str] = []
    history: list[UpdateOut] = []


def referral_out(db: Session, ref: Referral, with_history: bool = False) -> ReferralOut:
    history = []
    if with_history:
        history = db.scalars(
            select(ReferralUpdate).where(ReferralUpdate.referral_id == ref.id).order_by(ReferralUpdate.created_at)
        ).all()
    return ReferralOut(
        id=ref.id,
        recipient_name=ref.recipient_name,
        provider_id=ref.provider_id,
        service_type=ref.service_type,
        reason=ref.reason,
        info_needed=ref.info_needed or [],
        life_event_id=ref.life_event_id,
        task_id=ref.task_id,
        status=ref.status,
        next_owner=ref.next_owner,
        follow_up_date=ref.follow_up_date,
        scheduled_for=ref.scheduled_for,
        outcome=ref.outcome,
        created_by=ref.created_by,
        follow_up_overdue=bool(
            ref.follow_up_date and ref.follow_up_date < date.today() and ref.status not in ("completed", "cancelled")
        ),
        allowed_transitions=sorted(STATUS_FLOW.get(ref.status, set())),
        history=[UpdateOut.model_validate(h) for h in history],
    )


def create_referral(db: Session, owner_id: str, body: ReferralIn, by: str = "self") -> Referral:
    """Shared by the newcomer API (6.2) and the worker portal (8.4)."""
    recipient = body.recipient_name
    service_type = body.service_type
    if body.provider_id:
        provider = db.get(Provider, body.provider_id)
        if provider is None:
            raise HTTPException(404, "Provider not found")
        recipient = recipient or provider.name
        service_type = service_type or (provider.service_types or [""])[0]
    if not recipient:
        raise HTTPException(422, "Choose a provider or enter who the referral is for")
    if body.life_event_id:
        get_owned(db, LifeEvent, body.life_event_id, owner_id, "Life event")
    ref = Referral(
        user_id=owner_id,
        recipient_name=recipient,
        provider_id=body.provider_id,
        service_type=service_type,
        reason=body.reason,
        info_needed=body.info_needed,
        life_event_id=body.life_event_id,
        task_id=body.task_id,
        follow_up_date=body.follow_up_date or date.today() + timedelta(days=7),
        status="requested",
        next_owner=DEFAULT_NEXT_OWNER["requested"],
        created_by=by,
    )
    db.add(ref)
    db.flush()
    db.add(ReferralUpdate(referral_id=ref.id, user_id=owner_id, status="requested", note="Referral created", by=by))
    events.bus.publish(db, events.REFERRAL_SAVED, {"referral": ref})
    return ref


def change_status(db: Session, ref: Referral, body: StatusIn, by: str = "self") -> Referral:
    if body.status not in STATUS_FLOW.get(ref.status, set()):
        allowed = ", ".join(sorted(STATUS_FLOW.get(ref.status, set()))) or "none"
        raise HTTPException(409, f"Cannot move from {ref.status} to {body.status}. Allowed: {allowed}")
    ref.status = body.status
    ref.next_owner = DEFAULT_NEXT_OWNER[body.status]
    if body.scheduled_for:
        ref.scheduled_for = body.scheduled_for
        ref.follow_up_date = body.scheduled_for + timedelta(days=1)
    if body.outcome is not None:
        ref.outcome = body.outcome
    if body.status in ("completed", "cancelled"):
        ref.follow_up_date = None
    db.add(ReferralUpdate(referral_id=ref.id, user_id=ref.user_id, status=body.status, note=body.note, by=by))
    events.bus.publish(db, events.REFERRAL_SAVED, {"referral": ref})
    return ref


def search_providers(
    db: Session, service_type: str | None, city: str | None, province: str | None, language: str | None, q: str | None
) -> list[Provider]:
    stmt = select(Provider)
    if city:
        stmt = stmt.where(func.lower(Provider.city) == city.lower())
    if province:
        stmt = stmt.where(Provider.province == province.upper())
    if q:
        stmt = stmt.where(or_(Provider.name.ilike(f"%{q}%"), Provider.description.ilike(f"%{q}%")))
    rows = list(db.scalars(stmt.order_by(Provider.name)))
    if service_type:
        rows = [p for p in rows if service_type in (p.service_types or [])]
    if language:
        rows = [p for p in rows if language.lower() in [lang.lower() for lang in p.languages or []]]
    return rows


def build_router() -> APIRouter:
    r = APIRouter(tags=["6.0 Referrals"])

    @r.get("/providers", response_model=list[ProviderOut], summary="6.1 Search Provider Directory")
    def providers(
        service_type: str | None = None,
        city: str | None = None,
        province: str | None = None,
        language: str | None = None,
        q: str | None = None,
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        return search_providers(db, service_type, city, province, language, q)

    @r.get("/providers/service-types", response_model=list[str])
    def service_types(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        return sorted({s for p in db.scalars(select(Provider)) for s in (p.service_types or [])})

    @r.get("/referrals", response_model=list[ReferralOut], summary="6.6 View Referral History")
    def list_referrals(
        life_event_id: str | None = None,
        status: str | None = None,
        open_only: bool = False,
        user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        stmt = select(Referral).where(Referral.user_id == user.id)
        if life_event_id:
            stmt = stmt.where(Referral.life_event_id == life_event_id)
        if status:
            stmt = stmt.where(Referral.status == status)
        if open_only:
            stmt = stmt.where(Referral.status.not_in(["completed", "cancelled", "declined"]))
        return [referral_out(db, ref) for ref in db.scalars(stmt.order_by(Referral.created_at.desc()))]

    @r.post("/referrals", response_model=ReferralOut, status_code=201, summary="6.2 Create Referral")
    def create(body: ReferralIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        return referral_out(db, create_referral(db, user.id, body), with_history=True)

    @r.get("/referrals/{ref_id}", response_model=ReferralOut)
    def read(ref_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        return referral_out(db, get_owned(db, Referral, ref_id, user.id), with_history=True)

    @r.post("/referrals/{ref_id}/status", response_model=ReferralOut, summary="6.4 Update Referral Status")
    def status(ref_id: str, body: StatusIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        ref = change_status(db, get_owned(db, Referral, ref_id, user.id), body)
        return referral_out(db, ref, with_history=True)

    @r.patch(
        "/referrals/{ref_id}", response_model=ReferralOut, summary="6.3 Assign Next Owner / 6.5 Schedule Follow-ups"
    )
    def update(ref_id: str, body: ReferralPatch, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        ref = get_owned(db, Referral, ref_id, user.id)
        for k, v in body.model_dump(exclude_unset=True).items():
            setattr(ref, k, v)
        events.bus.publish(db, events.REFERRAL_SAVED, {"referral": ref})
        return referral_out(db, ref, with_history=True)

    @r.delete("/referrals/{ref_id}", status_code=204)
    def delete(ref_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        db.delete(get_owned(db, Referral, ref_id, user.id))

    return r


class ReferralsPlugin(Plugin):
    name = "referrals"
    feature_id = "6.0"
    title = "Referral & Handoff Management"
    functions = {
        "6.1": "Search Provider Directory",
        "6.2": "Create Referral",
        "6.3": "Assign Next Owner",
        "6.4": "Update Referral Status",
        "6.5": "Schedule Follow-ups",
        "6.6": "View Referral History",
    }

    def build_router(self):
        return build_router()

    def seed(self, db, ctx):
        if db.scalar(select(func.count()).select_from(Provider)):
            return
        data = yaml.safe_load((Path(__file__).parent / "providers.yaml").read_text())
        for row in data:
            db.add(Provider(is_sample=True, **row))

    def propose_impact(self, db, life_event, old_date, new_date):
        open_refs = db.scalars(
            select(Referral).where(
                Referral.life_event_id == life_event.id,
                Referral.status.in_(["requested", "accepted", "scheduled"]),
            )
        ).all()
        delta = new_date - old_date
        items = []
        for ref in open_refs:
            current = ref.follow_up_date
            items.append(
                ImpactItem(
                    plugin=self.name,
                    kind="referral",
                    ref_id=ref.id,
                    category="referral",
                    action="review",
                    title=f"Referral to {ref.recipient_name}",
                    reason=(
                        "Tell the provider about the new date. "
                        "The referral stays pending until you record their response."
                    ),
                    current_value=current.isoformat() if current else None,
                    proposed_value=(current + delta).isoformat() if current else None,
                    requires_external_confirmation=True,
                )
            )
        return items

    def apply_impact(self, db, life_event, items, delta_days):
        for item in items:
            ref = db.get(Referral, item.ref_id)
            if ref is None or ref.user_id != life_event.user_id:
                continue
            if item.proposed_value:
                ref.follow_up_date = date.fromisoformat(item.proposed_value)
            ref.next_owner = "me"
            db.add(
                ReferralUpdate(
                    referral_id=ref.id,
                    user_id=ref.user_id,
                    status=ref.status,
                    note=f"Key date moved {delta_days:+d} days - confirm with provider",
                    by="system",
                )
            )
            events.bus.publish(db, events.REFERRAL_SAVED, {"referral": ref})

    def export_user_data(self, db, user_id):
        refs = db.scalars(select(Referral).where(Referral.user_id == user_id))
        return {"referrals": [referral_out(db, r, with_history=True).model_dump(mode="json") for r in refs]}

    def delete_user_data(self, db, user_id):
        delete_rows(db, user_id, ReferralUpdate, Referral)


plugin = ReferralsPlugin()
