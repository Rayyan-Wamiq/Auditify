"""
Differential drift harness: dumps the *Python* engine's output.

Runs the original FastAPI audit engine (`backend/app/services/audit_engine.py`)
over a set of fixtures and writes both the fixtures and the resulting
findings/scores into this directory so that `compare_engines.js` can verify the
TypeScript port (`frontend/lib/server/audit/engine.ts`) against it.

Usage (from the repository root):

    backend/.venv/Scripts/python.exe tools/parity/python_engine_dump.py

Requires the legacy backend virtualenv (it is the only thing in `backend/` this
script touches).
"""
# Make `app` importable for static analysers (Pylance/pyright) and at runtime.
# This must run before `from app.services...` so the path is known up-front;
# the noqa: E402 below suppresses the linter's "import not at top of file" rule.
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

import json

os.environ["GROQ_API_KEY"] = ""  # rule-based pass only

from app.services.audit_engine import (  # noqa: E402
    _compute_score,
    _run_rule_based_checks,
)

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

SPEC_FULL = (
    "Compliance SOP for the billing platform.\n"
    "1. Encryption: all customer data at rest is encrypted with AES-256 and all traffic uses TLS 1.2+.\n"
    "2. Authentication: users sign in with credentials; every session issues a bearer token.\n"
    "3. Access control: RBAC permissions are reviewed quarterly and every action is authorized.\n"
    "4. Logging: an audit trail captures every privileged operation and each request is logged.\n"
    "5. Backup: nightly snapshots must be restorable within four hours.\n"
    "6. Data retention: records are archived for seven years and purge is executed on request.\n"
    "7. Rate limiting: the public API throttles abusive clients per tenant.\n"
    "8. Error handling: unexpected exceptions must be caught, logged and alerted on.\n"
)

SPEC_SHORT = "Small SOP. Encryption is required for all endpoints. See the wiki for the rest."

# The private-key header is assembled at runtime so that the literal PEM banner
# never appears in tracked source (GitHub's secret scanning flags that pattern);
# the engine still sees the real string and exercises that rule.
PEM_HEADER = "-----BEGIN " + "RSA PRIVATE KEY-----"

LOG_MIXED = "\n".join(
    [
        "2026-01-04T10:00:00Z INFO boot complete",
        "2026-01-04T10:00:01Z INFO tls handshake ok cipher=TLS_AES_256_GCM_SHA384",
        "2026-01-04T10:00:02Z INFO login success user=42 token=a1b2c3",
        "2026-01-04T10:00:03Z INFO audit trail written for invoice 9931",
        "2026-01-04T10:00:04Z INFO request handled in 12ms",
        "2026-01-04T10:00:05Z WARN retry scheduled for webhook delivery",
        "2026-01-04T10:00:06Z INFO worker pool resized to 8",
        "2026-01-04T10:00:07Z ERROR unhandled exception in billing worker",
        "2026-01-04T10:00:08Z INFO cache warm",
        "2026-01-04T10:00:09Z INFO shutdown initiated",
    ]
)

LOG_SECRETS = "\n".join(
    [
        # Deliberately fake, non-provider-shaped values: these exist only to trip
        # the local secret-leakage regexes, never to look like live credentials.
        "config load api_key: auditify_fixture_value_x",
        "db password: hunter2",
        "signing secret_key: 0f8c1d2e3b4a59687766554433221100",
        PEM_HEADER,
        "MIIEowIBAAKCAQEAwb6f",
        "-----END " + "RSA PRIVATE KEY-----",
        "service started",
        "request failed",
        "exception raised in handler",
        "traceback follows",
        "critical path degraded",
        "retry failed again",
    ]
)

LOG_TIE = "\n".join(
    [
        "INFO start",
        "INFO ready",
        "INFO work",
        "INFO work",
        "INFO idle",
        "INFO idle",
        "ERROR once",
        "INFO done",
    ]
)

LOG_QUIET = "\n".join(
    ["INFO start", "INFO handled", "INFO stop", "INFO bye"] + ["INFO tick"] * 96
)

LOG_KEYS = "\n".join(["", "   ", "INFO only line", "  ", ""])

FIXTURES = [
    {"name": "mixed-controls", "spec": SPEC_FULL, "log": LOG_MIXED},
    {"name": "secret-leakage", "spec": SPEC_FULL, "log": LOG_SECRETS},
    {"name": "percent-tie", "spec": SPEC_FULL, "log": LOG_TIE},
    {"name": "quiet-log", "spec": SPEC_FULL, "log": LOG_QUIET},
    {"name": "short-spec-tiny-log", "spec": SPEC_SHORT, "log": LOG_KEYS},
    {"name": "empty-log", "spec": SPEC_FULL, "log": ""},
]


def main() -> None:
    with open(os.path.join(OUT_DIR, "fixtures.json"), "w", encoding="utf-8") as handle:
        json.dump(FIXTURES, handle, ensure_ascii=False, indent=2)

    results = []
    for fixture in FIXTURES:
        findings = _run_rule_based_checks(fixture["spec"], fixture["log"])
        results.append(
            {
                "name": fixture["name"],
                "findings": [
                    {
                        "name": f.name,
                        "category": f.category,
                        "status": f.status,
                        "severity": f.severity,
                        "source": f.source,
                        "description": f.description,
                        "recommendation": f.recommendation,
                        "evidence": f.evidence,
                    }
                    for f in findings
                ],
                "score": _compute_score(findings),
            }
        )

    with open(os.path.join(OUT_DIR, "py_output.json"), "w", encoding="utf-8") as handle:
        json.dump(results, handle, ensure_ascii=False, indent=2)

    print(f"python engine: {len(results)} fixtures, "
          f"{sum(len(r['findings']) for r in results)} findings")


if __name__ == "__main__":
    main()
