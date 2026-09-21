/**
 * `GET /api/audit/runs`
 *
 * Port of `backend/app/routers/audit.py#list_runs`: the caller's runs with the
 * same filters, sort whitelist, ordering and pagination defaults
 * (`limit=50`, `offset=0`, `sort_by=created_at`, `sort_dir=desc`), and the same
 * FastAPI-style 422 envelope when a query parameter is out of range.
 */
import { NextResponse } from "next/server";

import { listRuns, type ListRunsFilters } from "@/lib/server/audit/runs";
import { getCurrentUser } from "@/lib/server/auth";
import { ensureSchema } from "@/lib/server/db";
import { HttpError, handleRoute, type ValidationErrorItem } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORT_DIR_PATTERN = "^(asc|desc)$";

/** Parse and validate the query string the way FastAPI's `Query(...)` does. */
function parseListFilters(searchParams: URLSearchParams): ListRunsFilters {
  const errors: ValidationErrorItem[] = [];

  const intParam = (
    name: string,
    fallback: number,
    min: number,
    max?: number
  ): number => {
    const raw = searchParams.get(name);
    if (raw === null || raw === "") return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed) || !/^[+-]?\d+$/.test(raw.trim())) {
      errors.push({
        type: "int_parsing",
        loc: ["query", name],
        msg: "Input should be a valid integer, unable to parse string as an integer",
        input: raw,
      });
      return fallback;
    }
    if (parsed < min) {
      errors.push({
        type: "greater_than_equal",
        loc: ["query", name],
        msg: `Input should be greater than or equal to ${min}`,
        input: raw,
        ctx: { ge: min },
      });
      return fallback;
    }
    if (max !== undefined && parsed > max) {
      errors.push({
        type: "less_than_equal",
        loc: ["query", name],
        msg: `Input should be less than or equal to ${max}`,
        input: raw,
        ctx: { le: max },
      });
      return fallback;
    }
    return parsed;
  };

  const floatParam = (name: string): number | undefined => {
    const raw = searchParams.get(name);
    if (raw === null || raw === "") return undefined;
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) {
      errors.push({
        type: "float_parsing",
        loc: ["query", name],
        msg: "Input should be a valid number, unable to parse string as a number",
        input: raw,
      });
      return undefined;
    }
    return parsed;
  };

  const sortDir = searchParams.get("sort_dir") ?? "desc";
  if (!/^(asc|desc)$/.test(sortDir)) {
    errors.push({
      type: "string_pattern_mismatch",
      loc: ["query", "sort_dir"],
      msg: `String should match pattern '${SORT_DIR_PATTERN}'`,
      input: sortDir,
      ctx: { pattern: SORT_DIR_PATTERN },
    });
  }

  const filters: ListRunsFilters = {
    status: searchParams.get("status") || undefined,
    minScore: floatParam("min_score"),
    maxScore: floatParam("max_score"),
    sortBy: searchParams.get("sort_by") || "created_at",
    sortDir: sortDir === "asc" ? "asc" : "desc",
    limit: intParam("limit", 50, 1, 200),
    offset: intParam("offset", 0, 0),
  };

  if (errors.length > 0) {
    throw new HttpError(422, errors);
  }
  return filters;
}

export async function GET(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    const user = await getCurrentUser(request);
    await ensureSchema();

    const filters = parseListFilters(new URL(request.url).searchParams);
    const { total, runs } = await listRuns(user.id, filters);

    return NextResponse.json({ total, runs });
  });
}
