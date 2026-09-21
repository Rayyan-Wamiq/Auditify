"""Pydantic v2 schemas for request/response validation and serialization."""
import re
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Pragmatic email check: a local part, an "@", a domain and a TLD. Full RFC 5322
# validation is intentionally avoided - it rejects valid-but-exotic addresses
# and the authoritative check is delivery, not the regex.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")

# bcrypt hashes at most 72 bytes; longer input would be silently truncated.
MAX_PASSWORD_BYTES = 72


class CheckItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    category: str
    status: str
    severity: str
    source: str
    description: str
    evidence: Optional[str] = None
    recommendation: str
    created_at: datetime


class AuditRunSummary(BaseModel):
    # `model_used` is the API field name for the LLM that ran the audit, so the
    # Pydantic v2 "model_" protected namespace (meant for BaseModels) must be
    # disabled to silence the false-positive conflict warning.
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: str
    spec_filename: str
    log_filename: str
    model_used: str
    compliance_score: float
    total_checks: int
    passed_checks: int
    failed_checks: int
    warning_checks: int
    critical_violations: int
    status: str
    created_at: datetime


class AuditRunDetail(AuditRunSummary):
    spec_char_count: int
    log_char_count: int
    log_line_count: int
    checks: List[CheckItemOut] = Field(default_factory=list)


class AuditRunListResponse(BaseModel):
    total: int
    runs: List[AuditRunSummary]


class DashboardStats(BaseModel):
    total_runs: int
    total_checks_executed: int
    average_compliance_score: float
    total_critical_violations: int
    total_logs_audited: int
    latest_run: Optional[AuditRunSummary] = None


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    run_id: Optional[str] = None
    model: Optional[str] = None
    history: List[dict] = Field(default_factory=list)


class ChatSource(BaseModel):
    chunk: str
    similarity: float


class ChatResponse(BaseModel):
    # See AuditRunSummary: "model_used" collides with Pydantic's "model_"
    # protected namespace, which we intentionally opt out of here.
    model_config = ConfigDict(protected_namespaces=())

    answer: str
    sources: List[ChatSource] = Field(default_factory=list)
    model_used: str


class ModelInfo(BaseModel):
    id: str
    label: str
    description: str
    context_window: int


class ModelListResponse(BaseModel):
    models: List[ModelInfo]
    default_model: str


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------


class SignupRequest(BaseModel):
    email: str = Field(..., max_length=320)
    password: str = Field(..., min_length=8)
    full_name: Optional[str] = Field(default=None, max_length=255)

    @field_validator("email")
    @classmethod
    def _validate_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not _EMAIL_RE.match(value):
            raise ValueError("Enter a valid email address.")
        return value

    @field_validator("password")
    @classmethod
    def _validate_password(cls, value: str) -> str:
        if len(value.encode("utf-8")) > MAX_PASSWORD_BYTES:
            raise ValueError(
                f"Password must be at most {MAX_PASSWORD_BYTES} bytes long."
            )
        return value


class LoginRequest(BaseModel):
    email: str = Field(..., max_length=320)
    password: str = Field(..., min_length=1)

    @field_validator("email")
    @classmethod
    def _normalise_email(cls, value: str) -> str:
        # Only normalised here: a malformed address simply won't match any user,
        # and the endpoint answers with a uniform 401 rather than a 422.
        return value.strip().lower()


class RefreshRequest(BaseModel):
    refresh_token: str = Field(..., min_length=1)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    full_name: Optional[str] = None
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    # Seconds until the access token expires, so clients can refresh ahead of time.
    expires_in: int
    user: Optional[UserOut] = None
