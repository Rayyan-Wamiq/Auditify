-- =============================================================================
-- Auditify schema (PostgreSQL only)
--
-- Idempotent: every statement is safe to run repeatedly, on an existing
-- Supabase database or on a brand-new one. It is applied automatically by
-- `lib/server/db.ts#ensureSchema()` on the first API request (the equivalent of
-- the FastAPI `init_db()` startup hook) and can equally be pasted straight into
-- the Supabase SQL editor.
--
-- Table/enum names and column types match the SQLAlchemy models exactly, so an
-- existing deployment keeps its data and both runtimes stay interchangeable.
-- =============================================================================

-- Enum types (SQLAlchemy names them after the lowercase class name).
DO $$ BEGIN
    CREATE TYPE checkstatus AS ENUM ('PASS', 'FAIL', 'WARNING');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE checkseverity AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE checksource AS ENUM ('RULE_BASED', 'AI_DRIVEN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- -----------------------------------------------------------------------------
-- Users
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id              VARCHAR(36) PRIMARY KEY,
    email           VARCHAR(320) NOT NULL UNIQUE,
    hashed_password VARCHAR(255) NOT NULL,
    full_name       VARCHAR(255),
    created_at      TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS ix_users_email ON users (email);
CREATE INDEX IF NOT EXISTS ix_users_created_at ON users (created_at);

-- -----------------------------------------------------------------------------
-- Audit runs, findings and archived logs
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_runs (
    id                  VARCHAR(36) PRIMARY KEY,
    spec_filename       VARCHAR(512) NOT NULL,
    log_filename        VARCHAR(512) NOT NULL,
    model_used          VARCHAR(128) NOT NULL,
    user_id             VARCHAR(36) REFERENCES users (id) ON DELETE CASCADE,
    compliance_score    DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_checks        INTEGER NOT NULL DEFAULT 0,
    passed_checks       INTEGER NOT NULL DEFAULT 0,
    failed_checks       INTEGER NOT NULL DEFAULT 0,
    warning_checks      INTEGER NOT NULL DEFAULT 0,
    critical_violations INTEGER NOT NULL DEFAULT 0,
    spec_char_count     INTEGER NOT NULL DEFAULT 0,
    log_char_count      INTEGER NOT NULL DEFAULT 0,
    log_line_count      INTEGER NOT NULL DEFAULT 0,
    status              VARCHAR(32) NOT NULL DEFAULT 'COMPLETED',
    created_at          TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS ix_audit_runs_user_id ON audit_runs (user_id);
CREATE INDEX IF NOT EXISTS ix_audit_runs_created_at ON audit_runs (created_at);

CREATE TABLE IF NOT EXISTS audit_check_items (
    id              VARCHAR(36) PRIMARY KEY,
    run_id          VARCHAR(36) NOT NULL REFERENCES audit_runs (id),
    name            VARCHAR(256) NOT NULL,
    category        VARCHAR(128) NOT NULL DEFAULT 'General',
    status          checkstatus NOT NULL,
    severity        checkseverity NOT NULL,
    source          checksource NOT NULL,
    description     TEXT NOT NULL,
    evidence        TEXT,
    recommendation  TEXT NOT NULL,
    created_at      TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS ix_audit_check_items_run_id ON audit_check_items (run_id);

CREATE TABLE IF NOT EXISTS system_log_records (
    id          VARCHAR(36) PRIMARY KEY,
    run_id      VARCHAR(36) NOT NULL REFERENCES audit_runs (id),
    filename    VARCHAR(512) NOT NULL,
    content     TEXT NOT NULL,
    line_count  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS ix_system_log_records_run_id ON system_log_records (run_id);

-- -----------------------------------------------------------------------------
-- Legacy user-scoped audit summary (kept for compatibility, unused by the API)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audits (
    id               VARCHAR(36) PRIMARY KEY,
    user_id          VARCHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title            VARCHAR(256) NOT NULL,
    compliance_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    findings_summary TEXT,
    created_at       TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS ix_audits_user_id ON audits (user_id);
CREATE INDEX IF NOT EXISTS ix_audits_created_at ON audits (created_at);

-- -----------------------------------------------------------------------------
-- RAG chunk store
--
-- Replaces ChromaDB's local persistent collection. Chunks live in the database
-- so retrieval works on stateless serverless instances (no local files) and the
-- stored vectors travel with the deployment instead of a machine-local
-- `chroma_store/` directory.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spec_chunks (
    id                 VARCHAR(64) PRIMARY KEY,
    run_id             VARCHAR(36) NOT NULL REFERENCES audit_runs (id) ON DELETE CASCADE,
    filename           VARCHAR(512) NOT NULL,
    chunk_index        INTEGER NOT NULL,
    content            TEXT NOT NULL,
    embedding          JSONB,
    embedding_provider VARCHAR(64),
    created_at         TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS ix_spec_chunks_run_id ON spec_chunks (run_id);
