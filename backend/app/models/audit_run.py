"""
Audit pipeline ORM models (existing audit dashboard schema).

AuditRun          - one execution of the audit pipeline against a
                    (spec document, execution log) pair.
AuditCheckItem    - a single rule-based or AI-driven compliance finding
                    belonging to an AuditRun.
SystemLogRecord   - archived raw log content associated with a run, kept
                    for historical trail / re-analysis purposes.
"""
from datetime import datetime

from sqlalchemy import (
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.models.enums import CheckSeverity, CheckSource, CheckStatus
from app.models.utils import iso_or_none
from app.models.utils import new_uuid as _uuid


class AuditRun(Base):
    __tablename__ = "audit_runs"

    id = Column(String(36), primary_key=True, default=_uuid)
    spec_filename = Column(String(512), nullable=False)
    log_filename = Column(String(512), nullable=False)
    model_used = Column(String(128), nullable=False)

    # Owning user. Nullable only so that runs created before this column
    # existed keep loading in raw SQL contexts; the API layer treats NULL
    # as unowned, so legacy rows are invisible to every authenticated user.
    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    compliance_score = Column(Float, nullable=False, default=0.0)
    total_checks = Column(Integer, nullable=False, default=0)
    passed_checks = Column(Integer, nullable=False, default=0)
    failed_checks = Column(Integer, nullable=False, default=0)
    warning_checks = Column(Integer, nullable=False, default=0)
    critical_violations = Column(Integer, nullable=False, default=0)

    spec_char_count = Column(Integer, nullable=False, default=0)
    log_char_count = Column(Integer, nullable=False, default=0)
    log_line_count = Column(Integer, nullable=False, default=0)

    status = Column(String(32), nullable=False, default="COMPLETED")
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    checks = relationship(
        "AuditCheckItem",
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="AuditCheckItem.created_at",
    )
    logs = relationship(
        "SystemLogRecord",
        back_populates="run",
        cascade="all, delete-orphan",
    )

    def to_summary_dict(self) -> dict:
        return {
            "id": self.id,
            "spec_filename": self.spec_filename,
            "log_filename": self.log_filename,
            "model_used": self.model_used,
            "compliance_score": self.compliance_score,
            "total_checks": self.total_checks,
            "passed_checks": self.passed_checks,
            "failed_checks": self.failed_checks,
            "warning_checks": self.warning_checks,
            "critical_violations": self.critical_violations,
            "status": self.status,
            "created_at": iso_or_none(self.created_at),
        }


class AuditCheckItem(Base):
    __tablename__ = "audit_check_items"

    id = Column(String(36), primary_key=True, default=_uuid)
    run_id = Column(String(36), ForeignKey("audit_runs.id"), nullable=False, index=True)

    name = Column(String(256), nullable=False)
    category = Column(String(128), nullable=False, default="General")
    status = Column(Enum(CheckStatus), nullable=False)
    severity = Column(Enum(CheckSeverity), nullable=False)
    source = Column(Enum(CheckSource), nullable=False)

    description = Column(Text, nullable=False)
    evidence = Column(Text, nullable=True)
    recommendation = Column(Text, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow)

    run = relationship("AuditRun", back_populates="checks")


class SystemLogRecord(Base):
    __tablename__ = "system_log_records"

    id = Column(String(36), primary_key=True, default=_uuid)
    run_id = Column(String(36), ForeignKey("audit_runs.id"), nullable=False, index=True)
    filename = Column(String(512), nullable=False)
    content = Column(Text, nullable=False)
    line_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    run = relationship("AuditRun", back_populates="logs")