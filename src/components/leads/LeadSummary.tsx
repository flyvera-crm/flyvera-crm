"use client";

import { Card } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/icons";
import { isOpenStage } from "@/config/lead-options";
import { formatCurrency } from "@/lib/format";
import { followUpState } from "./lead-ui";
import { useLeads } from "./LeadsProvider";

function Stat({ label, value, hint, icon, tone = "navy" }: { label: string; value: string; hint: string; icon: IconName; tone?: "navy" | "gold" | "rose" }) {
  const iconCls =
    tone === "gold" ? "bg-navy-900 text-gold-300" : tone === "rose" ? "bg-rose-50 text-rose-600" : "bg-navy-50 text-navy-700";
  return (
    <Card className="flex items-center gap-4 p-4 sm:p-5">
      <div className={`grid size-11 shrink-0 place-items-center rounded-xl ${iconCls}`}>
        <Icon name={icon} size={20} />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-navy-500">{label}</p>
        <p className="text-xl font-semibold tracking-tight text-navy-900">{value}</p>
        <p className="truncate text-xs text-navy-400">{hint}</p>
      </div>
    </Card>
  );
}

export function LeadSummary() {
  const { leads, today } = useLeads();
  const open = leads.filter((l) => isOpenStage(l.stage));
  const pipeline = open.reduce((s, l) => s + l.budget, 0);
  const won = leads.filter((l) => l.stage === "Won").length;
  const lost = leads.filter((l) => l.stage === "Lost").length;
  const winRate = won + lost ? Math.round((won / (won + lost)) * 100) : 0;
  const hot = open.filter((l) => l.priority === "Hot").length;
  const overdue = open.filter((l) => followUpState(l, today) === "overdue").length;
  const dueToday = open.filter((l) => followUpState(l, today) === "today").length;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Open leads" value={String(open.length)} hint={`${hot} marked hot 🔥`} icon="target" />
      <Stat label="Pipeline value" value={formatCurrency(pipeline, { compact: true })} hint="Sum of open lead budgets" icon="wallet" tone="gold" />
      <Stat label="Win rate" value={`${winRate}%`} hint={`${won} won · ${lost} lost`} icon="chart" />
      <Stat
        label="Follow-ups"
        value={today ? String(overdue + dueToday) : "—"}
        hint={today ? `${overdue} overdue · ${dueToday} due today` : "Checking dates…"}
        icon="clock"
        tone={overdue ? "rose" : "navy"}
      />
    </div>
  );
}
