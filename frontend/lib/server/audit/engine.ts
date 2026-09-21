/**
 * Core audit engine.
 *
 * Line-by-line TypeScript port of `backend/app/services/audit_engine.py`:
 * deterministic rule-based static analysis of the (spec, log) pair, combined
 * with an AI-driven pass delegated to a Groq-hosted LLM, merged into a single
 * itemized violation list and an overall compliance score.
 *
 * Every regex, threshold, weight, string and rounding rule below is copied from
 * the Python implementation - the two engines are verified to produce identical
 * findings and scores for the same inputs (see `backend/DEPRECATED.md`).
 */
import { groqChatCompletion, isGroqConfigured } from "../groq";
import {
  pythonLen,
  pythonPercent0,
  pythonRound,
  pythonSlice,
  pythonSplitCount,
  pythonStr,
  pythonTitle,
} from "../python-compat";

export type CheckStatus = "PASS" | "FAIL" | "WARNING";
export type CheckSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
export type CheckSource = "RULE_BASED" | "AI_DRIVEN";

export interface Finding {
  name: string;
  category: string;
  status: CheckStatus;
  severity: CheckSeverity;
  source: CheckSource;
  description: string;
  recommendation: string;
  /** Defaults to `""` (the dataclass default in `audit_engine.py`). */
  evidence?: string;
}

export interface AuditResult {
  findings: Finding[];
  compliance_score: number;
}

export const SEVERITY_WEIGHTS: Record<string, number> = {
  CRITICAL: 25,
  HIGH: 15,
  MEDIUM: 8,
  LOW: 3,
  INFO: 0,
};

/**
 * Keywords in the SOP/spec that imply a compliance control the log should
 * demonstrate evidence of. Extendable without touching call sites.
 */
export const CONTROL_KEYWORDS: Record<string, string[]> = {
  encryption: ["encrypt", "tls", "aes", "ssl"],
  authentication: ["auth", "login", "credential", "token"],
  "access control": ["access control", "permission", "rbac", "authorized"],
  logging: ["log", "audit trail", "logged"],
  backup: ["backup", "snapshot", "restore"],
  "data retention": ["retention", "purge", "archive"],
  "error handling": ["exception", "error", "try", "catch"],
  "rate limiting": ["rate limit", "throttle"],
};

