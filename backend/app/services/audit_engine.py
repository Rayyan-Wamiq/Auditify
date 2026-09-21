"""
Core audit engine.

Combines deterministic rule-based static analysis of the (spec, log) pair
with an AI-driven pass delegated to a Groq-hosted LLM, then merges both sets
of findings into a single itemized violation list and an overall compliance
score.
"""
import json
import re
from dataclasses import dataclass, field
from typing import List

from groq import Groq

from app.config import get_settings

settings = get_settings()

SEVERITY_WEIGHTS = {
    "CRITICAL": 25,
    "HIGH": 15,
    "MEDIUM": 8,
    "LOW": 3,
    "INFO": 0,
}

# Keywords in the SOP/spec that imply a compliance control the log should
# demonstrate evidence of. Extendable without touching call sites.
CONTROL_KEYWORDS = {
    "encryption": ["encrypt", "tls", "aes", "ssl"],
    "authentication": ["auth", "login", "credential", "token"],
    "access control": ["access control", "permission", "rbac", "authorized"],
    "logging": ["log", "audit trail", "logged"],
    "backup": ["backup", "snapshot", "restore"],
    "data retention": ["retention", "purge", "archive"],
    "error handling": ["exception", "error", "try", "catch"],
    "rate limiting": ["rate limit", "throttle"],
}

SECRET_PATTERNS = [
    (re.compile(r"(?i)api[_-]?key\s*[:=]\s*['\"]?[a-z0-9_\-]{12,}"), "Hardcoded API key detected in logs"),
    (re.compile(r"(?i)password\s*[:=]\s*['\"]?\S{4,}"), "Plaintext password detected in logs"),
    (re.compile(r"(?i)secret[_-]?key\s*[:=]\s*['\"]?\S{6,}"), "Hardcoded secret key detected in logs"),
    (re.compile(r"-----BEGIN (RSA|EC|OPENSSH|DSA) PRIVATE KEY-----"), "Embedded private key material detected in logs"),
]

ERROR_LINE_PATTERN = re.compile(r"(?i)\b(error|exception|failed|failure|traceback|critical)\b")


@dataclass
class Finding:
    name: str
    category: str
    status: str  # PASS | FAIL | WARNING
    severity: str  # CRITICAL | HIGH | MEDIUM | LOW | INFO
    source: str  # RULE_BASED | AI_DRIVEN
    description: str
    recommendation: str
    evidence: str = ""


@dataclass
class AuditResult:
    findings: List[Finding] = field(default_factory=list)
    compliance_score: float = 100.0


