"""
Password hashing and JWT access/refresh token helpers.

Passwords are hashed with bcrypt (via passlib's ``CryptContext``) and never
stored or logged in plaintext. Tokens are stateless HS256 JWTs carrying a
``sub`` (user id), a ``type`` claim (``access`` or ``refresh``) and standard
``iat``/``exp`` timestamps.
"""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import get_settings

settings = get_settings()

# bcrypt is deliberately slow (work factor) to resist brute-force attacks.
# Passlib's CryptContext also lets us transparently migrate to a stronger
# scheme later by listing it here.
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Token "type" claim values. Keeping access and refresh tokens distinguishable
# means a leaked refresh token cannot be replayed as an access token (and
# vice-versa) - see ``decode_token``.
ACCESS_TOKEN_TYPE = "access"
REFRESH_TOKEN_TYPE = "refresh"

# bcrypt only hashes the first 72 bytes of input; rejecting longer passwords
# avoids silently ignoring the tail of the user's password.
MAX_PASSWORD_BYTES = 72


def validate_password_length(password: str) -> None:
    """Raise ``ValueError`` if the password is unsuitable for bcrypt."""
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise ValueError(
            f"Password must be at most {MAX_PASSWORD_BYTES} bytes long "
            "(bcrypt ignores anything beyond that)."
        )


def hash_password(password: str) -> str:
    """Return the bcrypt hash of ``password``."""
    validate_password_length(password)
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Check ``plain_password`` against a stored hash (never raises)."""
    if not hashed_password:
        return False
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except (ValueError, TypeError):
        # Malformed/corrupt hash in the database -> treat as a failed login.
        return False


def _create_token(subject: str, token_type: str, expires_delta: timedelta) -> str:
    issued_at = datetime.now(timezone.utc)
    payload: Dict[str, Any] = {
        "sub": str(subject),
        "type": token_type,
        "iat": int(issued_at.timestamp()),
        "exp": int((issued_at + expires_delta).timestamp()),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_access_token(subject: str, expires_minutes: Optional[int] = None) -> str:
    """Short-lived token used to authorise API calls."""
    minutes = (
        expires_minutes
        if expires_minutes is not None
        else settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    return _create_token(subject, ACCESS_TOKEN_TYPE, timedelta(minutes=minutes))


def create_refresh_token(subject: str, expires_days: Optional[int] = None) -> str:
    """Long-lived token whose only job is to mint new access tokens."""
    days = (
        expires_days if expires_days is not None else settings.REFRESH_TOKEN_EXPIRE_DAYS
    )
    return _create_token(subject, REFRESH_TOKEN_TYPE, timedelta(days=days))


def decode_token(token: str, expected_type: Optional[str] = None) -> Dict[str, Any]:
    """Decode and validate a JWT.

    Raises ``ValueError`` when the token is malformed, expired, missing a
    subject, or has the wrong ``type`` claim.
    """
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
        )
    except JWTError as exc:
        raise ValueError(f"Invalid or expired token ({exc}).") from exc

    if expected_type is not None and payload.get("type") != expected_type:
        raise ValueError(f"Expected a {expected_type} token.")

    subject = payload.get("sub")
    if not subject:
        raise ValueError("Token is missing its subject.")

    return payload