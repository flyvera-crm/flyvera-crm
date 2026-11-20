import type { LabeledValue } from "@/types/crm";

// Horizontal single-series bar list: label above, thin bar, value at the tip.
export function BarList({
  data,
  format = (v) => String(v),
  unit = "",
}: {
  data: LabeledValue[];
  format?: (v: number) => string;
  unit?: string;
}) {
  const max = Math.max(...data.map((d) => d.value));
  return (
    <ul className="space-y-3.5">
      {data.map((d) => (
        <li key={d.label} title={`${d.label}: ${format(d.value)}${unit}`}>
          <div className="mb-1.5 flex items-baseline justify-between text-sm">
            <span className="font-medium text-navy-700">{d.label}</span>
            <span className="tabular-nums text-navy-500">
              {format(d.value)}
              {unit}
            </span>
          </div>
          <div className="h-2.5 w-full rounded-r bg-navy-50">
            <div
              className="h-full rounded-r bg-sky-brand-dark transition-[width] duration-700"
              style={{ width: `${(d.value / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
