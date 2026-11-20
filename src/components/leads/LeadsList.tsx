"use client";

import type { Lead } from "@/types/crm";
import { Icon } from "@/components/icons";
import { cn, formatCurrency, formatDayMonth } from "@/lib/format";
import { AgentAvatar, FollowUpChip, PriorityBadge, SourceLabel, StageBadge } from "./lead-ui";
import { useLeads } from "./LeadsProvider";

/** Table view of leads (cards on phones). Clicking a lead opens its details. */
export function LeadsList({ leads }: { leads: Lead[] }) {
  const { openLead, today } = useLeads();

  return (
    <>
      {/* Phones: cards */}
      <ul className="divide-y divide-navy-50 md:hidden">
        {leads.map((l) => (
          <li key={l.id} className="relative px-4 py-4 active:bg-sky-brand-light/40">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold text-navy-900">
                  <button onClick={() => openLead(l.id)} className="text-left after:absolute after:inset-0">
                    {l.name}
                  </button>
                </p>
                <p className="truncate text-sm text-navy-500">
                  {l.destination} · {l.travellers} pax
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-sm font-semibold tabular-nums text-navy-900">{l.budget ? formatCurrency(l.budget) : "—"}</span>
                <StageBadge stage={l.stage} />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <PriorityBadge priority={l.priority} />
              <SourceLabel source={l.source} />
              <FollowUpChip lead={l} today={today} />
            </div>
          </li>
        ))}
      </ul>

      {/* Tablet & desktop: table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Leads</caption>
          <thead>
            <tr className="border-b border-navy-50 bg-canvas/60 text-left text-xs font-semibold uppercase tracking-wider text-navy-400">
              <th scope="col" className="py-3 pl-6 pr-3">Lead</th>
              <th scope="col" className="px-3 py-3">Trip</th>
              <th scope="col" className="px-3 py-3 text-right">Budget</th>
              <th scope="col" className="px-3 py-3">Stage</th>
              <th scope="col" className="hidden px-3 py-3 lg:table-cell">Follow-up</th>
              <th scope="col" className="hidden py-3 pl-3 pr-6 xl:table-cell">Agent</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-50">
            {leads.map((l) => (
              <tr
                key={l.id}
                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest("button")) openLead(l.id);
                }}
                className={cn("group cursor-pointer transition-colors hover:bg-sky-brand-light/40", l.stage === "Lost" && "opacity-70")}
              >
                <td className="py-3.5 pl-6 pr-3">
                  <p className="flex items-center gap-2 whitespace-nowrap font-medium text-navy-900">
                    <button onClick={() => openLead(l.id)} className="rounded text-left group-hover:text-sky-brand-dark focus-visible:outline-2 focus-visible:outline-sky-brand">
                      {l.name}
                    </button>
                    <PriorityBadge priority={l.priority} />
                  </p>
                  <p className="mt-0.5 flex items-center gap-2 whitespace-nowrap text-xs text-navy-400">
                    <span className="font-mono">{l.id}</span> <SourceLabel source={l.source} />
                  </p>
                </td>
                <td className="whitespace-nowrap px-3 py-3.5">
                  <p className="flex items-center gap-1.5 font-medium text-navy-700">
                    <Icon name="plane" size={13} className="text-sky-brand-dark" /> {l.destination}
                  </p>
                  <p className="text-xs text-navy-400">
                    {l.departDate ? formatDayMonth(l.departDate) : "Flexible"} · {l.travellers} pax · {l.tripType}
                  </p>
                </td>
                <td className="whitespace-nowrap px-3 py-3.5 text-right font-semibold tabular-nums text-navy-900">
                  {l.budget ? formatCurrency(l.budget) : "—"}
                </td>
                <td className="px-3 py-3.5">
                  <StageBadge stage={l.stage} />
                </td>
                <td className="hidden whitespace-nowrap px-3 py-3.5 lg:table-cell">
                  <FollowUpChip lead={l} today={today} />
                  {!l.nextFollowUp && <span className="text-xs text-navy-300">—</span>}
                </td>
                <td className="hidden py-3.5 pl-3 pr-6 xl:table-cell">
                  <span className="flex items-center gap-2 whitespace-nowrap text-navy-600">
                    <AgentAvatar name={l.agent} /> {l.agent}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
