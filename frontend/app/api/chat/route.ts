/**
 * `POST /api/chat`
 *
 * Port of `backend/app/routers/chat.py`: verifies that a supplied `run_id`
 * belongs to the caller before retrieval, resolves the pinned model, and
 * answers from retrieved context.
 */
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/server/auth";
import { ensureSchema, query } from "@/lib/server/db";
import { HttpError, handleRoute, readJsonBody } from "@/lib/server/http";
import { resolveModel } from "@/lib/server/models";
import { answerQuestion } from "@/lib/server/rag/service";
import { BodyValidator } from "@/lib/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A copilot answer is a single synchronous LLM call.
export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    const user = await getCurrentUser(request);
    await ensureSchema();

    const body = await readJsonBody(request);
    const validator = new BodyValidator(body);
    const message = validator.requiredString("message", { minLength: 1, maxLength: 4000 });
    const runId = validator.optionalString("run_id");
    const requestedModel = validator.optionalString("model");
    const history = validator.listOfObjects("history");
    validator.throwIfInvalid();

    // A run_id narrows retrieval to one spec document - verify that document
    // belongs to the caller before serving its chunks.
    if (runId) {
      const owned = await query<{ id: string }>(
        "SELECT id FROM audit_runs WHERE id = $1 AND user_id = $2 LIMIT 1",
        [runId, user.id]
      );
      if (owned.length === 0) {
        throw new HttpError(404, "Audit run not found.");
      }
    }

    const model = resolveModel(requestedModel);
    const { answer, sources } = await answerQuestion(
      message as string,
      runId ?? null,
      model,
      history
    );

    return NextResponse.json({ answer, sources, model_used: model });
  });
}
