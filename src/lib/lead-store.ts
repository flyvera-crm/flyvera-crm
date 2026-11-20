"use client";

// Leads you add, move or edit are saved in this browser (demo only).
// Later: replace with calls to your backend/API.
import { useMemo, useSyncExternalStore } from "react";
import type { Lead } from "@/types/crm";
import { createLocalCollection } from "@/lib/local-collection";
import { leads as demoLeads } from "@/lib/mock-leads";

export const leadStore = createLocalCollection<Lead>("flyvera.leads.v1");

/** Read-only list of all leads (demo + this browser's changes), for use outside the Leads page. */
export function useLeadList() {
  const stored = useSyncExternalStore(leadStore.subscribe, leadStore.getSnapshot, leadStore.getServerSnapshot);
  return useMemo(() => leadStore.merge(demoLeads, stored), [stored]);
}
