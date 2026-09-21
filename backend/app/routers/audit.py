"""
Audit pipeline endpoints: run a new audit, list historical runs, fetch run
detail, and export a run as a PDF report.
"""
from io import BytesIO
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import desc, asc
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import AuditCheckItem, AuditRun, CheckSeverity, CheckSource, CheckStatus, SystemLogRecord
from app.models.user import User
from app.routers.models import resolve_model
from app.routers.auth import get_current_user
from app.schemas import AuditRunDetail, AuditRunListResponse, AuditRunSummary, DashboardStats
from app.services.audit_engine import run_audit
from app.services.document_parser import parse_log_file, parse_spec_file
from app.services.rag_service import ingest_spec_document

router = APIRouter(prefix="/api/audit", tags=["audit"])
settings = get_settings()

SORTABLE_FIELDS = {
    "created_at": AuditRun.created_at,
    "compliance_score": AuditRun.compliance_score,
    "critical_violations": AuditRun.critical_violations,
    "total_checks": AuditRun.total_checks,
}


@router.post("/run", response_model=AuditRunDetail, status_code=201)
async def run_new_audit(
    spec_file: UploadFile = File(..., description="SOP / specification document (.pdf, .txt)"),
    log_file: UploadFile = File(..., description="System execution log (.log, .txt, .py)"),
    model: Optional[str] = Form(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    resolved_model = resolve_model(model)

    parsed_spec = await parse_spec_file(spec_file, settings.max_upload_bytes)
    parsed_log = await parse_log_file(log_file, settings.max_upload_bytes)

    result = run_audit(parsed_spec.text, parsed_log.text, resolved_model)

    passed = sum(1 for f in result.findings if f.status == "PASS")
    failed = sum(1 for f in result.findings if f.status == "FAIL")
    warned = sum(1 for f in result.findings if f.status == "WARNING")
    critical = sum(1 for f in result.findings if f.status == "FAIL" and f.severity == "CRITICAL")

    run = AuditRun(
        user_id=current_user.id,
        spec_filename=parsed_spec.filename,
        log_filename=parsed_log.filename,
        model_used=resolved_model,
        compliance_score=result.compliance_score,
        total_checks=len(result.findings),
        passed_checks=passed,
        failed_checks=failed,
        warning_checks=warned,
        critical_violations=critical,
        spec_char_count=parsed_spec.char_count,
        log_char_count=parsed_log.char_count,
        log_line_count=parsed_log.line_count,
        status="COMPLETED",
    )
    db.add(run)
    db.flush()  # populate run.id before creating dependent rows

    for f in result.findings:
        db.add(
            AuditCheckItem(
                run_id=run.id,
                name=f.name,
                category=f.category,
                status=CheckStatus(f.status),
                severity=CheckSeverity(f.severity),
                source=CheckSource(f.source),
                description=f.description,
                evidence=f.evidence,
                recommendation=f.recommendation,
            )
        )

    db.add(
        SystemLogRecord(
            run_id=run.id,
            filename=parsed_log.filename,
            content=parsed_log.text[:200_000],
            line_count=parsed_log.line_count,
        )
    )

    db.commit()
    db.refresh(run)

    # Ingest the spec document into the vector store for the RAG copilot,
    # tagged with this run's id so chat can scope retrieval per-run.
    run_id: str = str(run.id)  # Column[str] -> plain str (Pylance-safe)
    try:
        ingest_spec_document(run_id, parsed_spec.filename, parsed_spec.text)
    except Exception:
        # Vector ingestion failing should not fail the audit itself.
        pass

    return run


@router.get("/runs", response_model=AuditRunListResponse)
def list_runs(
    db: Session = Depends(get_db),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    min_score: Optional[float] = Query(default=None),
    max_score: Optional[float] = Query(default=None),
    sort_by: str = Query(default="created_at"),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
):
    # Strict user isolation: every query is pinned to the authenticated
    # user's rows. Legacy rows with a NULL user_id are unowned and stay
    # invisible to everyone (no public/admin fallback).
    query = db.query(AuditRun).filter(AuditRun.user_id == current_user.id)
    if status_filter:
        query = query.filter(AuditRun.status == status_filter)
    if min_score is not None:
        query = query.filter(AuditRun.compliance_score >= min_score)
    if max_score is not None:
        query = query.filter(AuditRun.compliance_score <= max_score)

    total = query.count()

    sort_col = SORTABLE_FIELDS.get(sort_by, AuditRun.created_at)
    query = query.order_by(desc(sort_col) if sort_dir == "desc" else asc(sort_col))
    runs = query.offset(offset).limit(limit).all()

    # model_validate (from_attributes=True) converts each ORM row explicitly -
    # passing the ORM list directly trips Pylance's list-invariance check
    # (list[AuditRun] is not a list[AuditRunSummary]).
    return AuditRunListResponse(
        total=total,
        runs=[AuditRunSummary.model_validate(r) for r in runs],
    )


@router.get("/runs/{run_id}", response_model=AuditRunDetail)
def get_run_detail(
    run_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    run = (
        db.query(AuditRun)
        .filter(AuditRun.id == run_id, AuditRun.user_id == current_user.id)
        .first()
    )
    if not run:
        # Same 404 for "missing" and "not yours" so ids can't be probed.
        raise HTTPException(status_code=404, detail="Audit run not found.")
    return run


@router.delete("/runs/{run_id}", status_code=204)
def delete_run(
    run_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    run = (
        db.query(AuditRun)
        .filter(AuditRun.id == run_id, AuditRun.user_id == current_user.id)
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Audit run not found.")
    db.delete(run)
    db.commit()
    return None


@router.get("/runs/{run_id}/export")
def export_run_pdf(
    run_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.services.pdf_export import build_audit_pdf

    run = (
        db.query(AuditRun)
        .filter(AuditRun.id == run_id, AuditRun.user_id == current_user.id)
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Audit run not found.")

    pdf_bytes = build_audit_pdf(run, run.checks)
    filename = f"auditify_report_{run.id[:8]}.pdf"
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/dashboard-stats", response_model=DashboardStats)
def dashboard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from sqlalchemy import func

    # Same strict isolation as /runs - aggregates only over the caller's rows.
    own_runs = db.query(AuditRun).filter(AuditRun.user_id == current_user.id)

    total_runs = own_runs.with_entities(func.count(AuditRun.id)).scalar() or 0
    total_checks = own_runs.with_entities(func.coalesce(func.sum(AuditRun.total_checks), 0)).scalar() or 0
    avg_score = own_runs.with_entities(func.coalesce(func.avg(AuditRun.compliance_score), 0)).scalar() or 0
    total_critical = own_runs.with_entities(func.coalesce(func.sum(AuditRun.critical_violations), 0)).scalar() or 0
    total_logs = own_runs.with_entities(func.coalesce(func.sum(AuditRun.log_line_count), 0)).scalar() or 0
    latest_run = (
        db.query(AuditRun)
        .filter(AuditRun.user_id == current_user.id)
        .order_by(desc(AuditRun.created_at))
        .first()
    )

    return DashboardStats(
        total_runs=total_runs,
        total_checks_executed=int(total_checks),
        average_compliance_score=round(float(avg_score), 1),
        total_critical_violations=int(total_critical),
        total_logs_audited=int(total_logs),
        # Same ORM->schema conversion as /runs: explicit validation keeps
        # Pylance happy and guarantees the payload shape.
        latest_run=(
            AuditRunSummary.model_validate(latest_run) if latest_run is not None else None
        ),
    )
