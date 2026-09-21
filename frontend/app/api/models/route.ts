/**
 * `GET /api/models`
 *
 * Port of `backend/app/routers/models.py#list_models`. Public (no auth), exactly
 * like the FastAPI route, so the model selector can render before login.
 */
import { NextResponse } from "next/server";

import { handleRoute } from "@/lib/server/http";
import { SUPPORTED_MODELS, configuredDefaultModel } from "@/lib/server/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return handleRoute(async () =>
    NextResponse.json({
      models: SUPPORTED_MODELS,
      default_model: configuredDefaultModel(),
    })
  );
}
