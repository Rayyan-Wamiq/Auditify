"use client";

import { AlertTriangle, FileStack, ListChecks, ScrollText } from "lucide-react";
import type { DashboardStats } from "@/lib/types";

interface Props {
  stats: DashboardStats | null;
  loading: boolean;
}

interface CardSpec {
  label: string;
  value: string;
  icon: React.ElementType;
  accent: string;
  bg: string;
}

export default function StatsCards({ stats, loading }: Props) {
  const cards: CardSpec[] = [
    {
      label: "Audit Runs",
      value: stats ? String(stats.total_runs) : "—",
      icon: FileStack,
      accent: "text-slate-700",
      bg: "bg-slate-100",
    },
    {
      label: "Checks Executed",
      value: stats ? stats.total_checks_executed.toLocaleString() : "—",
      icon: ListChecks,
      accent: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      label: "Log Lines Audited",
      value: stats ? stats.total_logs_audited.toLocaleString() : "—",
      icon: ScrollText,
      accent: "text-emerald-600",
      bg: "bg-emerald-50",
    },
    {
      label: "Critical Violations",
      value: stats ? String(stats.total_critical_violations) : "—",
      icon: AlertTriangle,
      accent: "text-red-600",
      bg: "bg-red-50",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-md border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300"
        >
          <div className="flex items-center justify-between">
            <span className={`flex h-8 w-8 items-center justify-center rounded-md ${c.bg}`}>
              <c.icon size={15} className={c.accent} />
            </span>
          </div>
          <p
            className={`mt-3 font-mono text-2xl font-semibold text-slate-900 ${
              loading ? "animate-pulse text-slate-300" : ""
            }`}
          >
            {c.value}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">{c.label}</p>
        </div>
      ))}
    </div>
  );
}
