from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .db import get_db
from .models import User
from .security import decode_access_token

bearer = HTTPBearer(auto_error=False)


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    unauthorized = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    if creds is None:
        raise unauthorized
    try:
        payload = decode_access_token(creds.credentials)
    except Exception as exc:
        raise unauthorized from exc
    user = db.get(User, payload.get("sub"))
    if user is None or user.token_version != payload.get("ver"):
        raise unauthorized
    return user


def require_role(*roles: str):
    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not permitted for this account type")
        return user

    return checker


def get_owned(db: Session, model, obj_id: str, user_id: str, label: str | None = None):
    """Fetch a row that must belong to the user, or 404 (never leak other users' ids)."""
    obj = db.get(model, obj_id)
    if obj is None or getattr(obj, "user_id", None) != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{label or model.__name__} not found")
    return obj
