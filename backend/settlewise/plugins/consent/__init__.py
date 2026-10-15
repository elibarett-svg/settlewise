"""7.0 Consent & Privacy Center - users decide who sees what, why and for how long."""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.db import get_db, utcnow
from ...core.deps import get_current_user, get_owned
from ...core.models import User
from ...core.plugin import Plugin
from ...core.util import delete_rows
from . import service
from .models import AccessRequest, AuditEntry, SharingGrant
from .service import FIELD_CATALOGUE


def _check_fields(fields: list[str]) -> list[str]:
    unknown = [f for f in fields if f not in FIELD_CATALOGUE]
    if unknown:
        raise ValueError(f"unknown fields: {unknown}")
    if not fields:
        raise ValueError("choose at least one field")
    return sorted(set(fields))


class GrantIn(BaseModel):
    recipient_type: str = Field(pattern="^(advisor|provider|household|other)$")
    recipient_name: str = Field(min_length=1, max_length=200)
    recipient_email: EmailStr | None = None
    fields: list[str]
    purpose: str = Field(min_length=3)
    duration_days: int = Field(default=30, ge=1, le=365)

    @field_validator("fields")
    @classmethod
    def _valid_fields(cls, v):
        return _check_fields(v)


class GrantPatch(BaseModel):
    fields: list[str] | None = None
    purpose: str | None = None
    duration_days: int | None = Field(default=None, ge=1, le=365)


class GrantOut(BaseModel):
    id: str
    recipient_type: str
    recipient_name: str
    recipient_email: str
    fields: list[str]
    purpose: str
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    status: str
    recipient_has_account: bool


class AuditOut(BaseModel):
    id: str
    actor_label: str
    action: str
    resource: str
    fields: list[str]
    detail: str
    created_at: datetime
    model_config = {"from_attributes": True}


class RequestOut(BaseModel):
    id: str
    requester_name: str
    requester_type: str
    fields: list[str]
    purpose: str
    duration_days: int
    status: str
    created_at: datetime
    model_config = {"from_attributes": True}


class ApproveIn(BaseModel):
    fields: list[str] | None = None  # approve a subset
    duration_days: int | None = Field(default=None, ge=1, le=365)


def grant_out(g: SharingGrant) -> GrantOut:
    return GrantOut(
        id=g.id,
        recipient_type=g.recipient_type,
        recipient_name=g.recipient_name,
        recipient_email=g.recipient_email,
        fields=g.fields,
        purpose=g.purpose,
        created_at=g.created_at,
        expires_at=g.expires_at,
        revoked_at=g.revoked_at,
        status=service.grant_status(g),
        recipient_has_account=g.recipient_user_id is not None,
    )


def create_grant(
    db: Session,
    owner: User,
    *,
    recipient_type: str,
    recipient_name: str,
    recipient_email: str,
    fields: list[str],
    purpose: str,
    duration_days: int,
    recipient_user_id: str | None = None,
) -> SharingGrant:
    if recipient_user_id is None and recipient_email:
        recipient = db.scalar(select(User).where(User.email == recipient_email.lower()))
        recipient_user_id = recipient.id if recipient else None
    if recipient_user_id == owner.id:
        raise HTTPException(422, "You cannot share with yourself")
    grant = SharingGrant(
        user_id=owner.id,
        recipient_type=recipient_type,
        recipient_name=recipient_name,
        recipient_email=(recipient_email or "").lower(),
        recipient_user_id=recipient_user_id,
        fields=fields,
        purpose=purpose,
        expires_at=utcnow() + timedelta(days=duration_days),
    )
    db.add(grant)
    db.flush()
    service.audit(
        db,
        owner.id,
        "grant_created",
        "You",
        actor_user_id=owner.id,
        resource=f"grant:{grant.id}",
        fields=fields,
        detail=f"Shared with {recipient_name} for {duration_days} days: {purpose}",
    )
    return grant


