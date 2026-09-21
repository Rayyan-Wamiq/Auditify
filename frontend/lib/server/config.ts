/**
 * Server-side configuration.
 *
 * TypeScript port of `backend/app/config.py`. Every value is sourced from
 * environment variables so the same deployment artifact can be promoted
 * across environments without code changes.
 *
 * SECURITY: none of these values may ever be exposed through a
 * `NEXT_PUBLIC_*` variable, and this module must only be imported from
 * server components / route handlers (it is never bundled into client code).
 */

/** Development-only placeholder, mirrors `Settings.SECRET_KEY` in the backend. */
export const DEFAULT_SECRET_KEY = "dev-only-insecure-change-me-in-env";

function intEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export const settings = {
  // --- Database ---------------------------------------------------------
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql+psycopg2://auditify:auditify@localhost:5432/auditify",
  dbPoolSize: intEnv(process.env.DB_POOL_SIZE, 3),
  dbPoolTimeout: intEnv(process.env.DB_POOL_TIMEOUT, 30),
  dbPoolRecycle: intEnv(process.env.DB_POOL_RECYCLE, 1800),

  // --- LLM / RAG --------------------------------------------------------
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  defaultGroqModel: process.env.DEFAULT_GROQ_MODEL ?? "openai/gpt-oss-120b",
  /** Optional override for the Groq-compatible chat-completions endpoint. */
  groqApiBaseUrl: (
    process.env.GROQ_API_URL ?? "https://api.groq.com/openai/v1"
  ).replace(/\/+$/, ""),
  /** Hard ceiling for a single upstream LLM call (serverless request budget). */
  groqRequestTimeoutSeconds: intEnv(process.env.GROQ_TIMEOUT_SECONDS, 55),

  // --- Optional remote embedding provider (RAG) -------------------------
  // When unset (the default) retrieval uses the deterministic, dependency-free
  // lexical embedder in `lib/server/rag/embeddings.ts`.
  embeddingApiKey: process.env.EMBEDDING_API_KEY ?? "",
  embeddingApiUrl: process.env.EMBEDDING_API_URL ?? "",
  embeddingModel: process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
  embeddingDimensions: intEnv(process.env.EMBEDDING_DIMENSIONS, 512),

  // --- Auth / JWT -------------------------------------------------------
  secretKey: process.env.SECRET_KEY ?? DEFAULT_SECRET_KEY,
  jwtAlgorithm: "HS256",
  accessTokenExpireMinutes: intEnv(process.env.ACCESS_TOKEN_EXPIRE_MINUTES, 30),
  refreshTokenExpireDays: intEnv(process.env.REFRESH_TOKEN_EXPIRE_DAYS, 7),

  // --- App --------------------------------------------------------------
  maxUploadMb: intEnv(process.env.MAX_UPLOAD_MB, 15),
  appName:
    process.env.APP_NAME ?? "Auditify - AI Technical Audit & Compliance Engine",
} as const;

/** True when `SECRET_KEY` was never overridden (unsafe for production). */
export const isDefaultSecretKey = settings.secretKey === DEFAULT_SECRET_KEY;

/** Access-token lifetime in seconds, as returned by `TokenResponse.expires_in`. */
export const accessTokenExpireSeconds = settings.accessTokenExpireMinutes * 60;

/** Per-file upload ceiling in bytes. */
export const maxUploadBytes = settings.maxUploadMb * 1024 * 1024;

/**
 * `true` when the Groq API key is configured. Mirrors the backend's
 * `if not settings.GROQ_API_KEY` guards so both AI passes degrade identically.
 */
export const groqConfigured = settings.groqApiKey.trim().length > 0;
