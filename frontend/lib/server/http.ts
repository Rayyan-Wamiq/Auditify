/**
 * HTTP helpers that reproduce FastAPI's response contract exactly.
 *
 * The dashboard's API layer (`frontend/lib/api.ts`) reads failures from
 * `body.detail` and special-cases `401` / `204` / `201`, so every handler in
 * this app answers with:
 *   * errors      -> `{ "detail": <string | ValidationErrorItem[]> }`
 *   * 401         -> `{ "detail": "..." }` + `WWW-Authenticate: Bearer`
 *   * validation  -> `422` + a Pydantic-shaped error array
 */
import { NextResponse } from "next/server";

/** A FastAPI-style `HTTPException`: status + `detail` payload + optional headers. */
export class HttpError extends Error {
  readonly status: number;
  readonly detail: unknown;
  readonly headers?: Record<string, string>;

  constructor(status: number, detail: unknown, headers?: Record<string, string>) {
    super(typeof detail === "string" ? detail : JSON.stringify(detail));
    this.name = "HttpError";
    this.status = status;
    this.detail = detail;
    this.headers = headers;
  }
}

/** Pydantic v2 error item shape (`exc.errors()`). */
export interface ValidationErrorItem {
  type: string;
  loc: (string | number)[];
  msg: string;
  input?: unknown;
  ctx?: Record<string, unknown>;
}

/** `JSONResponse({"detail": ...}, status_code=...)`. */
export function detailResponse(
  status: number,
  detail: unknown,
  headers?: Record<string, string>
): NextResponse {
  return NextResponse.json({ detail }, { status, headers });
}

/** `HTTPException(401, detail, headers={"WWW-Authenticate": "Bearer"})`. */
export function unauthorized(detail: string): HttpError {
  return new HttpError(401, detail, { "WWW-Authenticate": "Bearer" });
}

/** `RequestValidationError` handler: 422 + the Pydantic error list. */
export function validationError(items: ValidationErrorItem[]): HttpError {
  return new HttpError(422, items);
}

/** Convenience for a single-field validation failure. */
export function fieldValidationError(
  loc: (string | number)[],
  msg: string,
  type: string,
  input?: unknown,
  ctx?: Record<string, unknown>
): HttpError {
  return validationError([{ type, loc, msg, input, ctx }]);
}

/**
 * Route wrapper: converts thrown `HttpError`s into the matching JSON response
 * and anything unexpected into FastAPI's unhandled-exception response
 * (`500 {"detail":"Internal Server Error"}`), logging the cause server-side.
 */
export async function handleRoute(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError) {
      return detailResponse(error.status, error.detail, error.headers);
    }
    console.error("[auditify] unhandled route error:", error);
    return detailResponse(500, "Internal Server Error");
  }
}

/**
 * Parse a JSON request body the way FastAPI does: a malformed or missing body
 * is a `422` with a Pydantic `json_invalid` error, never a `500`.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    throw fieldValidationError(["body"], "JSON decode error", "json_invalid");
  }
  if (!raw.trim()) {
    throw fieldValidationError(["body"], "JSON decode error", "json_invalid");
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw fieldValidationError(
      ["body"],
      "JSON decode error",
      "json_invalid",
      raw.slice(0, 64),
      { error: error instanceof Error ? error.message : String(error) }
    );
  }
}

/** `len(str)` in Python counts code points, `String#length` counts UTF-16 units. */
export function pythonLen(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

/** Subset of Python's `list` repr for `f"Allowed: {sorted({...})}"` messages. */
export function pythonListRepr(values: Iterable<string>): string {
  return `[${[...values].map((v) => `'${v}'`).join(", ")}]`;
}
