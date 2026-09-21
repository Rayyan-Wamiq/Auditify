/**
 * PostgreSQL access layer (node-postgres).
 *
 * Replaces the SQLAlchemy engine/session in `backend/app/core/database.py`.
 * The application stays PostgreSQL-only: SQLite and every other scheme are
 * rejected with the same reasoning as the Python implementation, so a stray
 * local file URL can never silently run against a throwaway database.
 *
 * Tunables keep their original environment names (`DB_POOL_SIZE`,
 * `DB_POOL_TIMEOUT`, `DB_POOL_RECYCLE`) and are mapped onto the matching `pg`
 * pool options.
 */
import { Pool, type PoolClient, type QueryResultRow, types } from "pg";

import SCHEMA_SQL from "@/db/schema.sql";

import { settings } from "./config";

// --- Type parsing -----------------------------------------------------------
// SQLAlchemy's `DateTime` maps to PostgreSQL `timestamp without time zone`,
// holding naive UTC values. Pydantic serialises those as "YYYY-MM-DDTHH:MM:SS",
// so the raw string is returned with the separating space swapped for a "T"
// instead of letting node-postgres reinterpret it in the server's local zone.
// The result is byte-identical to the FastAPI payloads the dashboard expects.
types.setTypeParser(1114, (value: string) => value.replace(" ", "T"));

/** Hosts that are always reached over a plain TCP connection. */
const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "db",
  "host.docker.internal",
]);

/**
 * Normalise a connection string for node-postgres.
 *
 * `postgresql+psycopg2://` / `postgresql+asyncpg://` (valid SQLAlchemy URLs, and
 * exactly what `backend/.env` contains) are accepted by stripping the dialect
 * suffix, so one `DATABASE_URL` works for both runtimes.
 */
function normaliseConnectionString(raw: string): { connectionString: string; ssl: boolean } {
  const trimmed = raw.trim();
  const withoutDialect = trimmed.replace(/^(postgres(?:ql)?)\+\w+:\/\//i, "$1://");

  if (!/^postgres(ql)?:\/\//i.test(withoutDialect)) {
    const scheme = withoutDialect.split(":")[0] || "unknown";
    throw new Error(
      `Unsupported DATABASE_URL scheme '${scheme}'. Auditify runs on PostgreSQL only ` +
        "(Supabase in production). Set DATABASE_URL to a postgresql:// connection " +
        "string (Supabase Dashboard -> Project Settings -> Database -> Connection string)."
    );
  }

  let host = "";
  let sslMode: string | null = null;
  let url: URL | null = null;
  try {
    url = new URL(withoutDialect);
    host = url.hostname;
    sslMode = url.searchParams.get("sslmode");
    // node-postgres resolves `sslmode` itself; it is handled explicitly below so
    // the two settings can never disagree.
    url.searchParams.delete("sslmode");
  } catch {
    // Unparseable URL: let node-postgres report the detailed error.
  }

  const ssl = sslMode === "disable" ? false : sslMode ? true : !LOCAL_HOSTS.has(host);
  return { connectionString: url ? url.toString() : withoutDialect, ssl };
}

/** `DATABASE_URL` with the password masked - safe to log or surface in errors. */
export function safeDatabaseUrl(): string {
  try {
    return new URL(settings.databaseUrl.replace(/^(postgres(?:ql)?)\+\w+:\/\//i, "$1://"))
      .toString()
      .replace(/:\/\/([^:/@]+):[^@]*@/, "://$1:***@");
  } catch {
    return "<unparseable DATABASE_URL>";
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __auditifyPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __auditifySchemaReady: Promise<void> | undefined;
}

/** Process-wide pool, cached on `globalThis` so dev-server HMR cannot leak pools. */
export function getPool(): Pool {
  if (!globalThis.__auditifyPool) {
    const { connectionString, ssl } = normaliseConnectionString(settings.databaseUrl);
    globalThis.__auditifyPool = new Pool({
      connectionString,
      ssl,
      // Serverless-friendly defaults: managed Postgres (Supabase/Neon) closes
      // idle connections aggressively and each instance serves one request at a
      // time, so a small pool with a short idle timeout is the safe choice.
      max: Math.max(1, Math.min(settings.dbPoolSize, 10)),
      idleTimeoutMillis: Math.min(settings.dbPoolRecycle, 60) * 1000,
      connectionTimeoutMillis: settings.dbPoolTimeout * 1000,
      allowExitOnIdle: true,
    });
    globalThis.__auditifyPool.on("error", (error: Error) => {
      console.error("[auditify] idle PostgreSQL client error:", error.message);
    });
  }
  return globalThis.__auditifyPool;
}

/** Run a parameterised query and return its rows. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await getPool().query<T>(sql, params as never[]);
  return result.rows;
}

/** Run `fn` inside a transaction, rolling back on any thrown error. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The connection is already broken; the original error is what matters.
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Apply `db/schema.sql` once per process - the serverless equivalent of the
 * FastAPI `init_db()` startup hook. Never fatal: the schema may already exist,
 * or the role may lack DDL rights, and requests must still be served. The memo
 * is cleared on failure so a later request retries.
 */
export function ensureSchema(): Promise<void> {
  if (!globalThis.__auditifySchemaReady) {
    globalThis.__auditifySchemaReady = query(SCHEMA_SQL)
      .then(() => undefined)
      .catch((error: unknown) => {
        globalThis.__auditifySchemaReady = undefined;
        console.error(
          `[auditify] schema bootstrap failed at ${safeDatabaseUrl()}:`,
          error instanceof Error ? error.message : error
        );
      });
  }
  return globalThis.__auditifySchemaReady;
}

/** `datetime.utcnow()` as a naive UTC string for `timestamp without time zone`. */
export function utcNowNaive(date: Date = new Date()): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

/** `app.models.utils.new_uuid()` - a UUID4 primary key generated client-side. */
export function newUuid(): string {
  return globalThis.crypto.randomUUID();
}
