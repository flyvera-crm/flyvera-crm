"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Quotation, QuoteDisplayStatus } from "@/types/crm";
import { QUOTE_STATUS_TONE } from "@/config/quote-options";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { useLeadData } from "@/lib/lead-store";
import { useQuoteData } from "@/lib/quote-store";
import { duplicateQuote, setQuoteStatus } from "@/lib/actions/quotations";
import { formatDate, formatMoney } from "@/lib/format";
import { quoteTotals } from "@/lib/quote-math";
import { callAction } from "@/lib/action-call";
import { confirmQuoteStatus } from "@/lib/quote-status";
import { clientOutcome, newTraceId, traceLine } from "@/lib/trace";

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
 * Status changes for a quotation, saved to the database. Keeps the linked lead in step:
 * sending moves a New/Contacted lead to "Quoted"; accepting moves it to "Won".
 */
export function useQuoteActions() {
  const router = useRouter();
  const toast = useToast();
  const { leads, updateLeadStatus } = useLeadData();
  const { showSaved } = useQuoteData();

  const leadFor = useCallback(
    (q: Quotation) => (q.recipient.kind === "lead" ? leads.find((l) => l.id === q.recipient.id) : undefined),
    [leads],
  );

  /** Saves a status; shows the reason and returns null when the server refuses. */
  const changeStatus = useCallback(
    async (q: Quotation, status: "Sent" | "Accepted" | "Declined") => {
      const dbId = q.dbId;
      if (!dbId) return null;
      // Diagnostic (browser console): one trace ID ties this click to the server's crm-trace lines.
      const trace = newTraceId();
      console.info(traceLine("client-start", { action: "quote-status", trace, to: status }));
      // A failed request becomes a message (never a crash), and a "success" without the new status isn't one.
      const result = confirmQuoteStatus(await callAction(() => setQuoteStatus(dbId, status, trace), "Quotation status change"), status);
      console.info(traceLine("client-end", { action: "quote-status", trace, to: status, outcome: clientOutcome(result) }));
      if (!result.ok) {
        toast({ tone: "info", message: <p>{result.message}</p> });
        return null;
      }
      showSaved(result.quote, false);
      return result.quote;
    },
    [showSaved, toast],
  );

  const markSent = useCallback(
    async (q: Quotation) => {
      if (!(await changeStatus(q, "Sent"))) return;
      const lead = leadFor(q);
      const move = lead && (lead.stage === "New" || lead.stage === "Contacted");
      // The lead message reflects what was actually saved.
      const leadResult = move ? await updateLeadStatus(lead, { stage: "Quoted" }) : null;
      toast({
        message: (
          <p>
            <span className="font-mono text-gold-300">{q.id}</span> marked as sent.
            {lead && leadResult?.ok && <> Lead {lead.name} moved to <span className="font-semibold">Quoted</span>.</>}
            {leadResult && !leadResult.ok && <> The lead wasn&apos;t moved to Quoted: {leadResult.message}</>}
          </p>
        ),
      });
    },
    [changeStatus, leadFor, toast, updateLeadStatus],
  );

  const markAccepted = useCallback(
    async (q: Quotation) => {
      if (!(await changeStatus(q, "Accepted"))) return;
      const lead = leadFor(q);
      const win = lead && lead.stage !== "Won";
      // The lead message reflects what was actually saved.
      const leadResult = win ? await updateLeadStatus(lead, { stage: "Won", lostReason: null, nextFollowUp: null }) : null;
      toast({
        message: (
          <p>
            🎉 <span className="font-semibold">{q.recipient.name}</span> accepted {q.id}.
            {leadResult?.ok && <> Lead moved to <span className="font-semibold">Won</span>.</>}
            {leadResult && !leadResult.ok && <> The lead wasn&apos;t moved to Won: {leadResult.message}</>}
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
    [changeStatus, leadFor, router, toast, updateLeadStatus],
  );

  const markDeclined = useCallback(
    async (q: Quotation) => {
      if (!(await changeStatus(q, "Declined"))) return;
      toast({
        tone: "info",
        message: (
          <p>
            {q.id} marked as declined. Try a revised quote with <span className="font-semibold">Duplicate</span>.
          </p>
        ),
      });
    },
    [changeStatus, toast],
  );

  /** Copies a quotation into a new draft and opens it for editing. */
  const duplicate = useCallback(
    async (q: Quotation) => {
      const dbId = q.dbId;
      if (!dbId) return;
      const result = await callAction(() => duplicateQuote(dbId), "Quotation duplicate");
      if (!result.ok) {
        toast({ tone: "info", message: <p>{result.message}</p> });
        return;
      }
      showSaved(result.quote, true);
      toast({
        message: (
          <p>
            Copied {q.id} to new draft <span className="font-mono text-gold-300">{result.quote.id}</span>.
          </p>
        ),
      });
      router.push(`/quotations/${result.quote.id}/edit`);
    },
    [router, showSaved, toast],
  );

  return { markSent, markAccepted, markDeclined, duplicate };
}
