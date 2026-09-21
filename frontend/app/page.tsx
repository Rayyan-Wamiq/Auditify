"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  LayoutDashboard,
  ShieldAlert,
  FileCheck2,
  FileText,
  Download,
  TrendingUp,
  TrendingDown,
  ListChecks,
  Activity,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from "recharts";

import { useRouter } from "next/navigation";

import UploadPanel from "@/components/UploadPanel";
import RunDetailPanel from "@/components/RunDetailPanel";
import AuditTable from "@/components/AuditTable";
import ChatDrawer from "@/components/ChatDrawer";
import ProfileSection from "@/components/ProfileSection";
import { useAuth } from "@/components/AuthProvider";

import { downloadRunPdf, getDashboardStats, getRunDetail, getModels, listRuns } from "@/lib/api";
import type { AuditRunDetail, AuditRunSummary, DashboardStats } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function scoreColor(score: number): string {
  if (score >= 80) return "#059669";
  if (score >= 50) return "#d97706";
  return "#dc2626";
}

// Tailwind pill classes mirroring the score thresholds used by scoreColor
// and the AuditTable score badge, so the Reports list stays visually
// consistent with the rest of the dashboard.
function scorePillClass(score: number): string {
  if (score >= 80) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (score >= 50) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-red-200 bg-red-50 text-red-700";
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/* ------------------------------------------------------------------ */
/*  Donut card                                                          */
/* ------------------------------------------------------------------ */

function DonutCard({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const data = [{ name: "score", value: clamped }];
  const color = scoreColor(clamped);
  return (
    <div className="relative h-[168px] w-[168px]">
      <PieChart width={168} height={168}>
        <Pie
          data={data}
          dataKey="value"
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={80}
          startAngle={90}
          endAngle={-270}
          cornerRadius={12}
          stroke="none"
        >
          <Cell fill={color} />
        </Pie>
      </PieChart>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-4xl font-extrabold text-slate-900">{clamped.toFixed(0)}</span>
        <span className="text-xs font-medium text-slate-400">out of 100</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Status breakdown mini-strip                                         */
/* ------------------------------------------------------------------ */

type ActiveTab = "dashboard" | "audits" | "reports";

function StatusStrip({ runs }: { runs: AuditRunSummary[] }) {
  const totals = useMemo(
    () =>
      runs.reduce(
        (acc, r) => {
          acc.pass += r.passed_checks;
          acc.fail += r.failed_checks;
          acc.warn += r.warning_checks;
          return acc;
        },
        { pass: 0, fail: 0, warn: 0 }
      ),
    [runs]
  );
  const items = [
    { key: "PASS", label: "Passed", value: totals.pass, cls: "bg-emerald-500 text-white", icon: CheckCircle2 },
    { key: "FAIL", label: "Failed", value: totals.fail, cls: "bg-red-500 text-white", icon: XCircle },
    { key: "WARN", label: "Warnings", value: totals.warn, cls: "bg-amber-400 text-white", icon: AlertCircle },
  ];
  return (
    <div className="mt-5 w-full space-y-2.5">
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <div key={it.key} className="flex items-center gap-3">
            <Icon className="h-4 w-4 text-slate-400" />
            <span className="w-20 text-xs font-medium text-slate-500">{it.label}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${it.cls}`}
                style={{
                  width: `${Math.min(
                    100,
                    (it.value / Math.max(1, totals.pass + totals.fail + totals.warn)) * 100
                  )}%`,
                }}
              ></div>
            </div>
            <span className="w-10 text-right font-mono text-xs font-semibold text-slate-700">{it.value}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  KPI stat card                                                       */
/* ------------------------------------------------------------------ */

interface KpiProps {
  label: string;
  value: string;
  sub: string;
  icon: React.ElementType;
  iconClass: string;
  trend?: { dir: "up" | "down"; pct: string } | null;
}

function KpiCard({ label, value, sub, icon: Icon, iconClass, trend }: KpiProps) {
  return (
    <div className="flex items-start justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${iconClass}`}>
          <Icon className="h-5 w-5" />
        </div>
        <p className="mt-4 font-mono text-3xl font-extrabold tracking-tight text-slate-900">{value}</p>
        <p className="mt-1 text-sm font-semibold text-slate-700">{label}</p>
        <p className="text-xs text-slate-400">{sub}</p>
      </div>
      {trend && (
        <span
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ${trend.dir === "up"
            ? "bg-emerald-50 text-emerald-600"
            : trend.dir === "down" && label === "Critical Violations"
              ? "bg-emerald-50 text-emerald-600"
              : "bg-rose-50 text-rose-600"
            }`}
        >
          {trend.dir === "up" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {trend.pct}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Dashboard page                                                      */
/* ------------------------------------------------------------------ */

export default function DashboardPage() {
  const [activeModel, setActiveModel] = useState<string>("openai/gpt-oss-120b");
  const [activeTab, setActiveTab] = useState<ActiveTab>("dashboard");

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const [runs, setRuns] = useState<AuditRunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<AuditRunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Reports tab: per-run PDF export. Tracks which run is mid-download so its
  // button can show a busy state. Uses the existing /runs/{id}/export endpoint
  // via the shared downloadRunPdf helper - no new backend surface.
  const [exportingReportId, setExportingReportId] = useState<string | null>(null);

  const handleExportReport = useCallback(async (runId: string) => {
    setExportingReportId(runId);
    try {
      await downloadRunPdf(runId, `auditify_report_${runId.slice(0, 8)}.pdf`);
    } finally {
      setExportingReportId(null);
    }
  }, []);

  // --- Auth guard -------------------------------------------------------
  // Unauthenticated visitors are pushed to /login. The check runs after the
  // auth context finishes restoring the session from localStorage, so a page
  // refresh with a valid token never bounces the user out.
  const { accessToken, isLoading, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !accessToken) {
      router.replace("/login");
    }
  }, [isLoading, accessToken, router]);

  const loadModels = useCallback(() => {
    getModels()
      .then((res) => setActiveModel(res.default_model || res.models[0]?.id || "openai/gpt-oss-120b"))
      .catch(() => undefined);
  }, []);

  const refreshRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const res = await listRuns({ limit: 100 });
      setRuns(res.runs);
    } catch {
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }, []);

  const refreshStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await getDashboardStats();
      setStats(res);
    } catch {
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Only fetch once the session is resolved AND a token exists - otherwise
    // the very first (headerless) fetch would 401 and force a bogus sign-out.
    if (isLoading || !accessToken) return;
    loadModels();
    refreshRuns();
    refreshStats();
  }, [loadModels, refreshRuns, refreshStats, isLoading, accessToken]);

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedRun(null);
      return;
    }
    if (!accessToken) return; // wait for the session before fetching details
    setDetailLoading(true);
    getRunDetail(selectedRunId)
      .then(setSelectedRun)
      .catch(() => setSelectedRun(null))
      .finally(() => setDetailLoading(false));
  }, [selectedRunId, accessToken]);

  function handleAuditComplete(run: AuditRunDetail) {
    setSelectedRunId(run.id);
    setSelectedRun(run);
    refreshRuns();
    refreshStats();
    setActiveTab("audits");
  }

  // Trend series from real run history (oldest → newest).
  const trendData = useMemo(
    () =>
      [...runs]
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map((r) => ({
          name: fmtDate(r.created_at),
          score: r.compliance_score,
          critical: r.critical_violations,
        })),
    [runs]
  );

  const avgScore = stats?.average_compliance_score ?? 0;
  const totalChecks = stats ? stats.total_checks_executed : 0;
  const critical = stats?.total_critical_violations ?? 0;

  const kpis: KpiProps[] = [
    { label: "Audit Runs", value: statsLoading ? "…" : String(stats?.total_runs ?? 0), sub: "total audits executed", icon: FileCheck2, iconClass: "bg-blue-50 text-blue-600", trend: (stats?.total_runs ?? 0) > 0 ? { dir: "up", pct: "active" } : null },
    { label: "Checks Executed", value: statsLoading ? "…" : totalChecks.toLocaleString(), sub: "rule + AI driven checks", icon: ListChecks, iconClass: "bg-indigo-50 text-indigo-600", trend: totalChecks > 0 ? { dir: "up", pct: "total" } : null },
    { label: "Avg Compliance", value: statsLoading ? "…" : `${avgScore.toFixed(0)}%`, sub: "average of all runs", icon: Activity, iconClass: "bg-emerald-50 text-emerald-600", trend: avgScore >= 80 ? { dir: "up", pct: "healthy" } : { dir: "down", pct: "watch" } },
    { label: "Critical Violations", value: statsLoading ? "…" : String(critical), sub: "P0 findings across runs", icon: ShieldAlert, iconClass: "bg-rose-50 text-rose-600", trend: critical > 0 ? { dir: "down", pct: "high priority" } : { dir: "down", pct: "none" } },
  ];

  // Auth gate: never render dashboard data while the session is unresolved
  // or when the user is unauthenticated (the redirect above kicks in).
  // Placed after every hook call to keep React's rules-of-hooks satisfied.
  if (isLoading || !accessToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          <p className="text-sm font-medium text-slate-500">
            {isLoading ? "Checking your session…" : "Redirecting to login…"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800">
      <div className="flex">
        {/* SIDEBAR */}
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col justify-between border-r border-slate-200 bg-white p-5 lg:flex">
          <div>
            <div className="mb-8 flex items-center gap-3 px-1">
              <Image
                src="/logo.png"
                alt="Auditify logo"
                width={40}
                height={40}
                priority
                className="h-10 w-10 rounded-xl object-contain shadow-md shadow-emerald-500/20"
              />
              <div>
                <h1 className="text-lg font-bold tracking-tight text-slate-900">Auditify</h1>
                <p className="text-[11px] font-medium text-slate-400">AI Audit &amp; Compliance</p>
              </div>
            </div>
            <nav className="space-y-1">
              <button
                onClick={() => setActiveTab("dashboard")}
                className={`flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${activeTab === "dashboard"
                  ? "bg-emerald-600 text-white shadow-sm shadow-emerald-500/20"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                  }`}
              >
                <LayoutDashboard className="h-5 w-5" /> Dashboard
              </button>
              <button
                onClick={() => setActiveTab("audits")}
                className={`flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${activeTab === "audits"
                  ? "bg-emerald-600 text-white shadow-sm shadow-emerald-500/20"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                  }`}
              >
                <FileCheck2 className="h-5 w-5" /> Audits
              </button>
              <button
                onClick={() => setActiveTab("reports")}
                className={`flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${activeTab === "reports"
                  ? "bg-emerald-600 text-white shadow-sm shadow-emerald-500/20"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                  }`}
              >
                <FileText className="h-5 w-5" /> Reports
              </button>
            </nav>
          </div>
          <Image
            src="/sidebar-promo.png"
            alt="Smarter Audits, Safer Systems"
            width={360}
            height={200}
            priority
            className="w-full h-auto rounded-2xl border border-emerald-100 object-contain shadow-sm"
          />
        </aside>

        {/* MAIN */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* TOP BAR */}
          <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white/90 px-6 backdrop-blur">
            <div className="flex items-center gap-2 lg:hidden">
              <Image
                src="/logo.png"
                alt="Auditify logo"
                width={36}
                height={36}
                priority
                className="h-9 w-9 rounded-xl object-contain"
              />
              <span className="text-lg font-bold text-slate-900">Auditify</span>
            </div>
            <div className="ml-auto flex items-center gap-3">
              {/* Interactive profile pill: toggleable dropdown with Sign out.
                  (Replaces the former static avatar/name div, which had no
                  click handler - this is the element users see top-right.) */}
              <ProfileSection />
            </div>
          </header>

          {/* BODY */}
          <main className="flex-1 space-y-6 p-6 lg:p-7">
            {activeTab === "dashboard" && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold tracking-tight text-slate-900">
                      {greeting()},{" "}
                      {user?.full_name?.trim() || user?.email || "User"} 👋
                    </h2>
                    <p className="text-sm text-slate-500">Here&apos;s your AI audit overview and compliance status.</p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm">
                    <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                    AI Technical Audit Dashboard
                  </span>
                </div>

                {/* KPI row */}
                <div className="grid grid-cols-12 gap-4">
                  {kpis.map((k) => (
                    <div key={k.label} className="col-span-12 sm:col-span-6 xl:col-span-3">
                      <KpiCard {...k} />
                    </div>
                  ))}
                </div>

                {/* Charts row */}
                <div className="grid grid-cols-12 gap-4">
                  <div className="col-span-12 xl:col-span-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">Compliance Score Trend</h3>
                        <p className="text-xs text-slate-400">across all audit runs</p>
                      </div>
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600">
                        <Activity className="h-3.5 w-3.5" /> {runs.length} audits
                      </span>
                    </div>
                    <div className="h-[280px] w-full">
                      {trendData.length === 0 ? (
                        <div className="flex h-full flex-col items-center justify-center text-slate-300">
                          <Activity className="h-10 w-10" />
                          <p className="mt-2 text-sm">No data yet — run an audit to see trends.</p>
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <defs>
                              <linearGradient id="scoreFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={scoreColor(avgScore)} stopOpacity={0.35} />
                                <stop offset="100%" stopColor={scoreColor(avgScore)} stopOpacity={0.02} />
                              </linearGradient>
                            </defs>
                            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                            <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                            <Tooltip
                              contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }}
                              formatter={(value) => [`${Number(value).toFixed(1)}`, "Score"]}
                            />
                            <Area type="monotone" dataKey="score" stroke={scoreColor(avgScore)} strokeWidth={2.5} fill="url(#scoreFill)" dot={{ r: 3, fill: scoreColor(avgScore) }} activeDot={{ r: 5 }} />
                          </AreaChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>

                  <div className="col-span-12 xl:col-span-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-bold text-slate-900">Compliance Health</h3>
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">Overall</span>
                    </div>
                    <div className="flex flex-col items-center">
                      <DonutCard score={avgScore} />
                      <StatusStrip runs={runs} />
                    </div>
                  </div>
                </div>
              </>
            )}

            {activeTab === "audits" && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold tracking-tight text-slate-900">Audits</h2>
                    <p className="text-sm text-slate-500">Run new audits and inspect every finding from your trail.</p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm">
                    <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                    {runs.length} runs on record
                  </span>
                </div>

                {/* Run audit + detail */}
                <div className="grid grid-cols-12 gap-4">
                  <div className="col-span-12 xl:col-span-5">
                    <UploadPanel activeModel={activeModel} onAuditComplete={handleAuditComplete} />
                  </div>
                  <div className="col-span-12 xl:col-span-7">
                    <RunDetailPanel run={selectedRun} loading={detailLoading} />
                  </div>
                </div>

                {/* Audit trail */}
                <div id="audit-trail" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <AuditTable
                    runs={runs}
                    loading={runsLoading}
                    selectedRunId={selectedRunId}
                    onSelectRun={(id) => setSelectedRunId((prev) => (prev === id ? null : id))}
                  />
                </div>
              </>
            )}

            {activeTab === "reports" && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold tracking-tight text-slate-900">Reports</h2>
                    <p className="text-sm text-slate-500">Download the PDF report for any completed audit run.</p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm">
                    <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                    {runs.length} reports available
                  </span>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                  {runsLoading ? (
                    <div className="space-y-3 p-5">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="h-12 w-full animate-pulse rounded-lg bg-slate-100" />
                      ))}
                    </div>
                  ) : runs.length === 0 ? (
                    <div className="p-10 text-center">
                      <FileText className="mx-auto h-10 w-10 text-slate-300" />
                      <h3 className="mt-3 text-sm font-bold text-slate-900">No reports yet</h3>
                      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                        Run an audit from the Audits tab — every completed run gets a
                        downloadable PDF report here.
                      </p>
                    </div>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {[...runs]
                        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                        .map((run) => (
                          <li key={run.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                              <FileText className="h-5 w-5" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-slate-800">{run.spec_filename}</p>
                              <p className="truncate text-xs text-slate-400">{run.log_filename}</p>
                            </div>
                            <span className="shrink-0 text-xs text-slate-500">
                              {new Date(run.created_at).toLocaleString(undefined, {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                            <span
                              className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 font-mono text-xs font-medium ${scorePillClass(run.compliance_score)}`}
                            >
                              {run.compliance_score.toFixed(1)}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleExportReport(run.id)}
                              disabled={exportingReportId === run.id}
                              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <Download size={13} />
                              {exportingReportId === run.id ? "Exporting…" : "Download PDF"}
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </main>
        </div>
      </div>

      <ChatDrawer activeModel={activeModel} selectedRunId={selectedRunId} />
    </div>
  );
}
