"use client";

import { ShieldCheck } from "lucide-react";
import ModelSelector from "./ModelSelector";
import ProfileSection from "./ProfileSection";

interface Props {
  activeModel: string;
  onSelectModel: (id: string) => void;
}

export default function Header({ activeModel, onSelectModel }: Props) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-900">
            <ShieldCheck size={17} className="text-emerald-400" />
          </span>
          <div className="leading-tight">
            <h1 className="text-[15px] font-semibold tracking-tight text-slate-900">Auditify</h1>
            <p className="text-[11px] text-slate-500">AI Technical Audit &amp; Compliance Engine</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <ModelSelector activeModel={activeModel} onSelect={onSelectModel} />
          <ProfileSection />
        </div>
      </div>
    </header>
  );
}
