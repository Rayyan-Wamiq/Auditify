/**
 * `GET /api/auth/me`
 *
 * Port of `backend/app/routers/auth.py#me` - resolves the bearer access token to
 * the current user (`UserOut`, never the password hash).
 */
import { NextResponse } from "next/server";

import { getCurrentUser, toUserOut } from "@/lib/server/auth";
import { handleRoute } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    const user = await getCurrentUser(request);
    return NextResponse.json(toUserOut(user));
  });
}
