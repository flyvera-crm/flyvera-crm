"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Quotation, QuoteDisplayStatus } from "@/types/crm";
import { QUOTE_STATUS_TONE, DEFAULT_VALIDITY_DAYS } from "@/config/quote-options";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { leadStore, useLeadList } from "@/lib/lead-store";
import { quoteStore, useQuotations } from "@/lib/quote-store";
import { nextQuoteId } from "@/lib/quote-validation";
import { addDays, todayIso } from "@/lib/dates";
import { formatDate, formatMoney } from "@/lib/format";
import { quoteTotals } from "@/lib/quote-math";

export function QuoteStatusBadge({ status }: { status: QuoteDisplayStatus }) {
  return <Badge tone={QUOTE_STATUS_TONE[status]}>{status}</Badge>;
}

/** Customer-facing message used for WhatsApp / email sharing. */
export function shareText(q: Quotation) {
  const t = quoteTotals(q.items, q.discount, q.taxRate);
  const first = q.recipient.name.split(" ")[0];
  const dates = q.departDate ? ` (${formatDate(q.departDate)}${q.returnDate ? ` – ${formatDate(q.returnDate)}` : ""})` : "";
  return (
    `Hello ${first}, here is your FLYVERA quotation ${q.id} for ${q.title}${dates}.\n` +
    `Total: ${formatMoney(t.total)} for ${q.adults + q.children} traveller${q.adults + q.children === 1 ? "" : "s"}.\n` +
    `Prices are valid until ${formatDate(q.validUntil)}. Reply here to confirm or ask any questions!`
  );
}

/**
 * Status changes for a quotation. Keeps the linked lead in step:
 * sending moves a New/Contacted lead to "Quoted"; accepting moves it to "Won".
 */
export function useQuoteActions() {
  const router = useRouter();
  const toast = useToast();
  const leads = useLeadList();
  const { quotes } = useQuotations();

  const leadFor = useCallback(
    (q: Quotation) => (q.recipient.kind === "lead" ? leads.find((l) => l.id === q.recipient.id) : undefined),
    [leads],
  );

  const markSent = useCallback(
    (q: Quotation) => {
      const date = todayIso();
      quoteStore.update({ ...q, status: "Sent", sentAt: date, updated: date }); // ← later: API call
      const lead = leadFor(q);
      const moved = lead && (lead.stage === "New" || lead.stage === "Contacted");
      if (moved) leadStore.update({ ...lead, stage: "Quoted", lastContact: date });
      toast({
        message: (
          <p>
            <span className="font-mono text-gold-300">{q.id}</span> marked as sent.
            {moved && <> Lead {lead.name} moved to <span className="font-semibold">Quoted</span>.</>}
          </p>
        ),
      });
    },
    [leadFor, toast],
  );

  const markAccepted = useCallback(
    (q: Quotation) => {
      const date = todayIso();
      quoteStore.update({ ...q, status: "Accepted", respondedAt: date, updated: date });
      const lead = leadFor(q);
      const won = lead && lead.stage !== "Won";
      if (won) leadStore.update({ ...lead, stage: "Won", lastContact: date, nextFollowUp: undefined, lostReason: undefined });
      toast({
        message: (
          <p>
            🎉 <span className="font-semibold">{q.recipient.name}</span> accepted {q.id}.
            {won && <> Lead moved to <span className="font-semibold">Won</span>.</>}
          </p>
        ),
        action:
          lead && !lead.customerId
            ? { label: "Open Leads to convert", onClick: () => router.push("/leads") }
            : q.recipient.kind === "customer"
              ? { label: "View customer", onClick: () => router.push(`/customers/${q.recipient.id}`) }
              : undefined,
      });
    },
    [leadFor, router, toast],
  );

  const markDeclined = useCallback(
    (q: Quotation) => {
      const date = todayIso();
      quoteStore.update({ ...q, status: "Declined", respondedAt: date, updated: date });
      toast({
        tone: "info",
        message: (
          <p>
            {q.id} marked as declined. Try a revised quote with <span className="font-semibold">Duplicate</span>.
          </p>
        ),
      });
    },
    [toast],
  );

  /** Copies a quotation into a new draft and opens it for editing. */
  const duplicate = useCallback(
    (q: Quotation) => {
      const date = todayIso();
      const id = nextQuoteId(quotes);
      quoteStore.add({
        ...q,
        id,
        status: "Draft",
        created: date,
        updated: date,
        validUntil: addDays(date, DEFAULT_VALIDITY_DAYS),
        sentAt: undefined,
        respondedAt: undefined,
      });
      toast({ message: <p>Copied {q.id} to new draft <span className="font-mono text-gold-300">{id}</span>.</p> });
      router.push(`/quotations/${id}/edit`);
    },
    [quotes, router, toast],
  );

  return { markSent, markAccepted, markDeclined, duplicate };
}
