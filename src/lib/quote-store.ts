"use client";

// Quotations you create or change are saved in this browser (demo only).
// Later: replace with calls to your backend/API.
import { useMemo, useSyncExternalStore } from "react";
import type { Quotation, QuoteDisplayStatus } from "@/types/crm";
import { createLocalCollection } from "@/lib/local-collection";
import { quotations as demoQuotations } from "@/lib/mock-quotations";
import { todayIso, useHydrated } from "@/lib/dates";

export const quoteStore = createLocalCollection<Quotation>("flyvera.quotations.v1");

/** A Sent quotation past its validity date is shown as "Expired". */
export function displayStatus(q: Quotation, today: string | null): QuoteDisplayStatus {
  if (q.status === "Sent" && today && q.validUntil < today) return "Expired";
  return q.status;
}

/** All quotations (demo + this browser's changes), newest first. */
export function useQuotations() {
  const stored = useSyncExternalStore(quoteStore.subscribe, quoteStore.getSnapshot, quoteStore.getServerSnapshot);
  const hydrated = useHydrated();
  const quotes = useMemo(
    () => quoteStore.merge(demoQuotations, stored).sort((a, b) => b.id.localeCompare(a.id)),
    [stored],
  );
  const addedIds = useMemo(() => new Set(stored.added.map((q) => q.id)), [stored]);
  return {
    quotes,
    addedIds,
    changedCount: stored.added.length + Object.keys(stored.edited).length,
    hydrated,
    /** The visitor's date once hydrated; null during the server render. */
    today: hydrated ? todayIso() : null,
  };
}
