"""Enumerations shared by the audit ORM models."""
import enum


class CheckStatus(str, enum.Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    WARNING = "WARNING"


class CheckSeverity(str, enum.Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    INFO = "INFO"


class CheckSource(str, enum.Enum):
    RULE_BASED = "RULE_BASED"
    AI_DRIVEN = "AI_DRIVEN"