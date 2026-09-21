"""
Auditify FastAPI application entrypoint.

Wires together CORS, database initialization, and all routers. Run with:
    uvicorn app.main:app --reload --port 8000
"""
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import get_settings
from app.core.database import init_db
from app.routers import audit, auth, chat, models

settings = get_settings()

app = FastAPI(
    title=settings.APP_NAME,
    description="AI-powered technical audit and compliance engine: rule-based + "
    "LLM-driven document/log analysis with a RAG copilot.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(audit.router)
app.include_router(chat.router)
app.include_router(models.router)


@app.on_event("startup")
def on_startup() -> None:
    # Auto-migration: create any missing tables (users, audits, audit_runs,
    # audit_check_items, system_log_records) against the configured database
    # (Supabase PostgreSQL in production). create_all is additive, so this is
    # safe to run on every boot.
    init_db()


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    # ``exc.errors()`` can embed non-JSON-serializable objects (Pydantic v2
    # stores the raised exception itself under ``ctx`` for custom validators),
    # so it must be run through jsonable_encoder before serialising.
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(exc.errors())})


@app.get("/api/health", tags=["health"])
def health_check():
    return {"status": "ok", "service": settings.APP_NAME}


@app.get("/", tags=["health"])
def root():
    return {"message": "Auditify API is running. See /docs for the interactive API reference."}
