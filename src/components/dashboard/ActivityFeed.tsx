import type { Activity } from "@/types/crm";
import { Icon, type IconName } from "@/components/icons";
import { cn } from "@/lib/format";

const kindStyle: Record<Activity["kind"], { icon: IconName; cls: string }> = {
  ticket: { icon: "ticket", cls: "bg-sky-brand-light text-sky-brand-dark" },
  payment: { icon: "wallet", cls: "bg-emerald-50 text-emerald-700" },
  whatsapp: { icon: "chat", cls: "bg-green-50 text-green-700" },
  booking: { icon: "calendar", cls: "bg-navy-50 text-navy-700" },
  lead: { icon: "document", cls: "bg-gold-50 text-gold-700" },
};

export function ActivityFeed({ items }: { items: Activity[] }) {
  return (
    <ol className="relative space-y-5 before:absolute before:inset-y-2 before:left-[17px] before:w-px before:bg-navy-100">
      {items.map((a) => {
        const s = kindStyle[a.kind];
        return (
          <li key={a.id} className="relative flex gap-3">
            <span className={cn("relative grid size-9 shrink-0 place-items-center rounded-full ring-4 ring-white", s.cls)}>
              <Icon name={s.icon} size={16} />
            </span>
            <div className="pt-0.5 text-sm">
              <p className="text-navy-600">
                <span className="font-semibold text-navy-900">{a.who}</span> {a.action}{" "}
                <span className="font-medium text-navy-900">{a.target}</span>
              </p>
              <p className="mt-0.5 text-xs text-navy-400">{a.time}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
