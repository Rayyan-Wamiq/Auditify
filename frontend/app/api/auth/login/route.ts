/**
 * `POST /api/auth/login`
 *
 * Port of `backend/app/routers/auth.py#login`. A missing account and a wrong
 * password produce the same 401 so the endpoint cannot be used to enumerate
 * which emails are registered.
 */
import { NextResponse } from "next/server";

import { buildTokenResponse, findUserByEmail } from "@/lib/server/auth";
import { ensureSchema } from "@/lib/server/db";
import { handleRoute, readJsonBody, unauthorized } from "@/lib/server/http";
import { verifyPassword } from "@/lib/server/security";
import { BodyValidator } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    const body = await readJsonBody(request);
    const validator = new BodyValidator(body);

    const emailRaw = validator.requiredString("email", { maxLength: 320 });
    const password = validator.requiredString("password", { minLength: 1 });
    validator.throwIfInvalid();

    await ensureSchema();

    // Only normalised here: a malformed address simply will not match any user,
    // and the endpoint answers with a uniform 401 rather than a 422.
    const email = (emailRaw ?? "").trim().toLowerCase();
    const user = await findUserByEmail(email);

    if (!user || !verifyPassword(password as string, user.hashed_password)) {
      throw unauthorized("Incorrect email or password.");
    }

    return NextResponse.json(await buildTokenResponse(user));
  });
}
