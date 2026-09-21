/**
 * Audit-run persistence.
 *
 * Replaces the SQLAlchemy queries in `backend/app/routers/audit.py`
 * (`/run`, `/runs`, `/runs/{id}`, `DELETE /runs/{id}`, `/dashboard-stats`) and
 * keeps the same strict per-user isolation: every query is pinned to the
 * authenticated user's rows, and legacy rows with a NULL `user_id` stay
 * invisible to everybody (no admin/public fallback).
 */
import type { PoolClient } from "pg";

import { newUuid, query, utcNowNaive, withTransaction } from "../db";
import { pythonRound, pythonSlice } from "../python-compat";
import type { Finding } from "./engine";

/** Row shape of `audit_runs`. */
export interface AuditRunRow {
  id: string;
  spec_filename: string;
  log_filename: string;
  model_used: string;
  compliance_score: number;
  total_checks: number;
  passed_checks: number;
  failed_checks: number;
  warning_checks: number;
  critical_violations: number;
  spec_char_count: number;
  log_char_count: number;
  log_line_count: number;
  status: string;
  created_at: string;
}

/** Row shape of `audit_check_items`. */
export interface AuditCheckItemRow {
  id: string;
  name: string;
  category: string;
  status: string;
  severity: string;
  source: string;
  description: string;
  evidence: string | null;
  recommendation: string;
  created_at: string;
}

export interface AuditRunDetailRow extends AuditRunRow {
  checks: AuditCheckItemRow[];
}

/** Columns returned by the list/detail endpoints (`AuditRunSummary`). */
const RUN_COLUMNS = `id, spec_filename, log_filename, model_used, compliance_score,
  total_checks, passed_checks, failed_checks, warning_checks, critical_violations,
  status, created_at`;

const CHECK_COLUMNS = `id, name, category, status, severity, source, description,
  evidence, recommendation, created_at`;

/** Whitelisted sort columns (`SORTABLE_FIELDS`). */
export const SORTABLE_FIELDS = new Set([
  "created_at",
  "compliance_score",
  "critical_violations",
  "total_checks",
]);

export interface ListRunsFilters {
  status?: string;
  minScore?: number;
  maxScore?: number;
  sortBy: string;
  sortDir: "asc" | "desc";
  limit: number;
  offset: number;
}

export interface CreateRunInput {
  userId: string;
  specFilename: string;
  logFilename: string;
  modelUsed: string;
  complianceScore: number;
  specCharCount: number;
  logCharCount: number;
  logLineCount: number;
  findings: Finding[];
  logText: string;
}

/**
 * Insert a run with its findings and archived log inside one transaction
 * (the ORM's `db.add(...)` + `db.commit()`), returning the persisted run row.
 */
export async function createRun(input: CreateRunInput): Promise<AuditRunRow> {
  const passed = input.findings.filter((f) => f.status === "PASS").length;
  const failed = input.findings.filter((f) => f.status === "FAIL").length;
  const warned = input.findings.filter((f) => f.status === "WARNING").length;
  const critical = input.findings.filter(
    (f) => f.status === "FAIL" && f.severity === "CRITICAL"
  ).length;

  const runId = newUuid();
  const createdAt = utcNowNaive();

  await withTransaction(async (client: PoolClient) => {
    await client.query(
      `INSERT INTO audit_runs
         (id, user_id, spec_filename, log_filename, model_used, compliance_score,
          total_checks, passed_checks, failed_checks, warning_checks, critical_violations,
          spec_char_count, log_char_count, log_line_count, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        runId,
        input.userId,
        input.specFilename,
        input.logFilename,
        input.modelUsed,
        input.complianceScore,
        input.findings.length,
        passed,
        failed,
        warned,
        critical,
        input.specCharCount,
        input.logCharCount,
        input.logLineCount,
        "COMPLETED",
        createdAt,
      ]
    );

    for (const finding of input.findings) {
      await client.query(
        `INSERT INTO audit_check_items
           (id, run_id, name, category, status, severity, source, description,
            evidence, recommendation, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          newUuid(),
          runId,
          finding.name,
          finding.category,
          finding.status,
          finding.severity,
          finding.source,
          finding.description,
          finding.evidence ?? "",
          finding.recommendation,
          createdAt,
        ]
      );
    }

    await client.query(
      `INSERT INTO system_log_records (id, run_id, filename, content, line_count, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        newUuid(),
        runId,
        input.logFilename,
        // Archived log content is capped exactly like the Python slice [:200_000].
        pythonSlice(input.logText, 0, 200_000),
        input.logLineCount,
        createdAt,
      ]
    );
  });

  const rows = await query<AuditRunRow>(
    `SELECT ${RUN_COLUMNS} FROM audit_runs WHERE id = $1`,
    [runId]
  );
  return rows[0];
}

/** `GET /runs` - filtered, sorted, paginated list, pinned to the caller. */
export async function listRuns(
  userId: string,
  filters: ListRunsFilters
): Promise<{ total: number; runs: AuditRunRow[] }> {
  const conditions = ["user_id = $1"];
  const params: unknown[] = [userId];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filters.minScore !== undefined) {
    params.push(filters.minScore);
    conditions.push(`compliance_score >= $${params.length}`);
  }
  if (filters.maxScore !== undefined) {
    params.push(filters.maxScore);
    conditions.push(`compliance_score <= $${params.length}`);
  }

  const where = conditions.join(" AND ");
  const totalRows = await query<{ total: string }>(
    `SELECT COUNT(*) AS total FROM audit_runs WHERE ${where}`,
    params
  );
  const total = Number.parseInt(totalRows[0]?.total ?? "0", 10);

  // Column and direction are never interpolated from raw user input: the sorts
  // are whitelisted and the direction is a literal chosen by a strict comparison.
  const sortColumn = SORTABLE_FIELDS.has(filters.sortBy) ? filters.sortBy : "created_at";
  const direction = filters.sortDir === "asc" ? "ASC" : "DESC";

  const rows = await query<AuditRunRow>(
    `SELECT ${RUN_COLUMNS} FROM audit_runs WHERE ${where}
     ORDER BY ${sortColumn} ${direction}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, filters.limit, filters.offset]
  );

  return { total, runs: rows };
}

