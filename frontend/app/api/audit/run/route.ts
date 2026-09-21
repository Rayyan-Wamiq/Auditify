/**
 * `POST /api/audit/run`
 *
 * Port of `backend/app/routers/audit.py#run_new_audit`: parse the uploaded
 * (spec, log) pair, run the full rule-based + AI-driven pipeline, persist the
 * run with its findings and archived log, index the spec for the copilot, and
 * return the created `AuditRunDetail` (201).
 */
import { NextResponse } from "next/server";

import { runAudit } from "@/lib/server/audit/engine";
import { parseLogFile, parseSpecFile } from "@/lib/server/audit/parser";
import { createRun, getRunDetail } from "@/lib/server/audit/runs";
import { getCurrentUser } from "@/lib/server/auth";
import { maxUploadBytes } from "@/lib/server/config";
import { ensureSchema } from "@/lib/server/db";
import { HttpError, handleRoute, type ValidationErrorItem } from "@/lib/server/http";
import { resolveModel } from "@/lib/server/models";
import { ingestSpecDocument } from "@/lib/server/rag/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// An audit makes a synchronous LLM call, so the request needs headroom beyond
// the platform default (Node.js runtime, 60 s on the Vercel free tier).
export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    const user = await getCurrentUser(request);
    await ensureSchema();

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new HttpError(422, [
        { type: "missing", loc: ["body", "spec_file"], msg: "Field required" },
        { type: "missing", loc: ["body", "log_file"], msg: "Field required" },
      ] satisfies ValidationErrorItem[]);
    }

    const specFile = form.get("spec_file");
    const logFile = form.get("log_file");
    const modelField = form.get("model");

    if (!(specFile instanceof File) || !(logFile instanceof File)) {
      // FastAPI's `File(...)` requirements are mandatory form fields.
      const errors: ValidationErrorItem[] = [];
      if (!(specFile instanceof File)) {
        errors.push({ type: "missing", loc: ["body", "spec_file"], msg: "Field required" });
      }
      if (!(logFile instanceof File)) {
        errors.push({ type: "missing", loc: ["body", "log_file"], msg: "Field required" });
      }
      throw new HttpError(422, errors);
    }

    // Resolved before parsing, exactly like the Python handler, so an
    // unsupported model id fails fast with a 400.
    const model = resolveModel(typeof modelField === "string" ? modelField : null);

    const parsedSpec = await parseSpecFile(specFile, maxUploadBytes);
    const parsedLog = await parseLogFile(logFile, maxUploadBytes);

    const result = await runAudit(parsedSpec.text, parsedLog.text, model);

    const run = await createRun({
      userId: user.id,
      specFilename: parsedSpec.filename,
      logFilename: parsedLog.filename,
      modelUsed: model,
      complianceScore: result.compliance_score,
      specCharCount: parsedSpec.charCount,
      logCharCount: parsedLog.charCount,
      logLineCount: parsedLog.lineCount,
      findings: result.findings,
      logText: parsedLog.text,
    });

    // Index the spec document for the RAG copilot, tagged with this run's id so
    // chat can scope retrieval per-run. Ingestion failing must never fail the
    // audit itself.
    try {
      await ingestSpecDocument(run.id, parsedSpec.filename, parsedSpec.text);
    } catch (error) {
      console.error(
        `[auditify] RAG ingestion failed for run ${run.id}:`,
        error instanceof Error ? error.message : error
      );
    }

    const detail = await getRunDetail(user.id, run.id);
    return NextResponse.json(detail, { status: 201 });
  });
}
