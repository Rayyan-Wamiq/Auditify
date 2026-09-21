/**
 * `POST /api/auth/refresh`
 *
 * Port of `backend/app/routers/auth.py#refresh`: exchange a refresh token for a
 * new pair. Refresh tokens are rotated (single-use), so a stolen token stops
 * working as soon as the legitimate client refreshes.
 */
import { NextResponse } from "next/server";

import { buildTokenResponse, findUserById } from "@/lib/server/auth";
import { ensureSchema } from "@/lib/server/db";
import { handleRoute, readJsonBody, unauthorized } from "@/lib/server/http";
import { REFRESH_TOKEN_TYPE, TokenError, decodeToken } from "@/lib/server/security";
import { BodyValidator } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    const body = await readJsonBody(request);
    const validator = new BodyValidator(body);
    const refreshToken = validator.requiredString("refresh_token", { minLength: 1 });
    validator.throwIfInvalid();

    await ensureSchema();

    let claims;
    try {
      claims = await decodeToken(refreshToken as string, REFRESH_TOKEN_TYPE);
    } catch (error) {
      if (error instanceof TokenError) {
        throw unauthorized(error.message);
      }
      throw error;
    }

    const user = await findUserById(claims.sub);
    if (!user) {
      throw unauthorized("User no longer exists.");
    }

    return NextResponse.json(await buildTokenResponse(user));
  });
}
