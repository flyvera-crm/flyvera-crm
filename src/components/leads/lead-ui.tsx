// Small presentational pieces shared by the board, list and details views.
import type { Lead, LeadPriority, LeadSource, LeadStage } from "@/types/crm";
import { LEAD_SOURCES, isOpenStage } from "@/config/lead-options";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Icon } from "@/components/icons";
import { cn, formatDayMonth } from "@/lib/format";

export const stageTone: Record<LeadStage, BadgeTone> = {
  New: "info",
  Contacted: "info",
  Quoted: "neutral",
  Negotiation: "neutral",
  Won: "gold",
  Lost: "danger",
};

const priorityStyle: Record<LeadPriority, string> = {
  Hot: "bg-rose-50 text-rose-700 ring-rose-600/15",
  Warm: "bg-amber-50 text-amber-700 ring-amber-600/20",
  Cold: "bg-navy-50 text-navy-500 ring-navy-200",
};

export function PriorityBadge({ priority }: { priority: LeadPriority }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", priorityStyle[priority])}>
      {priority === "Hot" && <span aria-hidden="true">🔥</span>}
      {priority}
    </span>
  );
}

export function SourceLabel({ source, className }: { source: LeadSource; className?: string }) {
  const icon = LEAD_SOURCES.find((s) => s.value === source)?.icon ?? "globe";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs text-navy-400", className)}>
      <Icon name={icon} size={13} className={source === "WhatsApp" ? "text-green-600" : undefined} />
      {source}
    </span>
  );
}

export function StageBadge({ stage }: { stage: LeadStage }) {
  return <Badge tone={stageTone[stage]}>{stage}</Badge>;
}

export type FollowUpState = "overdue" | "today" | "upcoming" | null;

export function followUpState(lead: Lead, today: string | null): FollowUpState {
  if (!lead.nextFollowUp || !isOpenStage(lead.stage)) return null;
  if (!today) return "upcoming"; // before hydration: show the date without judging it
  if (lead.nextFollowUp < today) return "overdue";
  if (lead.nextFollowUp === today) return "today";
  return "upcoming";
}

/** "Overdue · Nov 15" / "Due today" / "Follow up Nov 22". Date-aware only after hydration (`today`). */
export function FollowUpChip({ lead, today, className }: { lead: Lead; today: string | null; className?: string }) {
  const state = followUpState(lead, today);
  if (!state || !lead.nextFollowUp) return null;
  const date = formatDayMonth(lead.nextFollowUp);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        state === "overdue" && "bg-rose-50 text-rose-700",
        state === "today" && "bg-amber-50 text-amber-700",
        state === "upcoming" && "bg-navy-50 text-navy-500",
        className,
      )}
    >
      <Icon name={state === "overdue" ? "alert" : "clock"} size={12} />
      {state === "overdue" ? `Overdue · ${date}` : state === "today" ? "Due today" : `Follow up ${date}`}
    </span>
  );
}

export function AgentAvatar({ name, className }: { name: string; className?: string }) {
  const short = name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2);
  return (
    <span
      title={`Agent: ${name}`}
      className={cn("grid size-6 shrink-0 place-items-center rounded-full bg-navy-100 text-[10px] font-semibold text-navy-700", className)}
    >
      {short}
    </span>
  );
}
