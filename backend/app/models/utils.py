"""Shared helpers used by the ORM model modules."""
import uuid
from datetime import datetime
from typing import Optional, cast


def new_uuid() -> str:
    """Return a new UUID4 as a string (client-side primary-key default)."""
    return str(uuid.uuid4())


def iso_or_none(value: object) -> Optional[str]:
    """Safely render a SQLAlchemy ``DateTime`` column value as ISO-8601 text.

    A plain ``col.isoformat() if col else None`` is rejected by Pylance:
    the SQLAlchemy stubs give ``Column[datetime].__bool__`` a NoReturn
    return type, so direct truthiness checks on a column are flagged. The
    cast to ``Optional[datetime]`` sidesteps that while keeping the
    runtime behaviour identical (``None`` when the column is unset).
    """
    dt = cast(Optional[datetime], value)
    return dt.isoformat() if dt is not None else None