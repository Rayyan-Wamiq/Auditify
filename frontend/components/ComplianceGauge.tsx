"use client";

import { RadialBar, RadialBarChart, PolarAngleAxis } from "recharts";

interface Props {
  score: number;
  label?: string;
}

function scoreColor(score: number): string {
  if (score >= 80) return "#059669"; // emerald-600
  if (score >= 50) return "#d97706"; // amber-600
  return "#dc2626"; // red-600
}

export default function ComplianceGauge({ score, label = "Compliance Score" }: Props) {
  const clamped = Math.max(0, Math.min(100, score));
  const data = [{ name: "score", value: clamped, fill: scoreColor(clamped) }];

  return (
    <div className="flex flex-col items-center">
      <div className="relative h-[168px] w-[168px]">
        <RadialBarChart
          width={168}
          height={168}
          cx="50%"
          cy="50%"
          innerRadius={62}
          outerRadius={80}
          barSize={14}
          data={data}
          startAngle={90}
          endAngle={-270}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar
            background={{ fill: "#f1f5f9" }}
            dataKey="value"
            cornerRadius={8}
            angleAxisId={0}
          />
        </RadialBarChart>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-3xl font-semibold text-slate-900">
            {clamped.toFixed(0)}
          </span>
          <span className="text-[11px] text-slate-400">/ 100</span>
        </div>
      </div>
      <p className="mt-1 text-sm font-medium text-slate-600">{label}</p>
    </div>
  );
}
