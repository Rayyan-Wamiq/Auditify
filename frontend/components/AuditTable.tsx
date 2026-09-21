"use client";

import { useMemo, useState } from "react";
import {
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  XCircle,
  AlertCircle,
} from "lucide-react";
import type { AuditRunSummary } from "@/lib/types";

interface Props {
  runs: AuditRunSummary[];
  loading: boolean;
  onSelectRun: (runId: string) => void;
  selectedRunId: string | null;
}

type SortField = "created_at" | "compliance_score" | "critical_violations" | "total_checks";

const SEVERITY_FILTERS = [
  { key: "all", label: "All runs" },
  { key: "critical", label: "Has critical" },
  { key: "clean", label: "No violations" },
] as const;

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80
      ? "text-emerald-700 bg-emerald-50 border-emerald-200"
      : score >= 50
        ? "text-amber-700 bg-amber-50 border-amber-200"
        : "text-red-700 bg-red-50 border-red-200";
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-xs font-medium ${color}`}>
      {score.toFixed(1)}
    </span>
  );
}

export default function AuditTable({ runs, loading, onSelectRun, selectedRunId }: Props) {
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filter, setFilter] = useState<(typeof SEVERITY_FILTERS)[number]["key"]>("all");

  function toggleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  const displayedRuns = useMemo(() => {
    let filtered = runs;
    if (filter === "critical") filtered = runs.filter((r) => r.critical_violations > 0);
    if (filter === "clean") filtered = runs.filter((r) => r.failed_checks === 0);

    const sorted = [...filtered].sort((a, b) => {
      const av = sortField === "created_at" ? new Date(a.created_at).getTime() : a[sortField];
      const bv = sortField === "created_at" ? new Date(b.created_at).getTime() : b[sortField];
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return sorted;
  }, [runs, filter, sortField, sortDir]);

  const headerCell = (label: string, field: SortField) => (
    <button
      onClick={() => toggleSort(field)}
      className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
    >
      {label}
      <ArrowUpDown size={11} className={sortField === field ? "text-emerald-600" : "text-slate-300"} />
    </button>
  );

  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Audit Trail</h2>
          <p className="text-xs text-slate-500">{runs.length} total runs on record</p>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-0.5">
          {SEVERITY_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${filter === f.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="w-8 px-5 py-2.5" />
              <th className="px-2 py-2.5 text-left">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Documents
                </span>
              </th>
              <th className="px-2 py-2.5 text-left">{headerCell("Score", "compliance_score")}</th>
              <th className="px-2 py-2.5 text-left">{headerCell("Checks", "total_checks")}</th>
              <th className="px-2 py-2.5 text-left">{headerCell("Critical", "critical_violations")}</th>
              <th className="px-2 py-2.5 text-left">{headerCell("Date", "created_at")}</th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              [0, 1, 2].map((i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td colSpan={6} className="px-5 py-4">
                    <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                  </td>
                </tr>
              ))}

            {!loading && displayedRuns.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-400">
                  No audit runs yet. Upload a spec document and log file above to run your first audit.
                </td>
              </tr>
            )}

            {!loading &&
              displayedRuns.map((run) => {
                const selected = run.id === selectedRunId;
                return (
                  <tr
                    key={run.id}
                    onClick={() => onSelectRun(run.id)}
                    className={`cursor-pointer border-b border-slate-100 transition-colors last:border-0 ${selected ? "bg-emerald-50/60" : "hover:bg-slate-50"
                      }`}
                  >
                    <td className="px-5 py-3 text-slate-300">
                      {selected ? (
                        <ChevronDown size={14} className="text-emerald-600" />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                    </td>
                    <td className="px-2 py-3">
                      <p className="max-w-[220px] truncate text-sm font-medium text-slate-800">
                        {run.spec_filename}
                      </p>
                      <p className="max-w-[220px] truncate text-xs text-slate-400">{run.log_filename}</p>
                    </td>
                    <td className="px-2 py-3">
                      <ScoreBadge score={run.compliance_score} />
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex items-center gap-2.5 text-xs text-slate-500">
                        <span className="flex items-center gap-1 text-emerald-600">
                          <CheckCircle2 size={12} /> {run.passed_checks}
                        </span>
                        <span className="flex items-center gap-1 text-red-600">
                          <XCircle size={12} /> {run.failed_checks}
                        </span>
                        <span className="flex items-center gap-1 text-amber-600">
                          <AlertCircle size={12} /> {run.warning_checks}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-3">
                      {run.critical_violations > 0 ? (
                        <span className="inline-flex items-center rounded border border-red-200 bg-red-50 px-1.5 py-0.5 font-mono text-xs font-medium text-red-700">
                          {run.critical_violations}
                        </span>
                      ) : (
                        <span className="font-mono text-xs text-slate-400">0</span>
                      )}
                    </td>
                    <td className="px-2 py-3 text-xs text-slate-500">
                      {new Date(run.created_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