def _run_rule_based_checks(spec_text: str, log_text: str) -> List[Finding]:
    findings: List[Finding] = []
    spec_lower = spec_text.lower()
    log_lower = log_text.lower()

    # 1. Control coverage: for every control referenced in the spec, verify
    #    the execution log shows corresponding evidence.
    for control, keywords in CONTROL_KEYWORDS.items():
        mentioned_in_spec = any(kw in spec_lower for kw in keywords)
        if not mentioned_in_spec:
            continue
        evidenced_in_log = any(kw in log_lower for kw in keywords)
        if evidenced_in_log:
            findings.append(
                Finding(
                    name=f"{control.title()} Control Evidence",
                    category="Control Coverage",
                    status="PASS",
                    severity="INFO",
                    source="RULE_BASED",
                    description=f"The SOP mandates a '{control}' control and the execution log "
                    f"contains corresponding evidence.",
                    recommendation="No action required; continue monitoring for regressions.",
                    evidence=control,
                )
            )
        else:
            findings.append(
                Finding(
                    name=f"Missing {control.title()} Evidence",
                    category="Control Coverage",
                    status="FAIL",
                    severity="HIGH",
                    source="RULE_BASED",
                    description=f"The SOP requires a '{control}' control, but no supporting "
                    f"evidence for it was found anywhere in the submitted execution log.",
                    recommendation=f"Instrument the system to emit explicit log evidence "
                    f"(e.g. structured events) whenever the '{control}' control executes, "
                    f"then re-run the audit.",
                    evidence=control,
                )
            )

    # 2. Secret / credential leakage scan on the log content.
    for pattern, label in SECRET_PATTERNS:
        match = pattern.search(log_text)
        if match:
            findings.append(
                Finding(
                    name=label,
                    category="Data Exposure",
                    status="FAIL",
                    severity="CRITICAL",
                    source="RULE_BASED",
                    description="Sensitive credential-like content was found directly in the "
                    "execution log, which violates standard secret-handling practices.",
                    recommendation="Remove secrets from log output immediately, rotate the "
                    "exposed credential, and route secret material through a vault or "
                    "environment-based secret manager instead of logging it.",
                    evidence=match.group(0)[:80],
                )
            )

    # 3. Error density in the execution log.
    log_lines = [ln for ln in log_text.splitlines() if ln.strip()]
    error_lines = [ln for ln in log_lines if ERROR_LINE_PATTERN.search(ln)]
    total_lines = max(len(log_lines), 1)
    error_ratio = len(error_lines) / total_lines

    if error_ratio > 0.15:
        findings.append(
            Finding(
                name="High Error Density in Execution Log",
                category="System Health",
                status="FAIL",
                severity="CRITICAL",
                source="RULE_BASED",
                description=f"{len(error_lines)} of {total_lines} log lines "
                f"({error_ratio:.0%}) contain error/exception/failure markers, indicating "
                f"systemic instability during the audited execution window.",
                recommendation="Triage the top recurring error signatures, prioritize root-"
                "cause fixes for the highest-frequency failures, and re-run the audited "
                "process after remediation.",
                evidence=error_lines[0][:200] if error_lines else "",
            )
        )
    elif error_ratio > 0.03:
        findings.append(
            Finding(
                name="Elevated Error Rate in Execution Log",
                category="System Health",
                status="WARNING",
                severity="MEDIUM",
                source="RULE_BASED",
                description=f"{len(error_lines)} of {total_lines} log lines "
                f"({error_ratio:.0%}) contain error markers, above the healthy baseline.",
                recommendation="Review recurring warnings/errors and add targeted handling "
                "or alerting for the most frequent failure modes.",
                evidence=error_lines[0][:200] if error_lines else "",
            )
        )
    else:
        findings.append(
            Finding(
                name="Execution Log Error Rate Within Bounds",
                category="System Health",
                status="PASS",
                severity="INFO",
                source="RULE_BASED",
                description=f"Only {len(error_lines)} of {total_lines} log lines "
                f"({error_ratio:.0%}) contain error markers, which is within acceptable limits.",
                recommendation="No action required.",
            )
        )

    # 4. Spec completeness heuristic - a usable SOP should be substantive.
    word_count = len(spec_text.split())
    if word_count < 80:
        findings.append(
            Finding(
                name="Specification Document Lacks Sufficient Detail",
                category="Documentation Quality",
                status="WARNING",
                severity="MEDIUM",
                source="RULE_BASED",
                description=f"The uploaded SOP/spec document contains only {word_count} words, "
                "which is unlikely to comprehensively define compliance requirements.",
                recommendation="Expand the SOP with explicit, testable requirements for each "
                "control area (security, availability, data handling) so future audits can "
                "verify compliance with confidence.",
            )
        )

    # 5. Empty log guard already handled upstream; add a note if log is short.
    if total_lines < 5:
        findings.append(
            Finding(
                name="Insufficient Execution Log Volume",
                category="Documentation Quality",
                status="WARNING",
                severity="LOW",
                source="RULE_BASED",
                description=f"The execution log contains only {total_lines} non-empty lines, "
                "limiting the audit engine's ability to verify runtime behavior.",
                recommendation="Capture a longer, representative execution window before "
                "re-running the audit for a higher-confidence result.",
            )
        )

    return findings


AI_SYSTEM_PROMPT = """You are Auditify's AI compliance auditor. You compare a \
Standard Operating Procedure / specification document against a system \
execution log and identify compliance violations, risks, and gaps that a \
purely rule-based scanner would miss (e.g. subtle logical mismatches, \
missing safeguards implied but not explicitly named, procedural drift).

Respond with ONLY a JSON array (no prose, no markdown fences). Each array \
element must be an object with exactly these keys:
  "name": short finding title (string)
  "category": one of "Control Coverage", "System Health", "Data Exposure", \
"Documentation Quality", "Process Compliance"
  "status": one of "PASS", "FAIL", "WARNING"
  "severity": one of "CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"
  "description": 1-3 sentence explanation grounded in the provided text
  "recommendation": concrete, actionable remediation step
  "evidence": short quote or paraphrase (<=200 chars) from the log or spec, or ""

Return between 3 and 8 findings. Do not repeat findings that are purely \
generic; ground every finding in the actual content provided."""


