"""1.0 Newcomer Profile Hub - details entered once and reused by every plan."""

from datetime import date
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core import events
from ...core.db import get_db
from ...core.deps import get_current_user, get_owned
from ...core.models import User
from ...core.plugin import Plugin
from ...core.util import apply_patch, delete_rows, dump_rows
from .models import Document, HouseholdMember, Profile

IMMIGRATION_STATUSES = [
    "permanent_resident",
    "protected_person",
    "work_permit",
    "study_permit",
    "visitor",
    "citizen",
    "other",
]
DOCUMENT_TYPES = [
    "passport",
    "pr_card",
    "copr",
    "work_permit",
    "study_permit",
    "sin_confirmation",
    "health_card",
    "drivers_licence",
    "insurance_policy",
    "lease",
    "other",
]


class ProfileIn(BaseModel):
    immigration_status: str | None = None
    arrival_date: date | None = None
    country_of_origin: str | None = None
    preferred_language: str | None = None
    phone: str | None = None
    contact_email: str | None = None
    address_line: str | None = None
    city: str | None = None
    province: str | None = Field(default=None, max_length=2)
    postal_code: str | None = None
    employment_status: str | None = None
    has_vehicle: bool | None = None

    @field_validator("immigration_status")
    @classmethod
    def _status(cls, v):
        if v is not None and v not in IMMIGRATION_STATUSES:
            raise ValueError(f"must be one of {IMMIGRATION_STATUSES}")
        return v


class ProfileOut(BaseModel):
    immigration_status: str
    arrival_date: date | None
    country_of_origin: str
    preferred_language: str
    phone: str
    contact_email: str
    address_line: str
    city: str
    province: str
    postal_code: str
    employment_status: str
    has_vehicle: bool

    model_config = {"from_attributes": True}


class MemberIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    relationship: str = Field(pattern="^(spouse|partner|child|parent|sibling|other)$")
    date_of_birth: date | None = None
    notes: str = ""


class MemberPatch(BaseModel):
    full_name: str | None = None
    relationship: str | None = Field(default=None, pattern="^(spouse|partner|child|parent|sibling|other)$")
    date_of_birth: date | None = None
    notes: str | None = None


class MemberOut(MemberIn):
    id: str
    model_config = {"from_attributes": True}


class DocumentIn(BaseModel):
    doc_type: str
    label: str = ""
    issuer: str = ""
    member_id: str | None = None
    # Accepted only so the last 4 characters can be kept; the rest is discarded.
    number: str | None = Field(default=None, max_length=64)
    issued_on: date | None = None
    expires_on: date | None = None
    notes: str = ""

    @field_validator("doc_type")
    @classmethod
    def _type(cls, v):
        if v not in DOCUMENT_TYPES:
            raise ValueError(f"must be one of {DOCUMENT_TYPES}")
        return v


class DocumentPatch(BaseModel):
    label: str | None = None
    issuer: str | None = None
    member_id: str | None = None
    number: str | None = Field(default=None, max_length=64)
    issued_on: date | None = None
    expires_on: date | None = None
    notes: str | None = None


class DocumentOut(BaseModel):
    id: str
    doc_type: str
    label: str
    issuer: str
    member_id: str | None
    number_masked: str
    issued_on: date | None
    expires_on: date | None
    days_until_expiry: int | None
    notes: str

    @classmethod
    def of(cls, d: Document) -> "DocumentOut":
        return cls(
            id=d.id,
            doc_type=d.doc_type,
            label=d.label or d.doc_type.replace("_", " ").title(),
            issuer=d.issuer,
            member_id=d.member_id,
            number_masked=f"•••• {d.number_last4}" if d.number_last4 else "",
            issued_on=d.issued_on,
            expires_on=d.expires_on,
            days_until_expiry=(d.expires_on - date.today()).days if d.expires_on else None,
            notes=d.notes,
        )


def get_or_create_profile(db: Session, user: User) -> Profile:
    profile = db.scalar(select(Profile).where(Profile.user_id == user.id))
    if profile is None:
        profile = Profile(user_id=user.id, contact_email=user.email)
        db.add(profile)
        db.flush()
    return profile


def planning_context(db: Session, user_id: str) -> dict[str, Any]:
    """Facts that plan templates can use in their ``when`` conditions."""
    profile = db.scalar(select(Profile).where(Profile.user_id == user_id))
    members = db.scalars(select(HouseholdMember).where(HouseholdMember.user_id == user_id)).all()
    return {
        "immigration_status": profile.immigration_status if profile else None,
        "province": profile.province if profile else None,
        "city": profile.city if profile else None,
        "has_vehicle": bool(profile and profile.has_vehicle),
        "has_household": bool(members),
        "has_children": any(m.relationship == "child" for m in members),
        "has_spouse": any(m.relationship in ("spouse", "partner") for m in members),
        "household_size": 1 + len(members),
        "arrival_date": profile.arrival_date.isoformat() if profile and profile.arrival_date else None,
    }


