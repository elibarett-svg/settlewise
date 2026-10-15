"""1.5 Auto-fill Supported Forms (Growth phase).

A supported partner form asks for profile values. Only fields the user has
already shared with that partner (7.1) are returned, and every use is audited.
Disabled until "Growth" is listed in SETTLEWISE_ENABLED_PHASES.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...core.db import get_db
from ...core.deps import get_current_user, get_owned
from ...core.models import User
from ...core.plugin import Plugin
from ..consent import service as consent
from ..consent.models import SharingGrant

# Supported form field -> (consent field that must be shared, value path in the shared view)
FORM_FIELDS = {
    "full_name": ("profile.contact", ("contact", "full_name")),
    "phone": ("profile.contact", ("contact", "phone")),
    "email": ("profile.contact", ("contact", "email")),
    "address_line": ("profile.address", ("address", "address_line")),
    "city": ("profile.address", ("address", "city")),
    "province": ("profile.address", ("address", "province")),
    "postal_code": ("profile.address", ("address", "postal_code")),
    "immigration_status": ("profile.status", ("status", "immigration_status")),
    "arrival_date": ("profile.status", ("status", "arrival_date")),
}


class AutofillIn(BaseModel):
    grant_id: str
    form_fields: list[str]


def build_router() -> APIRouter:
    r = APIRouter(prefix="/autofill", tags=["1.5 Auto-fill (Growth)"])

    @r.get("/fields")
    def fields():
        return {k: v[0] for k, v in FORM_FIELDS.items()}

    @r.post("/preview", summary="1.5 Auto-fill Supported Forms")
    def preview(body: AutofillIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        grant = get_owned(db, SharingGrant, body.grant_id, user.id, "Sharing permission")
        if not consent.is_active(grant):
            raise HTTPException(409, "This permission is no longer active")
        unknown = [f for f in body.form_fields if f not in FORM_FIELDS]
        if unknown:
            raise HTTPException(422, f"Unsupported form fields: {unknown}")
        needed = sorted({FORM_FIELDS[f][0] for f in body.form_fields} & set(grant.fields))
        view = consent.shared_view(db, user.id, user, grant, needed, purpose=f"auto-fill for {grant.recipient_name}")
        values, withheld = {}, []
        for f in body.form_fields:
            consent_field, (section, key) = FORM_FIELDS[f]
            if consent_field in grant.fields:
                values[f] = (view.get(section) or {}).get(key)
            else:
                withheld.append(f)
        return {"recipient": grant.recipient_name, "values": values, "withheld": withheld}

    return r


class AutofillPlugin(Plugin):
    name = "autofill"
    feature_id = "1.5"
    title = "Auto-fill Supported Forms"
    phase = "Growth"
    requires = ("profile", "consent")
    functions = {"1.5": "Auto-fill Supported Forms"}

    def build_router(self):
        return build_router()


plugin = AutofillPlugin()
