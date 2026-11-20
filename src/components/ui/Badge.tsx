import type { ReactNode } from "react";
import { cn } from "@/lib/format";

export type BadgeTone = "success" | "warning" | "danger" | "info" | "gold" | "neutral" | "premium";

const tones: Record<BadgeTone, string> = {
  premium: "bg-navy-900 text-gold-300 ring-gold-500/40",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
  warning: "bg-amber-50 text-amber-700 ring-amber-600/20",
  danger: "bg-rose-50 text-rose-700 ring-rose-600/15",
  info: "bg-sky-brand-light text-sky-brand-dark ring-sky-brand/20",
  gold: "bg-gold-50 text-gold-700 ring-gold-500/25",
  neutral: "bg-navy-50 text-navy-600 ring-navy-200",
};

const dots: Record<BadgeTone, string> = {
  premium: "bg-gold-400",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  info: "bg-sky-brand",
  gold: "bg-gold-500",
  neutral: "bg-navy-400",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        tones[tone],
      )}
    >
      <span className={cn("size-1.5 rounded-full", dots[tone])} />
      {children}
    </span>
  );
}
