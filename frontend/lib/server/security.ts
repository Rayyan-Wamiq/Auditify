/**
 * Password hashing and JWT access/refresh token helpers.
 *
 * TypeScript port of `backend/app/core/security.py`:
 *   * bcrypt (work factor 12) via `bcryptjs`, byte-compatible with the hashes
 *     produced by passlib's bcrypt backend, so existing `users` rows keep
 *     working and hashes produced here verify on the Python side too.
 *   * Stateless HS256 JWTs carrying `sub`, `type` (`access` | `refresh`),
 *     `iat` and `exp` - the same claim set python-jose emits, so tokens are
 *     interchangeable between the two runtimes while both are deployed.
 */
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

import { settings } from "./config";

/** Token `type` claim values (a refresh token can never act as an access token). */
export const ACCESS_TOKEN_TYPE = "access";
export const REFRESH_TOKEN_TYPE = "refresh";

/** bcrypt only hashes the first 72 bytes of input; longer values are rejected. */
export const MAX_PASSWORD_BYTES = 72;

/** Raised where the backend raises `ValueError` inside the security helpers. */
export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenError";
  }
}

const secretKeyBytes = new TextEncoder().encode(settings.secretKey);

/** UTF-8 byte length, matching `len(password.encode("utf-8"))` in Python. */
export function passwordByteLength(password: string): number {
  let bytes = 0;
  for (const char of password) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** Raise when the password is unsuitable for bcrypt (see `validate_password_length`). */
export function validatePasswordLength(password: string): void {
  if (passwordByteLength(password) > MAX_PASSWORD_BYTES) {
    throw new TokenError(
      `Password must be at most ${MAX_PASSWORD_BYTES} bytes long ` +
        "(bcrypt ignores anything beyond that)."
    );
  }
}

/** Return the bcrypt hash of `password` (passlib's default work factor is 12). */
export function hashPassword(password: string): string {
  validatePasswordLength(password);
  return bcrypt.hashSync(password, 12);
}

/** Check `plainPassword` against a stored hash; never throws. */
export function verifyPassword(plainPassword: string, hashedPassword: string): boolean {
  if (!hashedPassword) return false;
  try {
    return bcrypt.compareSync(plainPassword, hashedPassword);
  } catch {
    // Malformed/corrupt hash in the database -> treat as a failed login.
    return false;
  }
}

async function createToken(
  subject: string,
  tokenType: string,
  expiresInSeconds: number
): Promise<string> {
  return new SignJWT({ type: tokenType })
    .setProtectedHeader({ alg: settings.jwtAlgorithm })
    .setSubject(String(subject))
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .sign(secretKeyBytes);
}

/** Short-lived token used to authorise API calls. */
export function createAccessToken(subject: string, expiresMinutes?: number): Promise<string> {
  const minutes = expiresMinutes ?? settings.accessTokenExpireMinutes;
  return createToken(subject, ACCESS_TOKEN_TYPE, minutes * 60);
}

/** Long-lived token whose only job is to mint new access tokens. */
export function createRefreshToken(subject: string, expiresDays?: number): Promise<string> {
  const days = expiresDays ?? settings.refreshTokenExpireDays;
  return createToken(subject, REFRESH_TOKEN_TYPE, days * 24 * 60 * 60);
}

export interface TokenClaims {
  sub: string;
  type?: string;
  iat?: number;
  exp?: number;
}

/**
 * Decode and validate a JWT.
 *
 * Throws `TokenError` when the token is malformed, expired, missing a subject,
 * or carries the wrong `type` claim - the same contract as `decode_token`.
 */
export async function decodeToken(
  token: string,
  expectedType?: string
): Promise<TokenClaims> {
  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(token, secretKeyBytes, {
      algorithms: [settings.jwtAlgorithm],
    });
    payload = verified.payload as Record<string, unknown>;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new TokenError(`Invalid or expired token (${reason}).`);
  }

  if (expectedType !== undefined && payload.type !== expectedType) {
    throw new TokenError(`Expected a ${expectedType} token.`);
  }

  const subject = payload.sub;
  if (typeof subject !== "string" || subject.length === 0) {
    throw new TokenError("Token is missing its subject.");
  }

  return {
    sub: subject,
    type: typeof payload.type === "string" ? payload.type : undefined,
    iat: typeof payload.iat === "number" ? payload.iat : undefined,
    exp: typeof payload.exp === "number" ? payload.exp : undefined,
  };
}
