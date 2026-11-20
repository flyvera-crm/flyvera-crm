import type { LeadStage } from "@/types/crm";
import { formatCurrency } from "@/lib/format";

type Stage = { stage: LeadStage; count: number; value: number };

// Funnel-style pipeline: each stage's bar is relative to the first stage.
export function LeadPipeline({ stages }: { stages: Stage[] }) {
  const first = stages[0].count;
  const won = stages[stages.length - 1].count;
  return (
    <div>
      <ul className="space-y-3">
        {stages.map((s, i) => (
          <li key={s.stage} className="grid grid-cols-[88px_1fr_auto] items-center gap-3 text-sm" title={`${s.stage}: ${s.count} leads, ${formatCurrency(s.value)}`}>
            <span className="font-medium text-navy-700">{s.stage}</span>
            <div className="h-6 w-full">
              <div
                className={i === stages.length - 1 ? "h-full rounded-r bg-gold-500" : "h-full rounded-r bg-navy-700"}
                style={{ width: `${(s.count / first) * 100}%`, opacity: i === stages.length - 1 ? 1 : 1 - i * 0.15 }}
              />
            </div>
            <span className="w-24 text-right tabular-nums">
              <span className="font-semibold text-navy-900">{s.count}</span>
              <span className="ml-1.5 text-xs text-navy-400">{formatCurrency(s.value, { compact: true })}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 rounded-xl bg-gold-50 px-3 py-2 text-xs text-gold-700">
        <span className="font-semibold">{((won / first) * 100).toFixed(0)}%</span> of new leads converted to bookings this month.
      </p>
    </div>
  );
}