def _truncate(text: str, max_chars: int) -> str:
    return text if len(text) <= max_chars else text[:max_chars] + "\n...[truncated]"


def _run_ai_driven_checks(spec_text: str, log_text: str, model: str) -> List[Finding]:
    if not settings.GROQ_API_KEY:
        return [
            Finding(
                name="AI-Driven Analysis Skipped",
                category="Process Compliance",
                status="WARNING",
                severity="INFO",
                source="AI_DRIVEN",
                description="No GROQ_API_KEY is configured on the server, so the AI-driven "
                "compliance pass could not run. Only rule-based checks were executed.",
                recommendation="Set the GROQ_API_KEY environment variable to enable the full "
                "AI-driven audit pass.",
            )
        ]

    client = Groq(api_key=settings.GROQ_API_KEY)
    user_prompt = (
        f"=== SPECIFICATION / SOP DOCUMENT ===\n{_truncate(spec_text, 8000)}\n\n"
        f"=== SYSTEM EXECUTION LOG ===\n{_truncate(log_text, 8000)}\n\n"
        "Analyze the above and return the JSON array of findings as instructed."
    )

    try:
        completion = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": AI_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
            max_tokens=2048,
        )
        raw = completion.choices[0].message.content.strip()
    except Exception as exc:  # pragma: no cover - network dependent
        return [
            Finding(
                name="AI-Driven Analysis Failed",
                category="Process Compliance",
                status="WARNING",
                severity="INFO",
                source="AI_DRIVEN",
                description=f"The AI-driven audit pass could not complete: {exc}",
                recommendation="Verify the GROQ_API_KEY and selected model are valid, then "
                "re-run the audit.",
            )
        ]

    raw = re.sub(r"^```(json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
    try:
        parsed = json.loads(raw)
        if not isinstance(parsed, list):
            raise ValueError("Expected a JSON array")
    except (json.JSONDecodeError, ValueError):
        return [
            Finding(
                name="AI-Driven Analysis Returned Unparseable Output",
                category="Process Compliance",
                status="WARNING",
                severity="INFO",
                source="AI_DRIVEN",
                description="The model response could not be parsed as structured JSON "
                "findings, so this AI pass was skipped for scoring purposes.",
                recommendation="Retry the audit; if this persists, try a different model.",
            )
        ]

    findings: List[Finding] = []
    valid_statuses = {"PASS", "FAIL", "WARNING"}
    valid_severities = {"CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"}
    for item in parsed[:8]:
        if not isinstance(item, dict):
            continue
        status = str(item.get("status", "WARNING")).upper()
        severity = str(item.get("severity", "MEDIUM")).upper()
        findings.append(
            Finding(
                name=str(item.get("name", "Untitled AI Finding"))[:256],
                category=str(item.get("category", "Process Compliance"))[:128],
                status=status if status in valid_statuses else "WARNING",
                severity=severity if severity in valid_severities else "MEDIUM",
                source="AI_DRIVEN",
                description=str(item.get("description", "")),
                recommendation=str(item.get("recommendation", "Review manually.")),
                evidence=str(item.get("evidence", ""))[:200],
            )
        )
    return findings


def _compute_score(findings: List[Finding]) -> float:
    score = 100.0
    for f in findings:
        if f.status == "FAIL":
            score -= SEVERITY_WEIGHTS.get(f.severity, 5)
        elif f.status == "WARNING":
            score -= SEVERITY_WEIGHTS.get(f.severity, 5) * 0.4
    return round(max(0.0, min(100.0, score)), 1)


def run_audit(spec_text: str, log_text: str, model: str) -> AuditResult:
    """Execute the full rule-based + AI-driven audit pipeline."""
    findings: List[Finding] = []
    findings.extend(_run_rule_based_checks(spec_text, log_text))
    findings.extend(_run_ai_driven_checks(spec_text, log_text, model))
    score = _compute_score(findings)
    return AuditResult(findings=findings, compliance_score=score)
