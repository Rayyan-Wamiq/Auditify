# Auditify — AI Technical Audit & Compliance Engine

Auditify ingests a specification/SOP document alongside a system execution
log, runs a hybrid rule-based + LLM-driven compliance audit, scores the
posture, and surfaces itemized violations in an enterprise dashboard —
plus a RAG-powered AI Copilot for follow-up questions grounded in your
uploaded documents.

## Architecture

```
auditify/
├── frontend/                  The whole application (Next.js 14 App Router)
│   ├── app/
│   │   ├── page.tsx           Dashboard (audit trail, KPIs, upload + copilot)
│   │   ├── login/page.tsx     Sign-in / sign-up
│   │   └── api/               REST API — the former FastAPI app, as route handlers
│   │       ├── auth/          signup, login, refresh, me        (bcrypt + HS256 JWT)
│   │       ├── audit/         run, runs, runs/[runId], runs/[runId]/export,
│   │       │                  dashboard-stats
│   │       ├── chat/          RAG copilot
│   │       ├── models/        Pinned Groq model registry
│   │       └── health/
│   ├── db/schema.sql          PostgreSQL schema (idempotent, auto-applied)
│   ├── components/            Header, UploadPanel, ComplianceGauge, StatsCards,
│   │                          AuditTable, RunDetailPanel, ChatDrawer, ModelSelector,
│   │                          ProfileSection, AuthProvider
│   └── lib/
│       ├── api.ts, types.ts   Typed browser client (relative /api calls)
│       └── server/            Server-only implementation
│           ├── config.ts      Env-driven settings
│           ├── db.ts          node-postgres pool + schema bootstrap
│           ├── security.ts    bcrypt hashing + HS256 access/refresh JWTs
│           ├── auth.ts        Bearer-token resolution, token responses
│           ├── http.ts        FastAPI-compatible JSON/error envelopes
│           ├── validation.ts  Pydantic-shaped request validation
│           ├── models.ts      Pinned Groq model + resolve_model()
│           ├── groq.ts        Chat-completions client (fetch)
│           ├── audit/         engine.ts, parser.ts, pdf.ts, runs.ts
│           └── rag/           service.ts, store.ts, embeddings.ts, prompt.ts
├── tools/parity/              Python ⇄ TypeScript drift harness (see its README)
└── backend/                   Legacy FastAPI service — see backend/DEPRECATED.md
```

## Deployment model

The API and the UI ship as **one Next.js project**, so a single Vercel project
(on the free tier) serves everything — there is no second service to host, no
container registry and no Python runtime in production.


## Prerequisites

- Node.js 18.18+ (20 recommended)
- PostgreSQL 14+ (Supabase in production — SQLite is **not** supported)
- A [Groq API key](https://console.groq.com/keys) (optional — the app runs
  with rule-based checks only if omitted, degrading gracefully)
- Python 3.11+ — **only** to run the legacy service or the parity harness in
  `tools/parity/`; it is not needed to build, run or deploy the app

## Local setup

```bash
cd frontend
npm install
cp .env.local.example .env.local   # then edit DATABASE_URL / GROQ_API_KEY / SECRET_KEY
npm run dev                        # http://localhost:3000
```

`frontend/.env.local` is git-ignored because it holds real credentials; only
`.env.local.example` is tracked. The schema in `frontend/db/schema.sql` is
applied automatically by the first API request (idempotent
`CREATE TABLE IF NOT EXISTS`), so a fresh database needs no manual migration.

> One PostgreSQL requirement is unchanged: use the Supabase connection
> **pooler** host (`postgres.<project-ref>@aws-0-<region>.pooler.supabase.com`)
> when the direct `db.<project-ref>.supabase.co` host is IPv6-only and your
> network has no IPv6 route. Serverless deployments should use the transaction
> pooler on port `6543`.

> Do **not** set `NEXT_PUBLIC_API_BASE_URL` unless you deliberately want
> `/api/*` proxied to an external backend (e.g. the legacy FastAPI service).
> When it is set, requests are forwarded there instead of being served by the
> route handlers — and because Next.js bakes rewrites into the build manifest,
> changing it requires a rebuild/redeploy.

## Deploying to Vercel (free tier)

1. Import the repository and set **Root Directory = `frontend`** (the framework
   is auto-detected as Next.js). No build or output overrides are needed:
   `next build` produces the UI *and* the API.
2. Add the variables from the table below under *Settings → Environment
   Variables* (Production, Preview and Development) as encrypted values.
   Nothing secret belongs in the repository.
3. Deploy, then confirm `https://<project>.vercel.app/api/health` returns
   `{"status":"ok","service":"Auditify - AI Technical Audit & Compliance Engine"}`.
4. Point `DATABASE_URL` at the Supabase pooler and allow Vercel's egress in
   Supabase (**Project Settings → Database → Network Restrictions**).
5. `POST /api/audit/run` and `POST /api/chat` each make one synchronous Groq
   call and declare `maxDuration = 60`. Keep `GROQ_TIMEOUT_SECONDS` below that
   budget so a slow model fails with a readable error instead of a platform
   timeout.

## Environment variables (`frontend/.env.local`)

