import Link from "next/link";
import type { ActivityItem } from "@/lib/dashboard-metrics";
import { Icon, type IconName } from "@/components/icons";
import { cn, formatDate } from "@/lib/format";

const kindStyle: Record<ActivityItem["kind"], { icon: IconName; cls: string }> = {
  ticket: { icon: "ticket", cls: "bg-sky-brand-light text-sky-brand-dark" },
  payment: { icon: "wallet", cls: "bg-emerald-50 text-emerald-700" },
  booking: { icon: "calendar", cls: "bg-navy-50 text-navy-700" },
  lead: { icon: "target", cls: "bg-gold-50 text-gold-700" },
};

/** Latest booking timeline lines and lead activity this user may see, newest first. */
export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (!items.length) return <p className="py-6 text-center text-sm text-navy-400">No recent activity.</p>;
  return (
    <ol className="relative space-y-5 before:absolute before:inset-y-2 before:left-[17px] before:w-px before:bg-navy-100">
      {items.map((a) => {
        const s = kindStyle[a.kind];
        return (
          <li key={a.id} className="relative flex gap-3">
            <span className={cn("relative grid size-9 shrink-0 place-items-center rounded-full ring-4 ring-white", s.cls)}>
              <Icon name={s.icon} size={16} />
            </span>
            <div className="min-w-0 pt-0.5 text-sm">
              <p className="text-navy-600">
                <Link href={a.href} className="font-medium text-sky-brand-dark hover:underline">
                  {a.target}
                </Link>{" "}
                · {a.text}
              </p>
              <p className="mt-0.5 text-xs text-navy-400">
                {a.who} · {formatDate(a.at)} {a.at.slice(11, 16)} UTC
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