interface SecretPattern {
  pattern: RegExp;
  label: string;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  {
    pattern: /api[_-]?key\s*[:=]\s*['"]?[a-z0-9_-]{12,}/i,
    label: "Hardcoded API key detected in logs",
  },
  {
    pattern: /password\s*[:=]\s*['"]?\S{4,}/i,
    label: "Plaintext password detected in logs",
  },
  {
    pattern: /secret[_-]?key\s*[:=]\s*['"]?\S{6,}/i,
    label: "Hardcoded secret key detected in logs",
  },
  {
    pattern: /-----BEGIN (RSA|EC|OPENSSH|DSA) PRIVATE KEY-----/,
    label: "Embedded private key material detected in logs",
  },
];

export const ERROR_LINE_PATTERN = /\b(error|exception|failed|failure|traceback|critical)\b/i;

/** Non-empty log lines (`[ln for ln in text.splitlines() if ln.strip()]`). */
function nonEmptyLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);
}

export function runRuleBasedChecks(specText: string, logText: string): Finding[] {
  const findings: Finding[] = [];
  const specLower = specText.toLowerCase();
  const logLower = logText.toLowerCase();

  // 1. Control coverage: for every control referenced in the spec, verify the
  //    execution log shows corresponding evidence.
  for (const [control, keywords] of Object.entries(CONTROL_KEYWORDS)) {
    const mentionedInSpec = keywords.some((keyword) => specLower.includes(keyword));
    if (!mentionedInSpec) continue;

    const evidencedInLog = keywords.some((keyword) => logLower.includes(keyword));
    if (evidencedInLog) {
      findings.push({
        name: `${pythonTitle(control)} Control Evidence`,
        category: "Control Coverage",
        status: "PASS",
        severity: "INFO",
        source: "RULE_BASED",
        description:
          `The SOP mandates a '${control}' control and the execution log ` +
          "contains corresponding evidence.",
        recommendation: "No action required; continue monitoring for regressions.",
        evidence: control,
      });
    } else {
      findings.push({
        name: `Missing ${pythonTitle(control)} Evidence`,
        category: "Control Coverage",
        status: "FAIL",
        severity: "HIGH",
        source: "RULE_BASED",
        description:
          `The SOP requires a '${control}' control, but no supporting ` +
          "evidence for it was found anywhere in the submitted execution log.",
        recommendation:
          "Instrument the system to emit explicit log evidence " +
          `(e.g. structured events) whenever the '${control}' control executes, ` +
          "then re-run the audit.",
        evidence: control,
      });
    }
  }

  // 2. Secret / credential leakage scan on the log content.
  for (const { pattern, label } of SECRET_PATTERNS) {
    const match = pattern.exec(logText);
    if (match) {
      findings.push({
        name: label,
        category: "Data Exposure",
        status: "FAIL",
        severity: "CRITICAL",
        source: "RULE_BASED",
        description:
          "Sensitive credential-like content was found directly in the " +
          "execution log, which violates standard secret-handling practices.",
        recommendation:
          "Remove secrets from log output immediately, rotate the " +
          "exposed credential, and route secret material through a vault or " +
          "environment-based secret manager instead of logging it.",
        evidence: pythonSlice(match[0], 0, 80),
      });
    }
  }

  // 3. Error density in the execution log.
  const logLines = nonEmptyLines(logText);
  const errorLines = logLines.filter((line) => ERROR_LINE_PATTERN.test(line));
  const totalLines = Math.max(logLines.length, 1);
  const errorRatio = errorLines.length / totalLines;

  if (errorRatio > 0.15) {
    findings.push({
      name: "High Error Density in Execution Log",
      category: "System Health",
      status: "FAIL",
      severity: "CRITICAL",
      source: "RULE_BASED",
      description:
        `${errorLines.length} of ${totalLines} log lines ` +
        `(${pythonPercent0(errorRatio)}) contain error/exception/failure markers, indicating ` +
        "systemic instability during the audited execution window.",
      recommendation:
        "Triage the top recurring error signatures, prioritize root-" +
        "cause fixes for the highest-frequency failures, and re-run the audited " +
        "process after remediation.",
      evidence: errorLines.length > 0 ? pythonSlice(errorLines[0], 0, 200) : "",
    });
  } else if (errorRatio > 0.03) {
    findings.push({
      name: "Elevated Error Rate in Execution Log",
      category: "System Health",
      status: "WARNING",
      severity: "MEDIUM",
      source: "RULE_BASED",
      description:
        `${errorLines.length} of ${totalLines} log lines ` +
        `(${pythonPercent0(errorRatio)}) contain error markers, above the healthy baseline.`,
      recommendation:
        "Review recurring warnings/errors and add targeted handling " +
        "or alerting for the most frequent failure modes.",
      evidence: errorLines.length > 0 ? pythonSlice(errorLines[0], 0, 200) : "",
    });
  } else {
    findings.push({
      name: "Execution Log Error Rate Within Bounds",
      category: "System Health",
      status: "PASS",
      severity: "INFO",
      source: "RULE_BASED",
      description:
        `Only ${errorLines.length} of ${totalLines} log lines ` +
        `(${pythonPercent0(errorRatio)}) contain error markers, which is within acceptable limits.`,
      recommendation: "No action required.",
    });
  }

  // 4. Spec completeness heuristic - a usable SOP should be substantive.
  const wordCount = pythonSplitCount(specText);
  if (wordCount < 80) {
    findings.push({
      name: "Specification Document Lacks Sufficient Detail",
      category: "Documentation Quality",
      status: "WARNING",
      severity: "MEDIUM",
      source: "RULE_BASED",
      description:
        `The uploaded SOP/spec document contains only ${wordCount} words, ` +
        "which is unlikely to comprehensively define compliance requirements.",
      recommendation:
        "Expand the SOP with explicit, testable requirements for each " +
        "control area (security, availability, data handling) so future audits can " +
        "verify compliance with confidence.",
    });
  }

  // 5. Empty log guard already handled upstream; add a note if the log is short.
  if (totalLines < 5) {
    findings.push({
      name: "Insufficient Execution Log Volume",
      category: "Documentation Quality",
      status: "WARNING",
      severity: "LOW",
      source: "RULE_BASED",
      description:
        `The execution log contains only ${totalLines} non-empty lines, ` +
        "limiting the audit engine's ability to verify runtime behavior.",
      recommendation:
        "Capture a longer, representative execution window before " +
        "re-running the audit for a higher-confidence result.",
    });
  }

  return findings;
}

export const AI_SYSTEM_PROMPT = `You are Auditify's AI compliance auditor. You compare a Standard Operating Procedure / specification document against a system execution log and identify compliance violations, risks, and gaps that a purely rule-based scanner would miss (e.g. subtle logical mismatches, missing safeguards implied but not explicitly named, procedural drift).

Respond with ONLY a JSON array (no prose, no markdown fences). Each array element must be an object with exactly these keys:
  "name": short finding title (string)
  "category": one of "Control Coverage", "System Health", "Data Exposure", "Documentation Quality", "Process Compliance"
  "status": one of "PASS", "FAIL", "WARNING"
  "severity": one of "CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"
  "description": 1-3 sentence explanation grounded in the provided text
  "recommendation": concrete, actionable remediation step
  "evidence": short quote or paraphrase (<=200 chars) from the log or spec, or ""

Return between 3 and 8 findings. Do not repeat findings that are purely generic; ground every finding in the actual content provided.`;

/** `_truncate(text, max_chars)` - appends a marker instead of silently cutting. */
function truncate(text: string, maxChars: number): string {
  return pythonLen(text) <= maxChars ? text : `${pythonSlice(text, 0, maxChars)}\n...[truncated]`;
}

export async function runAiDrivenChecks(
  specText: string,
  logText: string,
  model: string
): Promise<Finding[]> {
  if (!isGroqConfigured()) {
    return [
      {
        name: "AI-Driven Analysis Skipped",
        category: "Process Compliance",
        status: "WARNING",
        severity: "INFO",
        source: "AI_DRIVEN",
        description:
          "No GROQ_API_KEY is configured on the server, so the AI-driven " +
          "compliance pass could not run. Only rule-based checks were executed.",
        recommendation:
          "Set the GROQ_API_KEY environment variable to enable the full " +
          "AI-driven audit pass.",
        evidence: "",
      },
    ];
  }

  const userPrompt =
    `=== SPECIFICATION / SOP DOCUMENT ===\n${truncate(specText, 8000)}\n\n` +
    `=== SYSTEM EXECUTION LOG ===\n${truncate(logText, 8000)}\n\n` +
    "Analyze the above and return the JSON array of findings as instructed.";

  let raw: string;
  try {
    raw = (
      await groqChatCompletion({
        model,
        messages: [
          { role: "system", content: AI_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        maxTokens: 2048,
      })
    ).trim();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return [
      {
        name: "AI-Driven Analysis Failed",
        category: "Process Compliance",
        status: "WARNING",
        severity: "INFO",
        source: "AI_DRIVEN",
        description: `The AI-driven audit pass could not complete: ${reason}`,
        recommendation:
          "Verify the GROQ_API_KEY and selected model are valid, then " +
          "re-run the audit.",
        evidence: "",
      },
    ];
  }

  // Strip the markdown fences models sometimes add around JSON payloads.
  raw = raw.replace(/^```(json)?|```$/gm, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("Expected a JSON array");
    }
  } catch {
    return [
      {
        name: "AI-Driven Analysis Returned Unparseable Output",
        category: "Process Compliance",
        status: "WARNING",
        severity: "INFO",
        source: "AI_DRIVEN",
        description:
          "The model response could not be parsed as structured JSON " +
          "findings, so this AI pass was skipped for scoring purposes.",
        recommendation: "Retry the audit; if this persists, try a different model.",
        evidence: "",
      },
    ];
  }

  return parseAiFindings(parsed);
}

const VALID_STATUSES = new Set<string>(["PASS", "FAIL", "WARNING"]);
const VALID_SEVERITIES = new Set<string>(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]);

/**
 * Coerce the model's JSON array into `Finding`s.
 *
 * Mirrors the Python loop exactly: at most the first 8 items, non-object items
 * skipped, unknown enum values degraded to WARNING/MEDIUM, and the same field
 * truncation limits (256 / 128 / 200 characters).
 */
function parseAiFindings(parsed: unknown[]): Finding[] {
  const findings: Finding[] = [];
  for (const item of parsed.slice(0, 8)) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const status = pythonStr(record.status ?? "WARNING").toUpperCase();
    const severity = pythonStr(record.severity ?? "MEDIUM").toUpperCase();

    findings.push({
      name: pythonSlice(pythonStr(record.name ?? "Untitled AI Finding"), 0, 256),
      category: pythonSlice(pythonStr(record.category ?? "Process Compliance"), 0, 128),
      status: (VALID_STATUSES.has(status) ? status : "WARNING") as CheckStatus,
      severity: (VALID_SEVERITIES.has(severity) ? severity : "MEDIUM") as CheckSeverity,
      source: "AI_DRIVEN",
      description: pythonStr(record.description ?? ""),
      recommendation: pythonStr(record.recommendation ?? "Review manually."),
      evidence: pythonSlice(pythonStr(record.evidence ?? ""), 0, 200),
    });
  }
  return findings;
}

/** `_compute_score`: weighted penalties, clamped to [0, 100] and rounded to 1 dp. */
export function computeScore(findings: Finding[]): number {
  let score = 100.0;
  for (const finding of findings) {
    const weight = SEVERITY_WEIGHTS[finding.severity] ?? 5;
    if (finding.status === "FAIL") {
      score -= weight;
    } else if (finding.status === "WARNING") {
      score -= weight * 0.4;
    }
  }
  return pythonRound(Math.max(0.0, Math.min(100.0, score)), 1);
}

/** Execute the full rule-based + AI-driven audit pipeline (`run_audit`). */
export async function runAudit(
  specText: string,
  logText: string,
  model: string
): Promise<AuditResult> {
  const findings: Finding[] = [
    ...runRuleBasedChecks(specText, logText),
    ...(await runAiDrivenChecks(specText, logText, model)),
  ];
  return { findings, compliance_score: computeScore(findings) };
}
