"""8.0 Settlement Worker Portal (Enterprise phase).

Approved settlement workers support clients who give permission. Every read goes
through the consent plugin, so a worker only ever sees the fields a client shared,
and each access is written to the client's audit history.
"""

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import Date, ForeignKey, String, Text, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from ...core.db import Base, Entity, get_db
from ...core.deps import require_role
from ...core.models import User
from ...core.plugin import Plugin
from ..consent import service as consent
from ..consent.models import AccessRequest, SharingGrant
from ..consent.service import FIELD_CATALOGUE
from ..referrals import ReferralIn, ReferralOut, StatusIn, change_status, create_referral, referral_out
from ..referrals.models import Referral

worker_only = require_role("worker", "admin")


class FollowUpNote(Entity, Base):
    __tablename__ = "follow_up_notes"

    worker_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    note: Mapped[str] = mapped_column(Text)
    next_step: Mapped[str] = mapped_column(Text, default="")
    next_contact_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    contact_method: Mapped[str] = mapped_column(String(20), default="phone")


class AccessRequestIn(BaseModel):
    client_email: EmailStr
    fields: list[str]
    purpose: str = Field(min_length=3)
    duration_days: int = Field(default=90, ge=1, le=365)


class NoteIn(BaseModel):
    note: str = Field(min_length=1)
    next_step: str = ""
    next_contact_date: date | None = None
    contact_method: str = Field(default="phone", pattern="^(phone|email|in_person|video|other)$")


class NoteOut(NoteIn):
    id: str
    created_at: datetime
    model_config = {"from_attributes": True}


class ClientSummary(BaseModel):
    client_id: str
    name: str
    grant_id: str
    fields: list[str]
    purpose: str
    expires_at: datetime
    open_tasks: int | None = None
    overdue_tasks: int | None = None
    open_referrals: int | None = None


def _label(worker: User) -> str:
    return worker.full_name or worker.email


