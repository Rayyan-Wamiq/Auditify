/**
 * Bearer-token authentication helpers.
 *
 * TypeScript port of the relevant parts of `backend/app/routers/auth.py`:
 * `get_current_user` (the FastAPI dependency), `_build_token_response`, and the
 * row -> payload mappers used by `/api/auth/me`, login, signup and refresh.
 */
import { accessTokenExpireSeconds } from "./config";
import { ensureSchema, query } from "./db";
import { unauthorized } from "./http";
import {
  ACCESS_TOKEN_TYPE,
  REFRESH_TOKEN_TYPE,
  TokenError,
  createAccessToken,
  createRefreshToken,
  decodeToken,
} from "./security";

/** Row shape of the `users` table (see `db/schema.sql`). */
export interface UserRow {
  id: string;
  email: string;
  hashed_password: string;
  full_name: string | null;
  created_at: string;
}

/** `UserOut` payload - never exposes the password hash. */
export interface UserOut {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
}

export function toUserOut(row: UserRow): UserOut {
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name ?? null,
    created_at: row.created_at,
  };
}

/** Extract a bearer token from the `Authorization` header (`HTTPBearer`). */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

export async function findUserById(userId: string): Promise<UserRow | null> {
  const rows = await query<UserRow>("SELECT * FROM users WHERE id = $1 LIMIT 1", [userId]);
  return rows[0] ?? null;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const rows = await query<UserRow>("SELECT * FROM users WHERE email = $1 LIMIT 1", [email]);
  return rows[0] ?? null;
}

/**
 * Resolve the caller from the bearer access token.
 *
 * Throws the same 401s as the FastAPI dependency so the dashboard's global
 * unauthorized flow behaves identically:
 *   * no/malformed header  -> "Not authenticated."
 *   * bad/expired token    -> the decode error text
 *   * unknown subject      -> "User no longer exists."
 */
export async function getCurrentUser(request: Request): Promise<UserRow> {
  await ensureSchema();

  const token = bearerToken(request);
  if (!token) {
    throw unauthorized("Not authenticated.");
  }

  let claims;
  try {
    claims = await decodeToken(token, ACCESS_TOKEN_TYPE);
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
  return user;
}

/** `TokenResponse` payload (access + refresh pair minted for the user). */
export interface TokenResponsePayload {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: UserOut;
}

/** `_build_token_response`: mint a fresh access + refresh pair for `user`. */
export async function buildTokenResponse(user: UserRow): Promise<TokenResponsePayload> {
  return {
    access_token: await createAccessToken(user.id),
    refresh_token: await createRefreshToken(user.id),
    token_type: "bearer",
    expires_in: accessTokenExpireSeconds,
    user: toUserOut(user),
  };
}
