"""Password hashing (scrypt), JWT access tokens and RFC 6238 TOTP - stdlib + PyJWT only."""

import base64
import hashlib
import hmac
import secrets
import struct
import time
from datetime import timedelta
from urllib.parse import quote

import jwt

from .config import get_settings
from .db import utcnow

_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 64}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), **_SCRYPT)
    return hmac.compare_digest(digest.hex(), digest_hex)


def create_access_token(user_id: str, token_version: int) -> str:
    settings = get_settings()
    now = utcnow()
    payload = {
        "sub": user_id,
        "ver": token_version,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.access_token_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, get_settings().secret_key, algorithms=["HS256"])


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# --- TOTP (two-step verification, 10.1) -------------------------------------------------


def new_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _hotp(secret: str, counter: int, digits: int = 6) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    mac = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = mac[-1] & 0x0F
    code = (struct.unpack(">I", mac[offset : offset + 4])[0] & 0x7FFFFFFF) % 10**digits
    return str(code).zfill(digits)


def totp_code(secret: str, at: float | None = None, step: int = 30) -> str:
    return _hotp(secret, int((at or time.time()) // step))


def verify_totp(secret: str, code: str, window: int = 1, step: int = 30) -> bool:
    now = int(time.time() // step)
    code = (code or "").strip().replace(" ", "")
    return any(hmac.compare_digest(_hotp(secret, now + d), code) for d in range(-window, window + 1))


def totp_uri(secret: str, email: str, issuer: str = "SettleWise") -> str:
    return f"otpauth://totp/{quote(issuer)}:{quote(email)}?secret={secret}&issuer={quote(issuer)}"
