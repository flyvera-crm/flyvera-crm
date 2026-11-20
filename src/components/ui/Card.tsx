import type { ReactNode } from "react";
import { cn } from "@/lib/format";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-navy-100/80 bg-white shadow-[0_1px_2px_rgba(11,31,58,0.04),0_8px_24px_-12px_rgba(11,31,58,0.08)]",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 sm:px-6">
      <div>
        <h2 className="text-base font-semibold text-navy-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-navy-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
