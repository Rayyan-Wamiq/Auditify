/**
 * `GET /api/audit/dashboard-stats`
 *
 * Port of `backend/app/routers/audit.py#dashboard_stats`. Aggregates are
 * computed over the caller's rows only (same strict isolation as `/runs`).
 */
import { NextResponse } from "next/server";

import { dashboardStats } from "@/lib/server/audit/runs";
import { getCurrentUser } from "@/lib/server/auth";
import { ensureSchema } from "@/lib/server/db";
import { handleRoute } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    const user = await getCurrentUser(request);
    await ensureSchema();

    const stats = await dashboardStats(user.id);

    return NextResponse.json({
      total_runs: stats.total_runs,
      total_checks_executed: stats.total_checks_executed,
      average_compliance_score: stats.average_compliance_score,
      total_critical_violations: stats.total_critical_violations,
      total_logs_audited: stats.total_logs_audited,
      latest_run: stats.latest_run,
    });
  });
}
