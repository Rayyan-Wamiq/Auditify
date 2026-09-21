"""
Authentication ORM model.

User - an authenticated dashboard user. Owns zero or more user-scoped Audit
       records (see :mod:`app.models.audit`).
"""
from datetime import datetime

from sqlalchemy import Column, DateTime, String
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.models.utils import new_uuid as _uuid


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=_uuid)

    # Unique + indexed: enforces one account per email and makes login lookups
    # O(log n). 320 chars is the practical maximum length of an email address.
    email = Column(String(320), nullable=False, unique=True, index=True)

    # Stores the *hash* only (never the plaintext password). 255 chars leaves
    # room for the algorithm prefix + salt of bcrypt/argon2 hashes.
    hashed_password = Column(String(255), nullable=False)

    full_name = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    audits = relationship(
        "Audit",
        back_populates="user",
        cascade="all, delete-orphan",
        order_by="Audit.created_at",
    )

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return f"<User id={self.id} email={self.email!r}>"