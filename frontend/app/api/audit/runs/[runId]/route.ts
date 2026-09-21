/**
 * `GET|DELETE /api/audit/runs/{run_id}`
 *
 * Port of `backend/app/routers/audit.py#get_run_detail` and `#delete_run`. Both
 * answer with the same 404 for "missing" and "not yours", so run ids cannot be
 * probed by an authenticated user.
 */
import { NextResponse } from "next/server";

import { deleteRun, getRunDetail } from "@/lib/server/audit/runs";
import { getCurrentUser } from "@/lib/server/auth";
import { ensureSchema } from "@/lib/server/db";
import { HttpError, handleRoute } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { runId: string };
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  return handleRoute(async () => {
    const user = await getCurrentUser(request);
    await ensureSchema();

    const detail = await getRunDetail(user.id, context.params.runId);
    if (!detail) {
      throw new HttpError(404, "Audit run not found.");
    }
    return NextResponse.json(detail);
  });
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  return handleRoute(async () => {
    const user = await getCurrentUser(request);
    await ensureSchema();

    const deleted = await deleteRun(user.id, context.params.runId);
    if (!deleted) {
      throw new HttpError(404, "Audit run not found.");
    }
    // `status_code=204` -> empty body, which the dashboard's API layer treats
    // as "no JSON to parse".
    return new NextResponse(null, { status: 204 });
  });
}