def build_router() -> APIRouter:
    r = APIRouter(prefix="/worker", tags=["8.0 Settlement Worker Portal"])

    @r.post("/access-requests", status_code=201, summary="8.1 Request Client Access")
    def request_access(body: AccessRequestIn, worker: User = Depends(worker_only), db: Session = Depends(get_db)):
        unknown = [f for f in body.fields if f not in FIELD_CATALOGUE]
        if unknown or not body.fields:
            raise HTTPException(422, f"Choose fields from {list(FIELD_CATALOGUE)}")
        client = db.scalar(select(User).where(User.email == body.client_email.lower()))
        # Same response whether or not the email has an account, to avoid revealing who uses SettleWise.
        if client and client.id != worker.id:
            db.add(
                AccessRequest(
                    user_id=client.id,
                    requester_user_id=worker.id,
                    requester_name=_label(worker),
                    requester_type="advisor",
                    fields=sorted(set(body.fields)),
                    purpose=body.purpose,
                    duration_days=body.duration_days,
                )
            )
        return {"status": "If this person uses SettleWise, they will see your request."}

    @r.get("/clients", response_model=list[ClientSummary], summary="8.2 View Client Dashboard")
    def clients(worker: User = Depends(worker_only), db: Session = Depends(get_db)):
        from ..tasks import service as task_service

        out = []
        grants = db.scalars(select(SharingGrant).where(SharingGrant.recipient_user_id == worker.id))
        for g in grants:
            if not consent.is_active(g):
                continue
            client = db.get(User, g.user_id)
            row = ClientSummary(
                client_id=g.user_id,
                name=client.full_name or "Client",
                grant_id=g.id,
                fields=g.fields,
                purpose=g.purpose,
                expires_at=g.expires_at,
            )
            if "tasks" in g.fields:
                open_tasks = task_service.search(db, g.user_id, status="open")
                row.open_tasks = len(open_tasks)
                row.overdue_tasks = sum(1 for t in open_tasks if t.due_date and t.due_date < date.today())
            if "referrals" in g.fields:
                row.open_referrals = len(
                    db.scalars(
                        select(Referral).where(
                            Referral.user_id == g.user_id, Referral.status.in_(["requested", "accepted", "scheduled"])
                        )
                    ).all()
                )
            out.append(row)
        return out

    @r.get("/clients/{client_id}", summary="8.3 Monitor Client Progress")
    def client_detail(client_id: str, worker: User = Depends(worker_only), db: Session = Depends(get_db)):
        grant = consent.active_grant(db, client_id, worker.id)
        if grant is None:
            raise HTTPException(403, "This client has not shared their information with you, or access has expired")
        return consent.shared_view(db, client_id, worker, grant, purpose="worker portal: monitor progress")

    @r.post(
        "/clients/{client_id}/referrals",
        response_model=ReferralOut,
        status_code=201,
        summary="8.4 Manage Client Referrals",
    )
    def client_referral(
        client_id: str, body: ReferralIn, worker: User = Depends(worker_only), db: Session = Depends(get_db)
    ):
        consent.require_fields(db, client_id, worker, ["referrals"])
        ref = create_referral(db, client_id, body, by=f"worker:{_label(worker)}")
        consent.audit(
            db,
            client_id,
            "referral_created",
            _label(worker),
            actor_user_id=worker.id,
            resource=f"referral:{ref.id}",
            fields=["referrals"],
            detail=f"Referral to {ref.recipient_name}",
        )
        return referral_out(db, ref, with_history=True)

    @r.post("/clients/{client_id}/referrals/{ref_id}/status", response_model=ReferralOut)
    def client_referral_status(
        client_id: str, ref_id: str, body: StatusIn, worker: User = Depends(worker_only), db: Session = Depends(get_db)
    ):
        consent.require_fields(db, client_id, worker, ["referrals"])
        ref = db.get(Referral, ref_id)
        if ref is None or ref.user_id != client_id:
            raise HTTPException(404, "Referral not found")
        change_status(db, ref, body, by=f"worker:{_label(worker)}")
        consent.audit(
            db,
            client_id,
            "referral_updated",
            _label(worker),
            actor_user_id=worker.id,
            resource=f"referral:{ref.id}",
            fields=["referrals"],
            detail=f"Status set to {body.status}",
        )
        return referral_out(db, ref, with_history=True)

    @r.get("/clients/{client_id}/notes", response_model=list[NoteOut])
    def notes(client_id: str, worker: User = Depends(worker_only), db: Session = Depends(get_db)):
        if consent.active_grant(db, client_id, worker.id) is None:
            raise HTTPException(403, "Access has ended")
        return db.scalars(
            select(FollowUpNote)
            .where(FollowUpNote.worker_id == worker.id, FollowUpNote.client_id == client_id)
            .order_by(FollowUpNote.created_at.desc())
        ).all()

    @r.post("/clients/{client_id}/notes", response_model=NoteOut, status_code=201, summary="8.5 Record Follow-up Notes")
    def add_note(client_id: str, body: NoteIn, worker: User = Depends(worker_only), db: Session = Depends(get_db)):
        if consent.active_grant(db, client_id, worker.id) is None:
            raise HTTPException(403, "Access has ended")
        note = FollowUpNote(worker_id=worker.id, client_id=client_id, **body.model_dump())
        db.add(note)
        db.flush()
        consent.audit(
            db,
            client_id,
            "follow_up_logged",
            _label(worker),
            actor_user_id=worker.id,
            resource=f"note:{note.id}",
            detail=body.next_step or "Follow-up recorded",
        )
        return note

    return r


class WorkerPortalPlugin(Plugin):
    name = "worker_portal"
    feature_id = "8.0"
    title = "Settlement Worker Portal"
    phase = "Enterprise"
    requires = ("consent", "referrals", "tasks")
    functions = {
        "8.1": "Request Client Access",
        "8.2": "View Client Dashboard",
        "8.3": "Monitor Client Progress",
        "8.4": "Manage Client Referrals",
        "8.5": "Record Follow-up Notes",
    }

    def build_router(self):
        return build_router()

    def delete_user_data(self, db, user_id):
        from sqlalchemy import delete, or_

        db.execute(
            delete(FollowUpNote).where(or_(FollowUpNote.worker_id == user_id, FollowUpNote.client_id == user_id))
        )


plugin = WorkerPortalPlugin()