/**
 * `GET /runs/{run_id}` - detail payload for one owned run, or `null` when the
 * run is missing *or* belongs to somebody else (so ids cannot be probed).
 */
export async function getRunDetail(
  userId: string,
  runId: string
): Promise<AuditRunDetailRow | null> {
  const rows = await query<AuditRunRow>(
    `SELECT ${RUN_COLUMNS}, spec_char_count, log_char_count, log_line_count
       FROM audit_runs WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [runId, userId]
  );
  const run = rows[0] as AuditRunRow | undefined;
  if (!run) return null;

  const checks = await query<AuditCheckItemRow>(
    `SELECT ${CHECK_COLUMNS} FROM audit_check_items WHERE run_id = $1 ORDER BY created_at`,
    [runId]
  );

  // Field order mirrors the Pydantic `AuditRunDetail` payload exactly.
  return {
    id: run.id,
    spec_filename: run.spec_filename,
    log_filename: run.log_filename,
    model_used: run.model_used,
    compliance_score: run.compliance_score,
    total_checks: run.total_checks,
    passed_checks: run.passed_checks,
    failed_checks: run.failed_checks,
    warning_checks: run.warning_checks,
    critical_violations: run.critical_violations,
    status: run.status,
    created_at: run.created_at,
    spec_char_count: run.spec_char_count,
    log_char_count: run.log_char_count,
    log_line_count: run.log_line_count,
    checks,
  };
}

/** `DELETE /runs/{run_id}` - returns false when nothing owned matched. */
export async function deleteRun(userId: string, runId: string): Promise<boolean> {
  return withTransaction(async (client) => {
    const owned = await client.query(
      "SELECT id FROM audit_runs WHERE id = $1 AND user_id = $2 LIMIT 1",
      [runId, userId]
    );
    if (owned.rowCount === 0) return false;

    // Explicit child cleanup (the ORM's `cascade="all, delete-orphan"`); the
    // spec_chunks FK also cascades, but deleting here keeps the order obvious.
    await client.query("DELETE FROM audit_check_items WHERE run_id = $1", [runId]);
    await client.query("DELETE FROM system_log_records WHERE run_id = $1", [runId]);
    await client.query("DELETE FROM spec_chunks WHERE run_id = $1", [runId]);
    await client.query("DELETE FROM audit_runs WHERE id = $1", [runId]);
    return true;
  });
}

export interface DashboardStatsPayload {
  total_runs: number;
  total_checks_executed: number;
  average_compliance_score: number;
  total_critical_violations: number;
  total_logs_audited: number;
  latest_run: AuditRunRow | null;
}

/** `GET /dashboard-stats` - aggregates over the caller's runs only. */
export async function dashboardStats(userId: string): Promise<DashboardStatsPayload> {
  const [totals] = await query<{
    total_runs: string;
    total_checks: string | null;
    avg_score: string | null;
    total_critical: string | null;
    total_logs: string | null;
  }>(
    `SELECT COUNT(id) AS total_runs,
            COALESCE(SUM(total_checks), 0) AS total_checks,
            COALESCE(AVG(compliance_score), 0) AS avg_score,
            COALESCE(SUM(critical_violations), 0) AS total_critical,
            COALESCE(SUM(log_line_count), 0) AS total_logs
       FROM audit_runs WHERE user_id = $1`,
    [userId]
  );

  const latest = await query<AuditRunRow>(
    `SELECT ${RUN_COLUMNS} FROM audit_runs WHERE user_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );

  return {
    total_runs: Number.parseInt(totals?.total_runs ?? "0", 10),
    total_checks_executed: Math.trunc(Number(totals?.total_checks ?? 0)),
    average_compliance_score: pythonRound(Number(totals?.avg_score ?? 0), 1),
    total_critical_violations: Math.trunc(Number(totals?.total_critical ?? 0)),
    total_logs_audited: Math.trunc(Number(totals?.total_logs ?? 0)),
    latest_run: latest[0] ?? null,
  };
}
