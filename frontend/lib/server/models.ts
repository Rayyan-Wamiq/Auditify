/**
 * The Groq LLM models Auditify can drive.
 *
 * TypeScript port of `backend/app/routers/models.py`. Auditify is pinned to a
 * single Groq model for both AI-driven audit checks and copilot chat so results
 * stay consistent and reproducible; this module is the single source of truth,
 * and the audit/chat handlers resolve the model through `resolveModel()` rather
 * than trusting a client-supplied id.
 */
import { settings } from "./config";
import { HttpError } from "./http";

export interface ModelInfo {
  id: string;
  label: string;
  description: string;
  context_window: number;
}

/** The only model Auditify is allowed to drive. */
export const DEFAULT_MODEL_ID = "openai/gpt-oss-120b";

export const SUPPORTED_MODELS: ModelInfo[] = [
  {
    id: DEFAULT_MODEL_ID,
    label: "OpenAI GPT-OSS 120B",
    description:
      "High-capacity open-weights model used for all AI-driven audit checks and copilot responses.",
    context_window: 128000,
  },
];

const SUPPORTED_MODEL_IDS = new Set(SUPPORTED_MODELS.map((m) => m.id));

/** Configured default, pinned to a supported id so a stale env value is ignored. */
export function configuredDefaultModel(): string {
  const configured = (settings.defaultGroqModel ?? "").trim();
  return SUPPORTED_MODEL_IDS.has(configured) ? configured : DEFAULT_MODEL_ID;
}

/**
 * Resolve the strict model id used for audit and copilot operations.
 *
 * Omitting the model (`undefined`/blank) falls back to the configured default,
 * which is itself pinned to `DEFAULT_MODEL_ID`. Any other explicit id is
 * rejected with a 400 so an audit or copilot call can never silently run
 * against an unavailable (decommissioned) model.
 */
export function resolveModel(requested?: string | null): string {
  if (requested === undefined || requested === null || !requested.trim()) {
    return configuredDefaultModel();
  }

  const trimmed = requested.trim();
  if (!SUPPORTED_MODEL_IDS.has(trimmed)) {
    throw new HttpError(
      400,
      `Unsupported model '${trimmed}'. Auditify only supports '${DEFAULT_MODEL_ID}'.`
    );
  }
  return trimmed;
}
