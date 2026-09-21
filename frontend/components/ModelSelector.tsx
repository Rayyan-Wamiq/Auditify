"use client";

import { useEffect, useState } from "react";
import { Cpu, X, Zap } from "lucide-react";
import type { ModelInfo } from "@/lib/types";
import { getModels } from "@/lib/api";

interface Props {
  activeModel: string;
  onSelect: (modelId: string) => void;
}

export default function ModelSelector({ activeModel, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || models.length > 0) return;
    setLoading(true);
    getModels()
      .then((res) => setModels(res.models))
      .catch(() => setModels([]))
      .finally(() => setLoading(false));
  }, [open, models.length]);

  const activeLabel = models.find((m) => m.id === activeModel)?.label ?? activeModel;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:border-slate-300 transition-colors"
      >
        <Cpu size={14} className="text-emerald-600" />
        <span className="hidden md:inline text-slate-500">Model:</span>
        <span className="font-medium text-slate-900 truncate max-w-[140px]">{activeLabel}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30 animate-fade-in">
          <div className="h-full w-full max-w-sm border-l border-slate-200 bg-white p-5 animate-slide-in overflow-y-auto">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Active LLM Model</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Choose the Groq-hosted model used for AI-driven checks and the copilot.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close model selector"
              >
                <X size={16} />
              </button>
            </div>

            {loading && (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-16 animate-pulse rounded-md bg-slate-100" />
                ))}
              </div>
            )}

            <div className="space-y-2">
              {models.map((m) => {
                const active = m.id === activeModel;
                return (
                  <button
                    key={m.id}
                    onClick={() => {
                      onSelect(m.id);
                      setOpen(false);
                    }}
                    className={`w-full rounded-md border p-3 text-left transition-colors ${
                      active
                        ? "border-emerald-600 bg-emerald-50"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-900">{m.label}</span>
                      {active && <Zap size={13} className="text-emerald-600" />}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">{m.description}</p>
                    <p className="mt-1.5 font-mono text-[10.5px] text-slate-400">
                      {m.id} &middot; {m.context_window.toLocaleString()} token context
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