def build_router() -> APIRouter:
    r = APIRouter(prefix="/consent", tags=["7.0 Consent & Privacy"])

    @r.get("/fields")
    def fields():
        return FIELD_CATALOGUE

    @r.get("/grants", response_model=list[GrantOut])
    def list_grants(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        rows = db.scalars(
            select(SharingGrant).where(SharingGrant.user_id == user.id).order_by(SharingGrant.created_at.desc())
        )
        return [grant_out(g) for g in rows]

    @r.post(
        "/grants",
        response_model=GrantOut,
        status_code=201,
        summary="7.1 Set Sharing Permissions + 7.2 Set Purpose and Duration",
    )
    def create(body: GrantIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        return grant_out(
            create_grant(
                db,
                user,
                recipient_type=body.recipient_type,
                recipient_name=body.recipient_name,
                recipient_email=body.recipient_email or "",
                fields=body.fields,
                purpose=body.purpose,
                duration_days=body.duration_days,
            )
        )

    @r.patch("/grants/{grant_id}", response_model=GrantOut)
    def update(grant_id: str, body: GrantPatch, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        grant = get_owned(db, SharingGrant, grant_id, user.id, "Sharing permission")
        if not service.is_active(grant):
            raise HTTPException(409, "This permission is no longer active - create a new one")
        changes = []
        if body.fields is not None:
            try:
                grant.fields = _check_fields(body.fields)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
            changes.append("fields")
        if body.purpose is not None:
            grant.purpose = body.purpose
            changes.append("purpose")
        if body.duration_days is not None:
            grant.expires_at = utcnow() + timedelta(days=body.duration_days)
            changes.append("expiry")
        service.audit(
            db,
            user.id,
            "grant_updated",
            "You",
            actor_user_id=user.id,
            resource=f"grant:{grant.id}",
            fields=grant.fields,
            detail=f"Changed {', '.join(changes)} for {grant.recipient_name}",
        )
        return grant_out(grant)

    @r.post("/grants/{grant_id}/revoke", response_model=GrantOut, summary="7.4 Revoke Access")
    def revoke(grant_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        grant = get_owned(db, SharingGrant, grant_id, user.id, "Sharing permission")
        if grant.revoked_at is None:
            grant.revoked_at = utcnow()
            service.audit(
                db,
                user.id,
                "grant_revoked",
                "You",
                actor_user_id=user.id,
                resource=f"grant:{grant.id}",
                fields=grant.fields,
                detail=f"Access withdrawn from {grant.recipient_name}",
            )
        return grant_out(grant)

    @r.get("/audit", response_model=list[AuditOut], summary="7.5 View Audit History")
    def audit_log(limit: int = 200, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        return db.scalars(
            select(AuditEntry).where(AuditEntry.user_id == user.id).order_by(AuditEntry.created_at.desc()).limit(limit)
        ).all()

    # --- 7.3 Approve Sharing Requests (populated by the worker portal / Growth connections)
    @r.get("/requests", response_model=list[RequestOut])
    def list_requests(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        return db.scalars(
            select(AccessRequest).where(AccessRequest.user_id == user.id).order_by(AccessRequest.created_at.desc())
        ).all()

    @r.post("/requests/{request_id}/approve", response_model=GrantOut, summary="7.3 Approve Sharing Requests")
    def approve(
        request_id: str, body: ApproveIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ):
        req = get_owned(db, AccessRequest, request_id, user.id, "Access request")
        if req.status != "pending":
            raise HTTPException(409, f"This request is already {req.status}")
        fields = body.fields if body.fields is not None else req.fields
        if not set(fields) <= set(req.fields) or not fields:
            raise HTTPException(422, "You can approve some or all of the requested fields, but not others")
        requester = db.get(User, req.requester_user_id)
        grant = create_grant(
            db,
            user,
            recipient_type=req.requester_type,
            recipient_name=req.requester_name,
            recipient_email=requester.email if requester else "",
            fields=sorted(fields),
            purpose=req.purpose,
            duration_days=body.duration_days or req.duration_days,
            recipient_user_id=req.requester_user_id,
        )
        req.status, req.grant_id = "approved", grant.id
        return grant_out(grant)

    @r.post("/requests/{request_id}/decline", response_model=RequestOut)
    def decline(request_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        req = get_owned(db, AccessRequest, request_id, user.id, "Access request")
        if req.status == "pending":
            req.status = "declined"
            service.audit(
                db,
                user.id,
                "request_declined",
                "You",
                actor_user_id=user.id,
                resource=f"request:{req.id}",
                fields=req.fields,
                detail=f"Declined {req.requester_name}",
            )
        return req

    # --- Recipient side: information other people shared with me -----------------
    @r.get("/shared-with-me", response_model=list[GrantOut])
    def shared_with_me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        rows = db.scalars(select(SharingGrant).where(SharingGrant.recipient_user_id == user.id))
        return [grant_out(g) for g in rows if service.is_active(g)]

    @r.get("/shared-with-me/{grant_id}")
    def view_shared(grant_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        grant = db.get(SharingGrant, grant_id)
        if grant is None or grant.recipient_user_id != user.id or not service.is_active(grant):
            raise HTTPException(404, "Shared information not found or access has ended")
        return service.shared_view(db, grant.user_id, user, grant)

    return r


class ConsentPlugin(Plugin):
    name = "consent"
    feature_id = "7.0"
    title = "Consent & Privacy Center"
    functions = {
        "7.1": "Set Sharing Permissions",
        "7.2": "Set Purpose and Duration",
        "7.3": "Approve Sharing Requests (Growth)",
        "7.4": "Revoke Access",
        "7.5": "View Audit History",
    }

    def build_router(self):
        return build_router()

    def export_user_data(self, db, user_id):
        grants = db.scalars(select(SharingGrant).where(SharingGrant.user_id == user_id))
        entries = db.scalars(select(AuditEntry).where(AuditEntry.user_id == user_id))
        return {
            "grants": [grant_out(g).model_dump(mode="json") for g in grants],
            "audit": [AuditOut.model_validate(e).model_dump(mode="json") for e in entries],
        }

    def delete_user_data(self, db, user_id):
        delete_rows(db, user_id, AccessRequest, SharingGrant, AuditEntry)


plugin = ConsentPlugin()
