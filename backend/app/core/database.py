"""
SQLAlchemy engine, session factory, and declarative base.

This module is the single source of truth for database connectivity. The
application is **PostgreSQL-only** (Supabase in production, plain PostgreSQL
locally); SQLite is intentionally not supported.

Connection parameters (pool size, overflow, recycle, timeout) are read from
environment-backed settings so the pool can be tuned per deployment without
touching source code.
"""
from contextlib import contextmanager
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

settings = get_settings()

# Credentials must never reach the logs, so any message that echoes the URL
# goes through this redacted form (password rendered as ***).
_parsed_url = make_url(settings.DATABASE_URL)

# --- PostgreSQL-only enforcement ---------------------------------------------
# SQLite is explicitly rejected so a stray local file URL can never silently
# run the app against a throwaway database (the vector store and auth data
# would diverge from the real deployment).
if not _parsed_url.drivername.startswith("postgresql"):
    raise RuntimeError(
        f"Unsupported DATABASE_URL scheme '{_parsed_url.drivername}'. "
        "Auditify runs on PostgreSQL only (Supabase in production). "
        "Set DATABASE_URL to a postgresql://... connection string in backend/.env "
        "(Supabase Dashboard -> Project Settings -> Database -> Connection string)."
    )

SAFE_DATABASE_URL = _parsed_url.render_as_string(hide_password=True)

engine = create_engine(
    settings.DATABASE_URL,
    # Managed PostgreSQL (Supabase) closes idle connections aggressively,
    # so verify each pooled connection before handing it out and recycle
    # well before the server-side idle timeout kicks in.
    pool_pre_ping=True,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_timeout=settings.DB_POOL_TIMEOUT,
    pool_recycle=settings.DB_POOL_RECYCLE,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """Declarative base shared by every ORM model in the application."""


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency that yields a request-scoped DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Generator[Session, None, None]:
    """Context manager for use outside of FastAPI's DI system (e.g. services)."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _add_missing_columns() -> None:
    """Lightweight auto-migration for columns added after a table's creation.

    ``create_all`` only issues ``CREATE TABLE`` for missing tables - it never
    alters existing ones. The ``audit_runs.user_id`` column was added when the
    endpoints became user-scoped, so early deployments need this one-shot
    ``ADD COLUMN``. The plain statement is valid PostgreSQL; the FK constraint
    is declared on the model and enforced by the ORM layer regardless.
    """
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    if inspector.has_table("audit_runs"):
        existing = {col["name"] for col in inspector.get_columns("audit_runs")}
        if "user_id" not in existing:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE audit_runs ADD COLUMN user_id VARCHAR(36)"))


def init_db() -> None:
    """Auto-migration: create every missing table on application startup.

    ``app.models`` is imported first so that all ORM classes are registered on
    ``Base.metadata`` before ``create_all`` runs. ``create_all`` is additive and
    only issues ``CREATE TABLE`` for tables that do not already exist, so it is
    safe to run on every boot (it is *not* a schema-migration tool: it will not
    alter existing tables). Columns added to existing tables post-release are
    handled separately by :func:`_add_missing_columns`.
    """
    import app.models  # noqa: F401  (importing the package registers all tables)

    try:
        Base.metadata.create_all(bind=engine)
        _add_missing_columns()
    except SQLAlchemyError as exc:
        # Fail fast, but with an actionable message instead of a bare traceback.
        raise RuntimeError(
            f"Could not initialise the database schema at {SAFE_DATABASE_URL}.\n"
            "  * Check DATABASE_URL in backend/.env - replace the "
            "YOUR_ACTUAL_PASSWORD placeholder with your real Supabase database "
            "password.\n"
            "  * Supabase's direct db.<project-ref>.supabase.co host is IPv6-only "
            "on newer projects; if your network has no IPv6 route, use the "
            "connection-pooler host instead (see README).\n"
            f"  * Underlying error: {exc}"
        ) from exc