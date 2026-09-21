"""
SQLAlchemy ORM models for Auditify.

This is a package so each model can live in its own module, while every model
stays importable from the flat ``app.models`` namespace that the rest of the
application (and the previous single-module layout) already used.

Audit pipeline models (existing dashboard schema):
    AuditRun          - one execution of the audit pipeline against a
                        (spec document, execution log) pair.
    AuditCheckItem    - a single rule-based or AI-driven compliance finding
                        belonging to an AuditRun.
    SystemLogRecord   - archived raw log content associated with a run, kept
                        for historical trail / re-analysis purposes.

Authentication / user-scoped models:
    User              - an authenticated dashboard user.
    Audit             - a user-owned, lightweight summary of an audit run.
"""
from app.models.audit import Audit
from app.models.audit_run import AuditCheckItem, AuditRun, SystemLogRecord
from app.models.enums import CheckSeverity, CheckSource, CheckStatus
from app.models.user import User

# Backwards compatibility: the previous single-module layout exposed the PK
# helper as ``app.models._uuid``.
from app.models.utils import new_uuid as _uuid  # noqa: F401

__all__ = [
    # enums
    "CheckStatus",
    "CheckSeverity",
    "CheckSource",
    # audit pipeline
    "AuditRun",
    "AuditCheckItem",
    "SystemLogRecord",
    # auth / user-scoped
    "User",
    "Audit",
    # shared helper
    "_uuid",
]