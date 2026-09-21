"use client";

import { AlertTriangle, Bot, CheckCircle2, ListTree, Wrench, XCircle } from "lucide-react";
import type { AuditRunDetail, CheckSeverity, CheckStatus } from "@/lib/types";

interface Props {
  run: AuditRunDetail | null;
  loading: boolean;
}

const STATUS_META: Record<CheckStatus, { icon: React.ElementType; className: string }> = {
  PASS: { icon: CheckCircle2, className: "text-emerald-600" },
  FAIL: { icon: XCircle, className: "text-red-600" },
  WARNING: { icon: AlertTriangle, className: "text-amber-600" },
};

const SEVERITY_META: Record<CheckSeverity, string> = {
  CRITICAL: "bg-red-100 text-red-700 border-red-200",
  HIGH: "bg-orange-100 text-orange-700 border-orange-200",
  MEDIUM: "bg-amber-100 text-amber-700 border-amber-200",
  LOW: "bg-blue-100 text-blue-700 border-blue-200",
  INFO: "bg-slate-100 text-slate-600 border-slate-200",
};

export default function RunDetailPanel({ run, loading }: Props) {
  if (loading) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-5">
        <div className="h-4 w-40 animate-pulse rounded bg-slate-100" />
        <div className="mt-4 space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded bg-slate-50" />
          ))}
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
        <ListTree size={22} className="mb-2 text-slate-300" />
        <p className="text-sm font-medium text-slate-500">No audit run selected</p>
        <p className="mt-1 max-w-xs text-xs text-slate-400">
          Run a new audit or select an existing one from the trail below to inspect its itemized findings.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-3.5">
        <h2 className="text-sm font-semibold text-slate-900">Itemized Findings</h2>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {run.spec_filename} &middot; {run.log_filename} &middot; {run.model_used}
        </p>
      </div>

      <div className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto">
        {run.checks.map((check) => {
          const meta = STATUS_META[check.status];
          const Icon = meta.icon;
          return (
            <div key={check.id} className="px-5 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <Icon size={16} className={`mt-0.5 shrink-0 ${meta.className}`} />
                  <div>
                    <p className="text-sm font-medium text-slate-800">{check.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{check.category}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10.5px] font-medium ${SEVERITY_META[check.severity]}`}
                  >
                    {check.severity}
                  </span>
                  <span
                    className="flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10.5px] font-medium text-slate-500"
                    title={check.source === "AI_DRIVEN" ? "AI-driven finding" : "Rule-based finding"}
                  >
                    {check.source === "AI_DRIVEN" ? <Bot size={10} /> : <Wrench size={10} />}
                    {check.source === "AI_DRIVEN" ? "AI" : "Rule"}
                  </span>
                </div>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{check.description}</p>
              {check.evidence && (
                <p className="mt-1.5 rounded bg-slate-50 px-2.5 py-1.5 font-mono text-xs text-slate-500">
                  {check.evidence}
                </p>
              )}
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                <span className="font-medium text-slate-600">Recommendation: </span>
                {check.recommendation}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
