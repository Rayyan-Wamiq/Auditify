# `backend/` — legacy FastAPI service (no longer required)

**Status: deprecated for deployment, retained for parity testing.**

The entire API now lives inside the Next.js app so the full-stack product
deploys as a single Vercel project on the free tier:

| Former FastAPI location | New location |
|---|---|
| `backend/app/main.py` (health, CORS, startup auto-migration) | `frontend/app/api/health/route.ts`, schema bootstrap in `frontend/lib/server/db.ts#ensureSchema` |
| `backend/app/config.py` | `frontend/lib/server/config.ts` |
| `backend/app/core/database.py` (SQLAlchemy engine/session) | `frontend/lib/server/db.ts` (node-postgres) |
| `backend/app/core/security.py` (bcrypt + HS256 JWTs) | `frontend/lib/server/security.ts` (bcryptjs + jose) |
| `backend/app/models/*` (ORM models, enums) | `frontend/db/schema.sql` |
| `backend/app/schemas.py` (Pydantic contracts) | `frontend/lib/server/validation.ts` + the route handlers |
| `POST /api/auth/signup` | `frontend/app/api/auth/signup/route.ts` |
| `POST /api/auth/login` | `frontend/app/api/auth/login/route.ts` |
| `POST /api/auth/refresh` | `frontend/app/api/auth/refresh/route.ts` |
| `GET  /api/auth/me` | `frontend/app/api/auth/me/route.ts` |
| `GET  /api/models` | `frontend/app/api/models/route.ts` |
| `POST /api/audit/run` | `frontend/app/api/audit/run/route.ts` |
| `GET  /api/audit/runs` | `frontend/app/api/audit/runs/route.ts` |
| `GET|DELETE /api/audit/runs/{id}` | `frontend/app/api/audit/runs/[runId]/route.ts` |
| `GET  /api/audit/runs/{id}/export` (PDF) | `frontend/app/api/audit/runs/[runId]/export/route.ts` |
| `GET  /api/audit/dashboard-stats` | `frontend/app/api/audit/dashboard-stats/route.ts` |
| `POST /api/chat` | `frontend/app/api/chat/route.ts` |
| `backend/app/services/audit_engine.py` | `frontend/lib/server/audit/engine.ts` |
| `backend/app/services/document_parser.py` | `frontend/lib/server/audit/parser.ts` |
| `backend/app/services/pdf_export.py` | `frontend/lib/server/audit/pdf.ts` |
| `backend/app/services/rag_service.py` (ChromaDB) | `frontend/lib/server/rag/{service,store,embeddings,prompt}.ts` |

## What this means in practice

* **Nothing needs to run in Python to serve the product.** `frontend/` is the
  whole application; `backend/` is only interesting if you want to re-run the
  parity harness (see `tools/parity/README.md`) or keep the original service
  around for reference.
* **`backend/.env` must stay local and git-ignored.** It holds the Groq key and
  the database password. The Next.js app reads the *same variable names* from
  `frontend/.env.local` (see `frontend/.env.local.example`).
* **`backend/chroma_store/` is also git-ignored** and is never used by the new
  stack (RAG chunks now live in the `spec_chunks` table).
* **`docker-compose.yml` is still valid** for a local Postgres/backend/frontend
  stack, but the frontend container now serves the API itself, so the `backend`
  service is optional there too.

## Verified equivalence

The port is not "close enough" — it was diff-tested against the Python original:

* **Audit rules and scoring:** `tools/parity/compare_engines.js` runs the
  Python engine and the TypeScript engine over the same fixtures and
  deep-compares every finding field and the compliance score. Current result:
  **6 fixtures / 54 findings, byte-identical**, including the banker's-rounding
  percentage case (`1 of 8 log lines (12%)`) that a naive JavaScript
  `Math.round` would report as `13%`.
* **Password hashes:** bcrypt `$2b$12$` hashes are interchangeable — a hash
  produced by `bcryptjs` verifies under passlib, and a passlib hash verifies
  under `bcryptjs`, so existing `users` rows keep working after the cut-over.
* **JWT tokens:** HS256 tokens minted by `jose` decode under `python-jose` and
  vice-versa (same `sub`/`type`/`iat`/`exp` claims, same `SECRET_KEY`), so
  sessions survive a rolling migration between the two runtimes.
* **Contracts:** identical endpoint paths, status codes (`201` signup/run,
  `204` delete, `401`/`403`-style `{"detail": ...}` errors, `413`/`422` upload
  failures), response payload field names, PDF attachment filename
  (`auditify_report_<id[0:8]>.pdf`) and the pinned Groq model.
