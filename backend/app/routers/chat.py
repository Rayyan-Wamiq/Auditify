"""RAG-powered AI Copilot chat endpoint."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.audit_run import AuditRun
from app.models.user import User
from app.routers.auth import get_current_user
from app.routers.models import resolve_model
from app.schemas import ChatRequest, ChatResponse, ChatSource
from app.services.rag_service import answer_question

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("", response_model=ChatResponse)
def chat(
    request: ChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ChatResponse:
    # A run_id narrows retrieval to one spec document - verify that document
    # belongs to the caller before letting the vector store serve its chunks.
    if request.run_id:
        run = (
            db.query(AuditRun)
            .filter(AuditRun.id == request.run_id, AuditRun.user_id == current_user.id)
            .first()
        )
        if not run:
            raise HTTPException(status_code=404, detail="Audit run not found.")

    model = resolve_model(request.model)
    answer, sources = answer_question(
        message=request.message,
        run_id=request.run_id,
        model=model,
        history=request.history,
    )
    return ChatResponse(
        answer=answer,
        sources=[ChatSource(chunk=chunk, similarity=sim) for chunk, sim in sources],
        model_used=model,
    )
