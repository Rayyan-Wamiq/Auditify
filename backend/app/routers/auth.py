"""
Authentication endpoints: signup, login, token refresh, and current-user lookup.

Token strategy
--------------
* ``access_token``  - short-lived (``ACCESS_TOKEN_EXPIRE_MINUTES``), sent as
  ``Authorization: Bearer <token>`` on every API call.
* ``refresh_token`` - long-lived (``REFRESH_TOKEN_EXPIRE_DAYS``), only ever
  exchanged at ``/api/auth/refresh`` for a new pair.

Both are stateless HS256 JWTs carrying a ``type`` claim, so a refresh token
cannot be replayed as an access token.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.database import get_db
from app.core.security import (
    ACCESS_TOKEN_TYPE,
    REFRESH_TOKEN_TYPE,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models import User
from app.schemas import (
    LoginRequest,
    RefreshRequest,
    SignupRequest,
    TokenResponse,
    UserOut,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
settings = get_settings()

# auto_error=False so a missing/malformed header produces our own 401 with the
# correct WWW-Authenticate challenge instead of FastAPI's default 403.
bearer_scheme = HTTPBearer(auto_error=False, description="JWT access token")


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    """FastAPI dependency that resolves a bearer access token to a ``User``.

    Reusable via ``Depends(get_current_user)`` to protect any other endpoint.
    """
    if credentials is None or not credentials.credentials:
        raise _unauthorized("Not authenticated.")

    try:
        claims = decode_token(credentials.credentials, expected_type=ACCESS_TOKEN_TYPE)
    except ValueError as exc:
        raise _unauthorized(str(exc)) from exc

    user = db.query(User).filter(User.id == claims["sub"]).first()
    if user is None:
        raise _unauthorized("User no longer exists.")
    return user


def _build_token_response(user: User) -> TokenResponse:
    """Mint a fresh access + refresh pair for ``user``."""
    return TokenResponse(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
        token_type="bearer",
        expires_in=settings.access_token_expire_seconds,
        user=UserOut.model_validate(user),
    )


@router.post(
    "/signup",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user and issue tokens",
)
def signup(payload: SignupRequest, db: Session = Depends(get_db)) -> TokenResponse:
    """Create the account (bcrypt-hashed password) and log the user straight in."""
    if db.query(User).filter(User.email == payload.email).first() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )

    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        full_name=(payload.full_name or "").strip() or None,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # Two concurrent signups for the same address: the unique index wins.
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists.",
        )
    db.refresh(user)

    return _build_token_response(user)


@router.post("/login", response_model=TokenResponse, summary="Log in with email + password")
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.query(User).filter(User.email == payload.email).first()

    # One message for both failure modes so the endpoint can't be used to
    # enumerate which emails are registered.
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise _unauthorized("Incorrect email or password.")

    return _build_token_response(user)


@router.post(
    "/refresh",
    response_model=TokenResponse,
    summary="Exchange a refresh token for a new token pair",
)
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)) -> TokenResponse:
    try:
        claims = decode_token(payload.refresh_token, expected_type=REFRESH_TOKEN_TYPE)
    except ValueError as exc:
        raise _unauthorized(str(exc)) from exc

    user = db.query(User).filter(User.id == claims["sub"]).first()
    if user is None:
        raise _unauthorized("User no longer exists.")

    # Refresh tokens are rotated (single-use), so a stolen token stops working
    # as soon as the legitimate client refreshes.
    return _build_token_response(user)


@router.get("/me", response_model=UserOut, summary="Current authenticated user")
def me(current_user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(current_user)