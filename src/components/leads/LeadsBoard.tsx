"use client";

import { useState } from "react";
import type { Lead, LeadStage } from "@/types/crm";
import { LEAD_STAGES } from "@/config/lead-options";
import { Icon } from "@/components/icons";
import { cn, formatCurrency, formatDayMonth } from "@/lib/format";
import { AgentAvatar, FollowUpChip, PriorityBadge, SourceLabel } from "./lead-ui";
import { useLeads } from "./LeadsProvider";

const DRAG_TYPE = "application/x-flyvera-lead";

/** Kanban board: one column per stage. Drag cards between columns, or use each card's "Move to" menu. */
export function LeadsBoard({ leads }: { leads: Lead[] }) {
  const { moveLead } = useLeads();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<LeadStage | null>(null);

  return (
    <div
      className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:snap-none lg:px-0"
      role="list"
      aria-label="Lead pipeline"
    >
      {LEAD_STAGES.map((stage) => {
        const items = leads.filter((l) => l.stage === stage.value);
        const total = items.reduce((s, l) => s + l.budget, 0);
        const isOver = overStage === stage.value && dragId !== null;
        return (
          <section
            key={stage.value}
            role="listitem"
            aria-label={`${stage.value}: ${items.length} leads`}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
              e.preventDefault(); // allow dropping here
              e.dataTransfer.dropEffect = "move";
              if (overStage !== stage.value) setOverStage(stage.value);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverStage(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData(DRAG_TYPE);
              setOverStage(null);
              setDragId(null);
              if (id) moveLead(id, stage.value);
            }}
            className={cn(
              "flex w-[85vw] max-w-[300px] shrink-0 snap-start flex-col rounded-2xl border bg-canvas transition-colors sm:w-[280px]",
              isOver ? "border-sky-brand bg-sky-brand-light/50" : "border-navy-100/80",
            )}
          >
            <header className="px-3.5 pb-3 pt-3.5">
              <span className={cn("mb-3 block h-1 rounded-full", stage.accent)} />
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-navy-900">
                  {stage.value}
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-navy-500 ring-1 ring-navy-100">
                    {items.length}
                  </span>
                </h2>
                <span className="text-xs font-semibold tabular-nums text-navy-500">{formatCurrency(total, { compact: true })}</span>
              </div>
              <p className="mt-0.5 text-xs text-navy-400">{stage.hint}</p>
            </header>

            <div className="flex min-h-32 flex-1 flex-col gap-2.5 px-2.5 pb-2.5">
              {items.map((lead) => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  dragging={dragId === lead.id}
                  onDragStart={() => setDragId(lead.id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverStage(null);
                  }}
                />
              ))}
              {items.length === 0 && (
                <div
                  className={cn(
                    "grid flex-1 place-items-center rounded-xl border-2 border-dashed px-3 py-6 text-center text-xs",
                    isOver ? "border-sky-brand text-sky-brand-dark" : "border-navy-100 text-navy-300",
                  )}
                >
                  {dragId ? "Drop here" : "No leads"}
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function LeadCard({
  lead,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  lead: Lead;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const { openLead, moveLead, today, addedIds, canEdit } = useLeads();
  return (
    <article
      draggable={canEdit}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, lead.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative rounded-xl border bg-white p-3.5 shadow-[0_1px_2px_rgba(11,31,58,0.05)] transition",
        canEdit && "cursor-grab active:cursor-grabbing",
        "hover:border-sky-brand/40 hover:shadow-md",
        lead.priority === "Hot" && lead.stage !== "Won" && lead.stage !== "Lost" ? "border-rose-200" : "border-navy-100",
        lead.stage === "Lost" && "opacity-70",
        dragging && "rotate-1 opacity-50",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-navy-400">{lead.id}</span>
        <div className="flex items-center gap-1.5">
          {addedIds.has(lead.id) && (
            <span className="rounded bg-gold-500 px-1 text-[10px] font-bold uppercase text-navy-950">New</span>
          )}
          <PriorityBadge priority={lead.priority} />
        </div>
      </div>

      {/* The name button's ::after covers the card, so clicking anywhere opens the details. */}
      <h3 className="mt-1.5 font-semibold leading-snug text-navy-900">
        <button
          onClick={() => openLead(lead.id)}
          className="text-left after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-sky-brand"
        >
          {lead.name}
        </button>
      </h3>

      <p className="mt-1 flex items-center gap-1.5 text-sm text-navy-600">
        <Icon name="plane" size={14} className="shrink-0 text-sky-brand-dark" />
        <span className="truncate">
          {lead.destination} <span className="text-navy-400">· {lead.tripType}</span>
        </span>
      </p>
      <p className="mt-0.5 text-xs text-navy-400">
        {lead.departDate ? formatDayMonth(lead.departDate) : "Flexible dates"} · {lead.travellers}{" "}
        {lead.travellers === 1 ? "traveller" : "travellers"}
      </p>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold tabular-nums text-navy-900">{lead.budget ? formatCurrency(lead.budget) : "—"}</span>
        <div className="flex items-center gap-1.5">
          <SourceLabel source={lead.source} />
          <AgentAvatar name={lead.agent} />
        </div>
      </div>

      {(lead.nextFollowUp || lead.customerId || lead.lostReason) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <FollowUpChip lead={lead} today={today} />
          {lead.customerId && (
            <span className="inline-flex items-center gap-1 rounded-md bg-gold-50 px-1.5 py-0.5 text-[11px] font-medium text-gold-700">
              <Icon name="check" size={12} strokeWidth={2.5} /> Customer {lead.customerId}
            </span>
          )}
          {lead.lostReason && (
            <span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-700">{lead.lostReason}</span>
          )}
        </div>
      )}

      {/* Keyboard / touch alternative to drag & drop (sits above the card's click area). */}
      {canEdit && (
      <label className="relative z-10 mt-3 flex items-center gap-2 border-t border-navy-50 pt-2.5 text-xs text-navy-400">
        <span className="shrink-0">Move to</span>
        <select
          value={lead.stage}
          onChange={(e) => moveLead(lead.id, e.target.value as LeadStage)}
          aria-label={`Move ${lead.name} to stage`}
          className="h-7 min-w-0 flex-1 cursor-pointer rounded-lg border border-navy-100 bg-white px-1.5 text-xs font-medium text-navy-700 focus:border-sky-brand focus:outline-none focus:ring-2 focus:ring-sky-brand/20"
        >
          {LEAD_STAGES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.value}
            </option>
          ))}
        </select>
      </label>
      )}
    </article>
  );
}
