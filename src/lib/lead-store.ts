"use client";

// The lead list shared by the whole CRM (Leads, Quotations, Bookings, Reports).
// Leads come from Supabase — loaded by the CRM layout on the server, filtered by
// Row Level Security — and changes go through Server Actions in src/lib/actions/leads.ts.
import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Lead } from "@/types/crm";
import type { LeadAccess } from "@/lib/data/leads";
import { setLeadStatus, type LeadStatusPatch } from "@/lib/actions/leads";
import { todayIso } from "@/lib/dates";
import { callAction, confirmStageChange } from "@/lib/action-call";

export type { LeadStatusPatch };

type LeadData = {
  leads: Lead[];
  access: LeadAccess;
  /**
   * Changes a lead's stage / follow-up / customer link. The screen updates at once;
   * if the server refuses, it goes back and the returned message explains why.
   */
  updateLeadStatus: (lead: Lead, patch: LeadStatusPatch) => Promise<{ ok: true; lead: Lead } | { ok: false; message: string }>;
  /** Shows a just-saved lead until the refreshed list from the server arrives. */
  showSaved: (lead: Lead) => void;
};

const LeadDataContext = createContext<LeadData | null>(null);

export function LeadListProvider({
  initialLeads,
  access,
  children,
}: {
  initialLeads: Lead[];
  access: LeadAccess;
  children: ReactNode;
}) {
  // Local changes, applied on top of the server list they were made against.
  const [overlay, setOverlay] = useState<{ base: Lead[]; items: Record<string, Lead | undefined> }>({
    base: initialLeads,
    items: {},
  });
  const leads = useMemo(() => {
    const items = overlay.base === initialLeads ? overlay.items : {};
    const known = new Set(initialLeads.map((l) => l.id));
    const fresh = Object.values(items).filter((l): l is Lead => Boolean(l) && !known.has(l!.id));
    return [...fresh, ...initialLeads.map((l) => items[l.id] ?? l)];
  }, [initialLeads, overlay]);

  const put = useCallback(
    (lead: Lead | undefined, code: string) =>
      setOverlay((o) => ({ base: initialLeads, items: { ...(o.base === initialLeads ? o.items : {}), [code]: lead } })),
    [initialLeads],
  );

  const showSaved = useCallback((lead: Lead) => put(lead, lead.id), [put]);

  const updateLeadStatus = useCallback(
    async (lead: Lead, patch: LeadStatusPatch) => {
      if (!lead.dbId) return { ok: false as const, message: "This lead isn't saved in the database." };
      const stage = patch.stage ?? lead.stage;
      const closed = stage === "Won" || stage === "Lost";
      put(
        {
          ...lead,
          stage,
          lostReason: stage === "Lost" ? (patch.lostReason !== undefined ? (patch.lostReason ?? undefined) : lead.lostReason) : undefined,
          nextFollowUp: closed ? undefined : patch.nextFollowUp !== undefined ? (patch.nextFollowUp ?? undefined) : lead.nextFollowUp,
          lastContact: patch.lastContact ?? todayIso(),
          customerId: patch.customerCode ?? lead.customerId,
        },
        lead.id,
      );
      const dbId = lead.dbId;
      // An unexpected failure (the call throws) becomes { ok: false, message } instead of being lost.
      // A "success" whose lead isn't in the requested stage was not saved: treat it as a failure.
      const result = confirmStageChange(
        await callAction(() => setLeadStatus(dbId, patch), "Lead stage change"),
        stage,
      );
      put(result.ok ? result.lead : undefined, lead.id); // on any failure, move the card back
      return result;
    },
    [put],
  );

  const value = useMemo(() => ({ leads, access, updateLeadStatus, showSaved }), [leads, access, updateLeadStatus, showSaved]);
  return createElement(LeadDataContext.Provider, { value }, children);
}

export function useLeadData() {
  const ctx = useContext(LeadDataContext);
  if (!ctx) throw new Error("useLeadData must be used inside <LeadListProvider>");
  return ctx;
}

/** Read-only list of all leads this user can see, for use outside the Leads page. */
export function useLeadList() {
  return useLeadData().leads;
}
