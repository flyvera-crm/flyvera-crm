"use client";

// The quotation list shared by the whole CRM (Quotations, Customers, Leads, Bookings, Reports).
// Quotations come from Supabase — loaded by the CRM layout on the server, filtered by
// Row Level Security — and changes go through Server Actions in src/lib/actions/quotations.ts.
import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Quotation, QuoteDisplayStatus } from "@/types/crm";
import type { QuoteAccess } from "@/lib/data/quotations";
import { todayIso, useHydrated } from "@/lib/dates";

/** A Sent quotation past its validity date is shown as "Expired". */
export function displayStatus(q: Quotation, today: string | null): QuoteDisplayStatus {
  if (q.status === "Sent" && today && q.validUntil < today) return "Expired";
  return q.status;
}

type QuoteData = {
  quotes: Quotation[];
  access: QuoteAccess;
  /** Codes of quotations created in this session (shown with a "New" tag). */
  addedIds: Set<string>;
  /** Shows a just-saved quotation until the refreshed list from the server arrives. */
  showSaved: (quote: Quotation, isNew: boolean) => void;
};

const QuoteDataContext = createContext<QuoteData | null>(null);

export function QuoteListProvider({
  initialQuotes,
  access,
  children,
}: {
  initialQuotes: Quotation[];
  access: QuoteAccess;
  children: ReactNode;
}) {
  const [overlay, setOverlay] = useState<{ base: Quotation[]; items: Record<string, Quotation> }>({ base: initialQuotes, items: {} });
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set());

  const quotes = useMemo(() => {
    const items = overlay.base === initialQuotes ? overlay.items : {};
    const known = new Set(initialQuotes.map((q) => q.id));
    const fresh = Object.values(items).filter((q) => !known.has(q.id));
    return [...fresh, ...initialQuotes.map((q) => items[q.id] ?? q)];
  }, [initialQuotes, overlay]);

  const showSaved = useCallback(
    (quote: Quotation, isNew: boolean) => {
      setOverlay((o) => ({ base: initialQuotes, items: { ...(o.base === initialQuotes ? o.items : {}), [quote.id]: quote } }));
      if (isNew) setAddedIds((ids) => new Set(ids).add(quote.id));
    },
    [initialQuotes],
  );

  const value = useMemo(() => ({ quotes, access, addedIds, showSaved }), [quotes, access, addedIds, showSaved]);
  return createElement(QuoteDataContext.Provider, { value }, children);
}

export function useQuoteData() {
  const ctx = useContext(QuoteDataContext);
  if (!ctx) throw new Error("useQuoteData must be used inside <QuoteListProvider>");
  return ctx;
}

/** All quotations this user can see, newest first, plus the visitor's date once hydrated. */
export function useQuotations() {
  const { quotes, addedIds } = useQuoteData();
  const hydrated = useHydrated();
  const sorted = useMemo(
    () => [...quotes].sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true })),
    [quotes],
  );
  return {
    quotes: sorted,
    addedIds,
    hydrated,
    /** The visitor's date once hydrated; null during the server render. */
    today: hydrated ? todayIso() : null,
  };
}