Server-side values are read by the route handlers. Only `NEXT_PUBLIC_*`
variables are ever exposed to the browser.

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string — **PostgreSQL only** (Supabase or local Postgres). `postgresql+psycopg2://…` is accepted too (the SQLAlchemy dialect suffix is stripped, so the same value works for both runtimes) | `postgresql+psycopg2://auditify:auditify@localhost:5432/auditify` |
| `GROQ_API_KEY` | Groq API key for the AI-driven audit pass + copilot | *(empty — rule-based checks only)* |
| `DEFAULT_GROQ_MODEL` | Default model id (pinned; only `openai/gpt-oss-120b` is supported) | `openai/gpt-oss-120b` |
| `GROQ_TIMEOUT_SECONDS` | Per-request ceiling for a single Groq call (keep below the `maxDuration = 60` route budget) | `55` |
| `MAX_UPLOAD_MB` | Max per-file upload size | `15` |
| `SECRET_KEY` | HMAC key used to sign JWT access/refresh tokens — **set a random value per environment** (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`) | insecure dev-only placeholder |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Access-token lifetime in minutes | `30` |
| `REFRESH_TOKEN_EXPIRE_DAYS` | Refresh-token lifetime in days | `7` |
| `EMBEDDING_API_KEY`, `EMBEDDING_API_URL` | Optional OpenAI-compatible embeddings endpoint for the copilot. Unset → the built-in deterministic lexical embedder, with no external calls | *(unset)* |
| `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` | Embedding model id and vector size for the provider above | `text-embedding-3-small`, `512` |
| `DB_POOL_SIZE`, `DB_POOL_TIMEOUT`, `DB_POOL_RECYCLE` | node-postgres pool tuning (deliberately small for serverless) | `3`, `30`, `1800` |
| `NEXT_PUBLIC_API_BASE_URL` | Optional: proxy `/api/*` to an external backend instead of serving it in-app | *(unset)* |

> `CORS_ORIGINS` is gone: the API is same-origin with the UI, so no CORS
> middleware is needed. A cross-origin client would need the header added
> explicitly in the route handlers.

> **Never commit `frontend/.env.local` (or `backend/.env`).** Both are
> git-ignored; only the `.example` templates belong in the repository.

## Core flows

1. **Run an audit** — upload a spec document and an execution log from the
   dashboard's "Run New Audit" panel. The API parses both files, runs
   deterministic rule-based checks (control coverage, secret leakage,
   error-rate analysis, documentation completeness) plus an AI-driven pass
   via Groq, merges the findings, computes a weighted compliance score, and
   persists everything to Postgres.
2. **Review findings** — select any run from the Audit Trail table to see
   its itemized findings (status, severity, source, evidence, remediation).
3. **Export a report** — click "PDF" on any row to download the A4 audit report
   generated server-side with `pdf-lib` (same layout, palette, badges, column
   widths and page footers the ReportLab version produced).
4. **Ask the Copilot** — open the floating AI Copilot drawer to ask
   questions; the API retrieves the most relevant chunks of your uploaded spec
   documents from the `spec_chunks` table and answers via Groq, rendered as rich
   Markdown.

## RAG retrieval: what changed and why

ChromaDB cannot run on a serverless host — its default embedding function
downloads and executes an ONNX MiniLM model against a machine-local cache, which
is ephemeral on Vercel (and would be re-downloaded on every cold start).
Retrieval is therefore:

- **stored** in PostgreSQL (`spec_chunks`, cascading with the audit run),
- **embedded** by a pluggable provider: the deterministic, dependency-free
  lexical embedder by default (no downloads, stable across instances), or any
  OpenAI-compatible embedding API once `EMBEDDING_API_KEY` is set,
- **ranked** with the previous contract: top 5 chunks, each with
  `similarity = 1 / (1 + distance)` rounded to 3 decimals,
- **scoped** to the caller's run, behind the same ownership check `/api/chat`
  always enforced.

With the lexical embedder, paraphrased questions retrieve less precisely than a
sentence-transformer would; setting `EMBEDDING_API_KEY`/`EMBEDDING_API_URL`
restores semantic matching without any local model. Existing `chroma_store/`
content is not migrated — re-running an audit re-indexes its spec document.

## Correctness of the port

`tools/parity/` holds a drift harness that runs the original Python engine and
the TypeScript engine over the same fixtures and diffs every finding field and
score (**6 fixtures / 54 findings, identical**), plus a report-layout check
(**17/17**) that exercises pagination, repeated headers and hostile characters.
See `tools/parity/README.md` and `backend/DEPRECATED.md`.

## Notes on scaling this further

- Swap the sliding-window chunker in `lib/server/rag/service.ts` for a
  structure-aware chunker (headings/sections) for larger SOPs.
- Authentication is already stateless JWT (HS256) with short-lived access
  tokens and refresh tokens (`frontend/lib/server/security.ts`); add per-tenant
  data scoping, refresh-token rotation/revocation and SSO before deploying
  multi-tenant.
- Move file parsing and the Groq call to a background queue (Vercel background
  functions + `waitUntil`) if audit documents grow large enough to risk the 60 s
  request budget.
- `frontend/db/schema.sql` is applied additively; for evolving schemas in
  production, adopt a real migration tool rather than relying on
  `CREATE TABLE IF NOT EXISTS`.
