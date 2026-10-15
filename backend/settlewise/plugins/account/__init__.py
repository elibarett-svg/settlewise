"""10.0 Account Administration."""

import logging
import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.config import get_settings
from ...core.db import get_db
from ...core.deps import get_current_user
from ...core.models import User
from ...core.plugin import Plugin, registry
from ...core.security import (
    create_access_token,
    hash_password,
    hash_token,
    new_totp_secret,
    totp_uri,
    verify_password,
    verify_totp,
)

log = logging.getLogger("settlewise.account")

LANGUAGES = {"en": "English", "fr": "Français"}


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(default="", max_length=200)
    display_language: str = "en"


class LoginIn(BaseModel):
    email: EmailStr
    password: str
    totp_code: str | None = None


class UserOut(BaseModel):
    id: str
    email: str
    full_name: str
    role: str
    display_language: str
    totp_enabled: bool

    model_config = {"from_attributes": True}


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserPatch(BaseModel):
    full_name: str | None = Field(default=None, max_length=200)
    display_language: str | None = None


class CodeIn(BaseModel):
    code: str


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class ResetRequestIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    token: str
    new_password: str = Field(min_length=8, max_length=128)


class DeleteIn(BaseModel):
    password: str


def _token(user: User) -> TokenOut:
    return TokenOut(
        access_token=create_access_token(user.id, user.token_version),
        user=UserOut.model_validate(user),
    )


def _check_language(code: str) -> str:
    if code not in LANGUAGES:
        raise HTTPException(422, f"Unsupported language. Choose one of: {', '.join(LANGUAGES)}")
    return code


def build_router() -> APIRouter:
    r = APIRouter(tags=["10.0 Account"])

    @r.post("/auth/register", response_model=TokenOut, status_code=201)
    def register(body: RegisterIn, db: Session = Depends(get_db)):
        email = body.email.lower()
        if db.scalar(select(User).where(User.email == email)):
            raise HTTPException(409, "An account with this email already exists")
        user = User(
            email=email,
            full_name=body.full_name,
            password_hash=hash_password(body.password),
            display_language=_check_language(body.display_language),
        )
        db.add(user)
        db.flush()
        return _token(user)

    @r.post("/auth/login", response_model=TokenOut, summary="10.1 Manage Login")
    def login(body: LoginIn, db: Session = Depends(get_db)):
        user = db.scalar(select(User).where(User.email == body.email.lower()))
        if user is None or not verify_password(body.password, user.password_hash):
            raise HTTPException(401, "Email or password is incorrect")
        if user.totp_enabled:
            if not body.totp_code:
                raise HTTPException(401, "totp_required")
            if not verify_totp(user.totp_secret or "", body.totp_code):
                raise HTTPException(401, "Verification code is incorrect")
        return _token(user)

    @r.post("/auth/logout-all", status_code=204, summary="Sign out on every device")
    def logout_all(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        user.token_version += 1

    @r.post("/auth/2fa/setup")
    def totp_setup(user: User = Depends(get_current_user)):
        if user.totp_enabled:
            raise HTTPException(409, "Two-step verification is already on")
        user.totp_secret = new_totp_secret()
        return {"secret": user.totp_secret, "otpauth_url": totp_uri(user.totp_secret, user.email)}

    @r.post("/auth/2fa/enable", response_model=UserOut)
    def totp_enable(body: CodeIn, user: User = Depends(get_current_user)):
        if not user.totp_secret or not verify_totp(user.totp_secret, body.code):
            raise HTTPException(400, "Verification code is incorrect")
        user.totp_enabled = True
        return user

    @r.post("/auth/2fa/disable", response_model=UserOut)
    def totp_disable(body: CodeIn, user: User = Depends(get_current_user)):
        if not user.totp_enabled or not verify_totp(user.totp_secret or "", body.code):
            raise HTTPException(400, "Verification code is incorrect")
        user.totp_enabled = False
        user.totp_secret = None
        return user

    @r.post("/auth/password/change", response_model=TokenOut, summary="10.2 Manage Password")
    def change_password(body: PasswordChangeIn, user: User = Depends(get_current_user)):
        if not verify_password(body.current_password, user.password_hash):
            raise HTTPException(400, "Current password is incorrect")
        user.password_hash = hash_password(body.new_password)
        user.token_version += 1  # other devices must sign in again
        return _token(user)

    @r.post("/auth/password/reset-request", status_code=202)
    def reset_request(body: ResetRequestIn, db: Session = Depends(get_db)):
        user = db.scalar(select(User).where(User.email == body.email.lower()))
        out: dict = {"status": "If the account exists, a reset link has been sent."}
        if user:
            token = secrets.token_urlsafe(24)
            user.reset_token_hash = hash_token(token)
            # TODO: send by email once a mail provider is configured.
            log.info("Password reset token issued for %s", user.id)
            if get_settings().is_dev:
                out["dev_token"] = token
        return out

    @r.post("/auth/password/reset", status_code=204)
    def reset(body: ResetIn, db: Session = Depends(get_db)):
        user = db.scalar(select(User).where(User.reset_token_hash == hash_token(body.token)))
        if user is None:
            raise HTTPException(400, "Reset link is invalid or has expired")
        user.password_hash = hash_password(body.new_password)
        user.reset_token_hash = None
        user.token_version += 1

    @r.get("/account/me", response_model=UserOut)
    def me(user: User = Depends(get_current_user)):
        return user

    @r.patch("/account/me", response_model=UserOut, summary="10.3 Set Display Language")
    def update_me(body: UserPatch, user: User = Depends(get_current_user)):
        if body.full_name is not None:
            user.full_name = body.full_name
        if body.display_language is not None:
            user.display_language = _check_language(body.display_language)
        return user

    @r.get("/account/languages")
    def languages():
        return LANGUAGES

    @r.get("/account/export", summary="10.4 Export Account Data")
    def export(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        data: dict = {"account": UserOut.model_validate(user).model_dump()}
        for plugin in registry.all():
            part = plugin.export_user_data(db, user.id)
            if part:
                data[plugin.name] = part
        return data

    @r.post("/account/delete", status_code=204, summary="10.5 Delete Account")
    def delete(body: DeleteIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
        if not verify_password(body.password, user.password_hash):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Password is incorrect")
        for plugin in reversed(registry.all()):
            plugin.delete_user_data(db, user.id)
        db.delete(user)

    return r


class AccountPlugin(Plugin):
    name = "account"
    feature_id = "10.0"
    title = "Account Administration"
    functions = {
        "10.1": "Manage Login",
        "10.2": "Manage Password",
        "10.3": "Set Display Language",
        "10.4": "Export Account Data",
        "10.5": "Delete Account",
    }

    def build_router(self):
        return build_router()


plugin = AccountPlugin()
