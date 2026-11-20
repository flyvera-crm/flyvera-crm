import type { Kpi } from "@/types/crm";
import { Icon } from "@/components/icons";
import { Card } from "@/components/ui/Card";
import { cn, formatCurrency, formatNumber } from "@/lib/format";

function formatValue(kpi: Kpi) {
  if (kpi.format === "currency") return formatCurrency(kpi.value);
  if (kpi.format === "percent") return `${kpi.value}%`;
  return formatNumber(kpi.value);
}

function Sparkline({ data }: { data: number[] }) {
  const w = 100;
  const h = 32;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - 2 - ((v - min) / (max - min || 1)) * (h - 4);
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-8 w-full overflow-visible" aria-hidden="true">
      {/* earlier periods in a recessive tone, current period highlighted */}
      <path d={line} fill="none" stroke="var(--color-navy-200)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="3.5" fill="var(--color-sky-brand-dark)" stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function StatCard({ kpi, upIsGood = true }: { kpi: Kpi; upIsGood?: boolean }) {
  const up = kpi.delta >= 0;
  const good = up === upIsGood;
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-navy-500">{kpi.label}</p>
        <div className="grid size-10 place-items-center rounded-xl bg-navy-50 text-navy-700">
          <Icon name={kpi.icon} size={20} />
        </div>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-navy-900 sm:text-[28px]">{formatValue(kpi)}</p>
      <div className="mt-1 flex items-center gap-2 text-xs">
        <span
          className={cn(
            "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold",
            good ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700",
          )}
        >
          <Icon name={up ? "arrowUp" : "arrowDown"} size={12} strokeWidth={2.5} />
          {up ? "+" : ""}
          {kpi.delta}%
        </span>
        <span className="text-navy-400">{kpi.period}</span>
      </div>
      <div className="mt-4">
        <Sparkline data={kpi.trend} />
      </div>
    </Card>
  );
}
