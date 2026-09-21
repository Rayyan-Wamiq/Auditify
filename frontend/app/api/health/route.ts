/**
 * `GET /api/health`
 *
 * Port of the FastAPI `health_check` handler in `backend/app/main.py`.
 */
import { NextResponse } from "next/server";

import { settings } from "@/lib/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ status: "ok", service: settings.appName });
}
