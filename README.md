# Auditify — AI Technical Audit & Compliance Engine

Auditify ingests a specification/SOP document alongside a system execution
log, runs a hybrid rule-based + LLM-driven compliance audit, scores the
posture, and surfaces itemized violations in an enterprise dashboard —
plus a RAG-powered AI Copilot for follow-up questions grounded in your
uploaded documents.

## Architecture

```
auditify/
├── backend/            FastAPI service (Python)
│   ├── app/
│   │   ├── main.py            App entrypoint, CORS, routers, startup auto-migration
│   │   ├── config.py          Env-driven settings (pydantic-settings)
│   │   ├── database.py        Back-compat shim re-exporting app/core/database.py
│   │   ├── core/
│   │   │   └── database.py    SQLAlchemy engine/session/Base + create_all on startup
│   │   ├── models/            ORM model package (flat `app.models` namespace)
│   │   │   ├── user.py        User (authentication)
│   │   │   ├── audit.py       Audit (user-scoped summary)
│   │   │   ├── audit_run.py   AuditRun, AuditCheckItem, SystemLogRecord
│   │   │   ├── enums.py       CheckStatus / CheckSeverity / CheckSource
│   │   │   └── utils.py       Shared PK helper
│   │   ├── schemas.py         Pydantic v2 request/response schemas
│   │   ├── services/
│   │   │   ├── document_parser.py   PDF/TXT/LOG/PY extraction
│   │   │   ├── audit_engine.py      Rule-based + Groq AI-driven checks + scoring
│   │   │   ├── rag_service.py       ChromaDB ingestion + Groq RAG chat
│   │   │   └── pdf_export.py        ReportLab audit report generation
│   │   └── routers/
│   │       ├── audit.py       Upload/run/list/detail/export/stats endpoints
│   │       ├── chat.py        Copilot chat endpoint
│   │       └── models.py      Supported LLM model listing
│   └── requirements.txt
└── frontend/           Next.js 14 App Router (TypeScript + Tailwind)
    ├── app/            page.tsx (dashboard), layout.tsx, globals.css
    ├── components/      Header, UploadPanel, ComplianceGauge, StatsCards,
    │                    AuditTable, RunDetailPanel, ChatDrawer, ModelSelector,
    │                    ProfileSection
    └── lib/             api.ts (typed fetch client), types.ts
```

## Prerequisites

- Python 3.11+
- Node.js 18.18+
- PostgreSQL 14+ (Supabase in production — SQLite is **not** supported)
- A [Groq API key](https://console.groq.com/keys) (optional — the app runs
  with rule-based checks only if omitted, degrading gracefully)

## Backend setup

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # then edit DATABASE_URL / GROQ_API_KEY
uvicorn app.main:app --reload --port 8000
```

The API is now live at `http://localhost:8000` (interactive docs at `/docs`).
Tables are created automatically on startup via SQLAlchemy's `create_all`.

### Connecting to Supabase PostgreSQL

1. In the Supabase dashboard go to **Project Settings → Database → Connection
   string** and copy the password (or reset it if you don't have it).
2. Put it in `backend/.env`, replacing the `YOUR_ACTUAL_PASSWORD` placeholder:

   ```env
   DATABASE_URL=postgresql://postgres:<your-password>@db.<project-ref>.supabase.co:5432/postgres
   ```

   (`postgresql+psycopg2://…` is equivalent and more explicit — SQLAlchemy uses
   psycopg2 either way.)
3. Start the backend. On startup `Base.metadata.create_all()` runs and creates
   the `users`, `audits`, `audit_runs`, `audit_check_items` and
   `system_log_records` tables automatically. `create_all` only adds *missing*
   tables, so it is safe on every boot.

> **If the connection hangs or fails:** Supabase's direct
> `db.<project-ref>.supabase.co` host is **IPv6-only** on newer projects. On a
> network without an IPv6 route, use the connection **pooler** host instead:
>
> ```env
> DATABASE_URL=postgresql://postgres.<project-ref>:<your-password>@aws-0-<region>.pooler.supabase.com:6543/postgres
> ```
>
> (Note the `postgres.<project-ref>` user format and port `6543` for the
> transaction pooler.) Also remember to allow your IP under **Project Settings →
> Database → Network Restrictions** if restrictions are enabled.

`create_all` is **not** a migration tool: it will not alter existing tables.
For evolving schemas in production, adopt Alembic.

## Frontend setup

```bash
cd frontend
npm install
cp .env.local.example .env.local   # points at the backend API
npm run dev
```

Visit `http://localhost:3000`. API calls are proxied through Next.js
rewrites (see `next.config.js`) to `NEXT_PUBLIC_API_BASE_URL`.

## Environment variables (backend/.env)

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | SQLAlchemy connection string — **PostgreSQL only** (Supabase or local Postgres) | `postgresql+psycopg2://auditify:auditify@localhost:5432/auditify` |
| `GROQ_API_KEY` | Groq API key for AI-driven checks + copilot | *(empty)* |
| `DEFAULT_GROQ_MODEL` | Default model id (pinned; only `openai/gpt-oss-120b` is supported) | `openai/gpt-oss-120b` |
| `CHROMA_PERSIST_DIR` | Local ChromaDB persistence directory | `./chroma_store` |
| `CORS_ORIGINS` | Comma-separated allowed origins | `http://localhost:3000` |
| `MAX_UPLOAD_MB` | Max per-file upload size | `15` |
| `SECRET_KEY` | HMAC key used to sign JWT access/refresh tokens — set a random value per environment (`python -c "import secrets; print(secrets.token_urlsafe(48))"`) | insecure dev-only placeholder |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Access-token lifetime in minutes | `30` |
| `REFRESH_TOKEN_EXPIRE_DAYS` | Refresh-token lifetime in days | `7` |

> **Never commit `backend/.env` or `frontend/.env.local`.** Both are git-ignored;
> only the `*.env.example` templates belong in the repository.

## Core flows

1. **Run an audit** — upload a spec document and an execution log from the
   dashboard's "Run New Audit" panel. The backend parses both files, runs
   deterministic rule-based checks (control coverage, secret leakage,
   error-rate analysis, documentation completeness) plus an AI-driven pass
   via Groq, merges the findings, computes a weighted compliance score, and
   persists everything to Postgres.
2. **Review findings** — select any run from the Audit Trail table to see
   its itemized findings (status, severity, source, evidence, remediation).
3. **Export a report** — click "PDF" on any row to download a formatted
   audit report generated server-side with ReportLab.
4. **Ask the Copilot** — open the floating AI Copilot drawer to ask
   questions; it performs a vector search over your uploaded spec documents
   (ChromaDB) and answers via Groq, rendered as rich Markdown.

## Notes on scaling this further

- Swap the naive sliding-window chunker in `rag_service.py` for a
  structure-aware chunker (headings/sections) for larger SOPs.
- Authentication is already stateless JWT (HS256) with short-lived access
  tokens and refresh tokens (`backend/app/routers/auth.py`,
  `backend/app/core/security.py`); add per-tenant data scoping, refresh-token
  rotation/revocation and SSO before deploying multi-tenant.
- Move file parsing/AI calls to a background task queue (Celery/RQ) if
  audit documents grow large enough to risk request timeouts.
- Point `CHROMA_PERSIST_DIR` at a mounted volume in containerized deploys.
