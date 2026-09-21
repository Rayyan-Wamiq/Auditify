"use client";

import { useCallback, useRef, useState } from "react";
import { AlertCircle, FileCode2, FileText, Loader2, PlayCircle, UploadCloud, X } from "lucide-react";
import { runAudit, ApiError } from "@/lib/api";
import type { AuditRunDetail } from "@/lib/types";

interface Props {
  activeModel: string;
  onAuditComplete: (run: AuditRunDetail) => void;
}

interface DropzoneProps {
  title: string;
  hint: string;
  accept: string;
  file: File | null;
  onFile: (f: File | null) => void;
  icon: React.ElementType;
}

function Dropzone({ title, hint, accept, file, onFile, icon: Icon }: DropzoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const dropped = e.dataTransfer.files?.[0];
      if (dropped) onFile(dropped);
    },
    [onFile]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`flex min-h-[128px] cursor-pointer flex-col items-center justify-center rounded-md border border-dashed p-4 text-center transition-colors ${
        dragOver
          ? "border-emerald-500 bg-emerald-50"
          : file
          ? "border-emerald-300 bg-emerald-50/40"
          : "border-slate-300 bg-slate-50 hover:border-slate-400 hover:bg-slate-100/60"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      {file ? (
        <div className="flex w-full items-center justify-between gap-2 rounded-md bg-white px-3 py-2 border border-slate-200">
          <div className="flex min-w-0 items-center gap-2">
            <Icon size={15} className="shrink-0 text-emerald-600" />
            <span className="truncate text-sm text-slate-800">{file.name}</span>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onFile(null);
            }}
            className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label={`Remove ${file.name}`}
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <>
          <UploadCloud size={20} className="mb-2 text-slate-400" />
          <p className="text-sm font-medium text-slate-700">{title}</p>
          <p className="mt-0.5 text-xs text-slate-400">{hint}</p>
        </>
      )}
    </div>
  );
}

/** Map upload/audit failures to plain, actionable messages.
 *
 * The backend already returns descriptive `detail` strings for file-type,
 * file-size, and parse failures (422/413); those pass through untouched.
 * Status-based mappings cover the cases where the raw detail would be
 * confusing (401 after an expired token, generic 5xx, gateway timeouts).
 */
function describeAuditError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 401:
        return "Your session has expired. Please log in again.";
      case 413:
        return "One of the files exceeds the maximum upload size. Please use a smaller document or trim the log.";
      case 422:
        return err.message; // descriptive parse / file-type / empty-file error from the backend
      case 502:
      case 503:
      case 504:
        return "The AI service (Groq) is unreachable right now. Please try again in a moment.";
      case 500:
        return "The audit engine hit an unexpected server error. Please try again.";
      default:
        return err.message || "Audit execution failed. Please try again.";
    }
  }
  return "Audit execution failed. Please check your connection and try again.";
}

export default function UploadPanel({ activeModel, onAuditComplete }: Props) {
  const [specFile, setSpecFile] = useState<File | null>(null);
  const [logFile, setLogFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRun = specFile && logFile && !running;

  async function handleRunAudit() {
    if (!specFile || !logFile) return;

    // Pre-flight checks so obvious mistakes fail fast without a round trip.
    if (specFile.size === 0 || logFile.size === 0) {
      setError("One of the selected files is empty. Please pick non-empty files and try again.");
      return;
    }

    setRunning(true);
    setError(null);
    try {
      const run = await runAudit(specFile, logFile, activeModel);
      onAuditComplete(run);
      setSpecFile(null);
      setLogFile(null);
    } catch (err) {
      setError(describeAuditError(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Run New Audit</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Upload a specification document and an execution log to score compliance posture.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Dropzone
          title="SOP / Specification Document"
          hint=".pdf or .txt"
          accept=".pdf,.txt"
          file={specFile}
          onFile={setSpecFile}
          icon={FileText}
        />
        <Dropzone
          title="System Execution Log"
          hint=".log, .txt, or .py"
          accept=".log,.txt,.py"
          file={logFile}
          onFile={setLogFile}
          icon={FileCode2}
        />
      </div>

      {error && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {running && (
        <div
          role="status"
          className="mt-3 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700"
        >
          <Loader2 size={13} className="shrink-0 animate-spin" />
          <span>Running AI technical audit &amp; RAG analysis — parsing documents, executing rule-based checks, and scoring with the LLM. This can take up to a minute…</span>
        </div>
      )}

      <button
        onClick={handleRunAudit}
        disabled={!canRun}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
      >
        {running ? (
          <>
            <Loader2 size={15} className="animate-spin" /> Running AI technical audit &amp; RAG analysis&hellip;
          </>
        ) : (
          <>
            <PlayCircle size={15} /> Run Audit
          </>
        )}
      </button>
    </div>
  );
}
