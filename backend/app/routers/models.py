"""
Endpoint exposing the Groq LLM models Auditify can drive.

Auditify is pinned to a single Groq model for both AI-driven audit checks and
copilot chat so that results stay consistent and reproducible. This module is
the single source of truth for that model: the audit and copilot routers
resolve the model through ``resolve_model()`` instead of trusting a
client-supplied id.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException

from app.config import get_settings
from app.schemas import ModelInfo, ModelListResponse

router = APIRouter(prefix="/api/models", tags=["models"])
settings = get_settings()

# The only model Auditify is allowed to drive. Decommissioned Groq models
# (llama-3.1-8b-instant, mixtral-8x7b-32768, gemma2-9b-it, ...) have been
# removed from the supported set entirely.
DEFAULT_MODEL_ID = "openai/gpt-oss-120b"

SUPPORTED_MODELS = [
    ModelInfo(
        id=DEFAULT_MODEL_ID,
        label="OpenAI GPT-OSS 120B",
        description="High-capacity open-weights model used for all AI-driven audit checks and copilot responses.",
        context_window=128000,
    ),
]

SUPPORTED_MODEL_IDS = frozenset(m.id for m in SUPPORTED_MODELS)


def _configured_default() -> str:
    """Return the configured default model, pinned to the supported model.

    An operator-supplied ``DEFAULT_GROQ_MODEL`` is honoured only when it is
    actually supported; otherwise we fall back to ``DEFAULT_MODEL_ID`` so a
    stale env value can never select a decommissioned model.
    """
    configured = (settings.DEFAULT_GROQ_MODEL or "").strip()
    return configured if configured in SUPPORTED_MODEL_IDS else DEFAULT_MODEL_ID


def resolve_model(requested: Optional[str] = None) -> str:
    """Resolve the strict model id used for audit and copilot operations.

    Omitting the model (``None``/blank) falls back to the configured default,
    which is itself pinned to ``DEFAULT_MODEL_ID``. Any other explicit id is
    rejected with a 400 so an audit or copilot call can never silently run
    against an unavailable (decommissioned) model.
    """
    if requested is None or not requested.strip():
        return _configured_default()

    requested = requested.strip()
    if requested not in SUPPORTED_MODEL_IDS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported model '{requested}'. Auditify only supports "
                f"'{DEFAULT_MODEL_ID}'."
            ),
        )
    return requested


@router.get("", response_model=ModelListResponse)
def list_models() -> ModelListResponse:
    return ModelListResponse(models=SUPPORTED_MODELS, default_model=_configured_default())
