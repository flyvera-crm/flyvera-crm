import type { LeadStage } from "@/types/crm";
import { formatCurrency } from "@/lib/format";

type Stage = { stage: LeadStage; count: number; value: number };

// Pipeline by stage: each bar is relative to the busiest stage. Values are the leads' estimated budgets.
export function LeadPipeline({
  stages,
  conversion,
  showValue,
}: {
  stages: Stage[];
  /** Won ÷ closed over the last 90 days, %; null when no lead has been won or lost yet. */
  conversion: number | null;
  /** false for roles that don't see money. */
  showValue: boolean;
}) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  const total = stages.reduce((n, s) => n + s.count, 0);
  if (total === 0) return <p className="py-6 text-center text-sm text-navy-400">No leads yet.</p>;
  return (
    <div>
      <ul className="space-y-3">
        {stages.map((s, i) => (
          <li
            key={s.stage}
            className="grid grid-cols-[88px_1fr_auto] items-center gap-3 text-sm"
            title={`${s.stage}: ${s.count} lead${s.count === 1 ? "" : "s"}${showValue ? `, ${formatCurrency(s.value)}` : ""}`}
          >
            <span className="font-medium text-navy-700">{s.stage}</span>
            <div className="h-6 w-full">
              <div
                className={i === stages.length - 1 ? "h-full rounded-r bg-gold-500" : "h-full rounded-r bg-navy-700"}
                style={{ width: `${(s.count / max) * 100}%`, minWidth: s.count ? 4 : 0, opacity: i === stages.length - 1 ? 1 : 1 - i * 0.15 }}
              />
            </div>
            <span className="w-24 text-right tabular-nums">
              <span className="font-semibold text-navy-900">{s.count}</span>
              {showValue && <span className="ml-1.5 text-xs text-navy-400">{formatCurrency(s.value, { compact: true })}</span>}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 rounded-xl bg-gold-50 px-3 py-2 text-xs text-gold-700">
        {conversion === null ? (
          "No leads won or lost in the last 90 days yet."
        ) : (
          <>
            <span className="font-semibold">{conversion}%</span> of leads closed in the last 90 days were won.
          </>
        )}
      </p>
    </div>
  );
}
