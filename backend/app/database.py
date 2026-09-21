"""
Backward-compatibility shim for the database layer.

The engine, session factory, and declarative ``Base`` now live in
``app.core.database``. This module re-exports them so existing imports
(``from app.database import Base`` / ``get_db`` / ``init_db``) keep working.

Re-exporting is deliberate: the process must contain exactly ONE engine and ONE
metadata registry, so new code should import from ``app.core.database`` while
this shim keeps older imports valid.
"""
from app.core.database import (  # noqa: F401
    SAFE_DATABASE_URL,
    Base,
    SessionLocal,
    engine,
    get_db,
    init_db,
    session_scope,
)

__all__ = [
    "Base",
    "SessionLocal",
    "engine",
    "get_db",
    "init_db",
    "session_scope",
    "SAFE_DATABASE_URL",
]