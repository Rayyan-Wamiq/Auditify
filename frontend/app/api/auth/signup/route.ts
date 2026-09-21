/**
 * `POST /api/auth/signup`
 *
 * Port of `backend/app/routers/auth.py#signup`: create the account with a
 * bcrypt-hashed password and log the user straight in (201 + token pair).
 */
import { NextResponse } from "next/server";

import { buildTokenResponse, findUserByEmail, type UserRow } from "@/lib/server/auth";
import { ensureSchema, newUuid, query, utcNowNaive } from "@/lib/server/db";
import { HttpError, handleRoute, readJsonBody } from "@/lib/server/http";
import { MAX_PASSWORD_BYTES, hashPassword, passwordByteLength } from "@/lib/server/security";
import { BodyValidator, validateEmail } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    const body = await readJsonBody(request);
    const validator = new BodyValidator(body);

    // Field-by-field, in declaration order, exactly like Pydantic.
    let email: string | undefined;
    const emailRaw = validator.requiredString("email", { maxLength: 320 });
    if (emailRaw !== undefined) {
      const normalised = validateEmail(emailRaw);
      if (normalised === null) {
        validator.addValueError("email", "Enter a valid email address.", emailRaw);
      } else {
        email = normalised;
      }
    }

    let password: string | undefined;
    const passwordRaw = validator.requiredString("password", { minLength: 8 });
    if (passwordRaw !== undefined) {
      if (passwordByteLength(passwordRaw) > MAX_PASSWORD_BYTES) {
        validator.addValueError(
          "password",
          `Password must be at most ${MAX_PASSWORD_BYTES} bytes long.`,
          passwordRaw
        );
      } else {
        password = passwordRaw;
      }
    }

    const fullNameRaw = validator.optionalString("full_name", { maxLength: 255 });
    validator.throwIfInvalid();

    await ensureSchema();

    if (await findUserByEmail(email as string)) {
      throw new HttpError(409, "An account with this email already exists.");
    }

    const user: UserRow = {
      id: newUuid(),
      email: email as string,
      hashed_password: hashPassword(password as string),
      full_name: (fullNameRaw ?? "").trim() || null,
      created_at: utcNowNaive(),
    };

    try {
      await query(
        `INSERT INTO users (id, email, hashed_password, full_name, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.id, user.email, user.hashed_password, user.full_name, user.created_at]
      );
    } catch (error) {
      // Two concurrent signups for the same address: the unique index wins.
      if ((error as { code?: string } | null)?.code === "23505") {
        throw new HttpError(409, "An account with this email already exists.");
      }
      throw error;
    }

    return NextResponse.json(await buildTokenResponse(user), { status: 201 });
  });
}
