"""
User-scoped audit ORM model.

Audit - a lightweight, user-owned summary of an audit. It records who ran it,
        its title, the resulting compliance score, and a human-readable summary
        of the findings.

NOTE: this is intentionally separate from :class:`app.models.audit_run.AuditRun`,
which is the existing, richer audit-dashboard schema (file names, per-check
rows, archived logs). ``Audit`` is the auth-scoped record that belongs to a
``User``; ``AuditRun`` is the pipeline output. If the two are ever unified,
``Audit`` is the smaller superset to keep.
"""
from datetime import datetime

from sqlalchemy import Column, DateTime, Float, ForeignKey, String, Text
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.models.utils import iso_or_none
from app.models.utils import new_uuid as _uuid


class Audit(Base):
    __tablename__ = "audits"

    id = Column(String(36), primary_key=True, default=_uuid)

    # Owning user. ondelete="CASCADE" keeps the database consistent even when
    # rows are deleted outside the ORM (raw SQL, admin console, ...).
    user_id = Column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    title = Column(String(256), nullable=False)
    compliance_score = Column(Float, nullable=False, default=0.0)
    findings_summary = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    user = relationship("User", back_populates="audits")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "title": self.title,
            "compliance_score": self.compliance_score,
            "findings_summary": self.findings_summary,
            "created_at": iso_or_none(self.created_at),
        }