def _check_member(db: Session, member_id: str | None, user_id: str) -> None:
    if member_id:
        get_owned(db, HouseholdMember, member_id, user_id, "Household member")


def build_router() -> APIRouter:
    r = APIRouter(prefix="/profile", tags=["1.0 Profile"])

    @r.get("", response_model=ProfileOut)
    def read(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        return get_or_create_profile(db, user)

    @r.put("", response_model=ProfileOut, summary="1.1 Create Profile / 1.2 Manage Profile")
    def upsert(body: ProfileIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        profile = get_or_create_profile(db, user)
        before = ProfileOut.model_validate(profile).model_dump()
        apply_patch(profile, body)
        after = ProfileOut.model_validate(profile).model_dump()
        changed = [k for k in after if after[k] != before[k]]
        if changed:
            events.bus.publish(db, events.PROFILE_UPDATED, {"user_id": user.id, "changed": changed})
        return profile

    @r.get("/options")
    def options():
        return {"immigration_statuses": IMMIGRATION_STATUSES, "document_types": DOCUMENT_TYPES}

    # --- 1.3 Household ------------------------------------------------------------
    @r.get("/household", response_model=list[MemberOut])
    def list_members(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        return db.scalars(select(HouseholdMember).where(HouseholdMember.user_id == user.id)).all()

    @r.post("/household", response_model=MemberOut, status_code=201, summary="1.3 Add Household Members")
    def add_member(body: MemberIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        member = HouseholdMember(user_id=user.id, **body.model_dump())
        db.add(member)
        db.flush()
        return member

    @r.patch("/household/{member_id}", response_model=MemberOut)
    def edit_member(
        member_id: str, body: MemberPatch, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ):
        return apply_patch(get_owned(db, HouseholdMember, member_id, user.id, "Household member"), body)

    @r.delete("/household/{member_id}", status_code=204)
    def remove_member(member_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        db.delete(get_owned(db, HouseholdMember, member_id, user.id, "Household member"))

    # --- 1.4 Documents ------------------------------------------------------------
    @r.get("/documents", response_model=list[DocumentOut])
    def list_documents(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        docs = db.scalars(select(Document).where(Document.user_id == user.id).order_by(Document.expires_on)).all()
        return [DocumentOut.of(d) for d in docs]

    @r.post("/documents", response_model=DocumentOut, status_code=201, summary="1.4 Manage Documents")
    def add_document(body: DocumentIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        _check_member(db, body.member_id, user.id)
        data = body.model_dump(exclude={"number"})
        doc = Document(user_id=user.id, number_last4=_last4(body.number), **data)
        db.add(doc)
        db.flush()
        events.bus.publish(db, events.DOCUMENT_SAVED, {"document": doc})
        return DocumentOut.of(doc)

    @r.patch("/documents/{doc_id}", response_model=DocumentOut)
    def edit_document(
        doc_id: str, body: DocumentPatch, user: User = Depends(get_current_user), db: Session = Depends(get_db)
    ):
        doc = get_owned(db, Document, doc_id, user.id)
        _check_member(db, body.member_id, user.id)
        fields = body.model_dump(exclude_unset=True)
        if "number" in fields:
            doc.number_last4 = _last4(fields.pop("number"))
        for k, v in fields.items():
            setattr(doc, k, v)
        events.bus.publish(db, events.DOCUMENT_SAVED, {"document": doc})
        return DocumentOut.of(doc)

    @r.delete("/documents/{doc_id}", status_code=204)
    def remove_document(doc_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        doc = get_owned(db, Document, doc_id, user.id)
        events.bus.publish(db, events.DOCUMENT_DELETED, {"document": doc})
        db.delete(doc)

    return r


def _last4(number: str | None) -> str:
    if not number:
        return ""
    cleaned = "".join(ch for ch in number if ch.isalnum())
    return cleaned[-4:]


class ProfilePlugin(Plugin):
    name = "profile"
    feature_id = "1.0"
    title = "Newcomer Profile Hub"
    functions = {
        "1.1": "Create Profile",
        "1.2": "Manage Profile",
        "1.3": "Add Household Members",
        "1.4": "Manage Documents",
    }

    def build_router(self):
        return build_router()

    def export_user_data(self, db, user_id):
        profile = db.scalar(select(Profile).where(Profile.user_id == user_id))
        docs = db.scalars(select(Document).where(Document.user_id == user_id)).all()
        return {
            "profile": ProfileOut.model_validate(profile).model_dump(mode="json") if profile else None,
            "household": dump_rows(db, HouseholdMember, MemberOut, user_id),
            "documents": [DocumentOut.of(d).model_dump(mode="json") for d in docs],
        }

    def delete_user_data(self, db, user_id):
        delete_rows(db, user_id, Document, HouseholdMember, Profile)


plugin = ProfilePlugin()
