"use client";

import { useMemo, useState } from "react";
import { useHydrated } from "@/lib/dates";
import type { Lead, LeadPriority, LeadSource } from "@/types/crm";
import { LEAD_PRIORITIES, LEAD_SOURCES } from "@/config/lead-options";
import { fold } from "@/lib/customer-search";
import { compactPhone } from "@/lib/customer-validation";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/format";
import { followUpState } from "./lead-ui";
import { useLeads } from "./LeadsProvider";
import { LeadsBoard } from "./LeadsBoard";
import { LeadsList } from "./LeadsList";

type View = "board" | "list";
type SortKey = "followUp" | "newest" | "budget";
const VIEW_KEY = "flyvera.leads.view";

function readSavedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "board";
  } catch {
    return "board";
  }
}

/** Every word must appear in the lead's name, ID, email, destination, notes…; phone matches by digits. */
export function matchesLead(l: Lead, query: string) {
  const q = fold(query.trim());
  if (!q) return true;
  const hay = fold([l.name, l.id, l.email ?? "", l.destination, l.tripType, l.agent, l.notes ?? ""].join(" "));
  const digits = q.replace(/\D/g, "");
  return q.split(/\s+/).every((w) => hay.includes(w)) || (digits.length >= 3 && compactPhone(l.phone).includes(digits));
}

function Select<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T | "All";
  onChange: (v: T | "All") => void;
  options: readonly T[];
}) {
  return (
    <label className="relative min-w-0 flex-1 sm:flex-none">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T | "All")}
        className="h-10 w-full appearance-none rounded-xl border border-navy-100 bg-white pl-3 pr-8 text-sm font-medium text-navy-700 focus:border-sky-brand focus:outline-none focus:ring-4 focus:ring-sky-brand/15"
      >
        <option value="All">All {label.toLowerCase()}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-navy-400" />
    </label>
  );
}

export function LeadsWorkspace() {
  const { leads, today } = useLeads();
  // Agent filter: everyone who has leads in this user's view.
  const agentNames = useMemo(() => [...new Set(leads.map((l) => l.agent))].sort((a, b) => a.localeCompare(b)), [leads]);
  // Board/List choice: what you picked now, else what you picked last time (read after hydration).
  const hydrated = useHydrated();
  const [chosenView, setChosenView] = useState<View | null>(null);
  const view: View = chosenView ?? (hydrated ? readSavedView() : "board");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<LeadSource | "All">("All");
  const [agent, setAgent] = useState<string>("All");
  const [priority, setPriority] = useState<LeadPriority | "All">("All");
  const [sort, setSort] = useState<SortKey>("followUp");

  function chooseView(v: View) {
    setChosenView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  }

  const filtered = useMemo(() => {
    const list = leads.filter(
      (l) =>
        (source === "All" || l.source === source) &&
        (agent === "All" || l.agent === agent) &&
        (priority === "All" || l.priority === priority) &&
        matchesLead(l, query),
    );
    // Board keeps its own grouping; the list is sorted.
    const rank = (l: Lead) => ({ overdue: 0, today: 1, upcoming: 2 })[followUpState(l, today) ?? "upcoming"] ?? 3;
    return [...list].sort((a, b) => {
      if (sort === "budget") return b.budget - a.budget;
      if (sort === "newest") return b.created.localeCompare(a.created) || b.id.localeCompare(a.id);
      // Follow-up: overdue first, then due today, then soonest; closed leads last.
      const open = (l: Lead) => (l.stage === "Won" || l.stage === "Lost" ? 1 : 0);
      return (
        open(a) - open(b) ||
        rank(a) - rank(b) ||
        (a.nextFollowUp ?? "9999").localeCompare(b.nextFollowUp ?? "9999")
      );
    });
  }, [leads, source, agent, priority, query, sort, today]);

  const hasFilters = query !== "" || source !== "All" || agent !== "All" || priority !== "All";
  const clearAll = () => {
    setQuery("");
    setSource("All");
    setAgent("All");
    setPriority("All");
  };

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <Card className="p-3 sm:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <label className="relative block min-w-0 xl:flex-1">
            <span className="sr-only">Search leads</span>
            <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, phone, destination, notes…"
              className="h-10 w-full rounded-xl border border-navy-100 bg-canvas pl-10 pr-10 text-sm text-navy-900 placeholder:text-navy-300 focus:border-sky-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-sky-brand/15"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-navy-400 hover:bg-navy-50"
                aria-label="Clear search"
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Select label="Sources" value={source} onChange={setSource} options={LEAD_SOURCES.map((s) => s.value)} />
            <Select label="Agents" value={agent} onChange={setAgent} options={agentNames} />
            <Select label="Priorities" value={priority} onChange={setPriority} options={LEAD_PRIORITIES} />
            <div className="flex rounded-xl border border-navy-100 bg-white p-1" role="group" aria-label="View">
              {(["board", "list"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => chooseView(v)}
                  aria-pressed={view === v}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1 text-sm font-medium capitalize transition",
                    view === v ? "bg-navy-900 text-white" : "text-navy-500 hover:bg-navy-50",
                  )}
                >
                  <Icon name={v === "board" ? "dashboard" : "menu"} size={15} />
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>
        {(hasFilters || view === "list") && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-navy-50 pt-3 text-sm" aria-live="polite">
            <p className="text-navy-500">
              {hasFilters ? (
                <>
                  <span className="font-semibold text-navy-900">{filtered.length}</span> of {leads.length} leads match
                </>
              ) : (
                <>
                  <span className="font-semibold text-navy-900">{leads.length}</span> leads
                </>
              )}
            </p>
            <div className="flex items-center gap-4">
              {view === "list" && (
                <label className="flex items-center gap-2 text-navy-500">
                  Sort by
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortKey)}
                    className="h-8 rounded-lg border border-navy-100 bg-white px-2 text-sm font-medium text-navy-700 focus:border-sky-brand focus:outline-none"
                  >
                    <option value="followUp">Follow-up due</option>
                    <option value="newest">Newest first</option>
                    <option value="budget">Highest budget</option>
                  </select>
                </label>
              )}
              {hasFilters && (
                <button onClick={clearAll} className="font-medium text-sky-brand-dark hover:text-navy-900">
                  Clear filters
                </button>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* ── Board or list ── */}
      {leads.length === 0 ? (
        <Card className="flex flex-col items-center px-6 py-16 text-center">
          <div className="grid size-14 place-items-center rounded-2xl bg-navy-50 text-navy-400">
            <Icon name="target" size={24} />
          </div>
          <p className="mt-4 font-semibold text-navy-900">No leads yet</p>
          <p className="mt-1 max-w-sm text-sm text-navy-400">
            Use <span className="font-medium text-navy-700">New lead</span> to capture your first travel enquiry.
          </p>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="flex flex-col items-center px-6 py-16 text-center">
          <div className="grid size-14 place-items-center rounded-2xl bg-navy-50 text-navy-400">
            <Icon name="search" size={24} />
          </div>
          <p className="mt-4 font-semibold text-navy-900">No leads found</p>
          <p className="mt-1 text-sm text-navy-400">Try a different search or clear the filters.</p>
          <button onClick={clearAll} className="mt-5 rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-800">
            Clear filters
          </button>
        </Card>
      ) : view === "board" ? (
        <LeadsBoard leads={filtered} />
      ) : (
        <Card className="overflow-hidden">
          <LeadsList leads={filtered} />
        </Card>
      )}
    </div>
  );
}
