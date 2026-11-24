"use client";

import { useTransition, type ReactNode } from "react";
import Link from "next/link";
import { displayStatus, useQuoteData, useQuotations } from "@/lib/quote-store";
import { quoteTotals } from "@/lib/quote-math";
import { compactPhone } from "@/lib/customer-validation";
import { LOW_MARGIN_PERCENT } from "@/config/quote-options";
import { Card, CardHeader } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/icons";
import { cn, formatDate, formatMoney } from "@/lib/format";
import { QuoteDocument } from "./QuoteDocument";
import { QuoteMissing } from "./QuoteEditor";
import { QuoteStatusBadge, shareText, useQuoteActions } from "./quote-actions";
import { useBookingActions } from "@/components/bookings/use-booking-actions";
import { useBookingData, useBookings } from "@/lib/booking-store";

// Bookings come from the database (shared list), so accepted quotations link to their real booking.
const BOOKINGS_CONNECTED = true;

export function QuoteView({ id }: { id: string }) {
  const { quotes, today } = useQuotations();
  const { access } = useQuoteData();
  const actions = useQuoteActions();
  const { createFromQuote } = useBookingActions();
  const { bookings } = useBookings();
  const canBook = useBookingData().access.canCreate;
  const [busy, startBusy] = useTransition();
  const quote = quotes.find((q) => q.id === id);
  const booking = quote && BOOKINGS_CONNECTED ? bookings.find((b) => b.quoteId === quote.id) : undefined;

  // Quotations are loaded on the server, so a missing one isn't there or isn't visible to this role.
  if (!quote) return <QuoteMissing id={id} />;

  const status = displayStatus(quote, today);
  const t = quoteTotals(quote.items, quote.discount, quote.taxRate);
  const canEdit = access.canEdit;
  const editable = canEdit && (quote.status === "Draft" || quote.status === "Sent");
  /** Runs a status action once (buttons are disabled until it finishes). */
  const run = (action: () => Promise<void>) => startBusy(action);
  const text = encodeURIComponent(shareText(quote));
  const waHref = `https://wa.me/${compactPhone(quote.recipient.phone).replace("+", "")}?text=${text}`;
  const mailHref = quote.recipient.email
    ? `mailto:${quote.recipient.email}?subject=${encodeURIComponent(`Your FLYVERA quotation ${quote.id} — ${quote.title}`)}&body=${text}`
    : undefined;
  const recipientHref = quote.recipient.kind === "customer" ? `/customers/${quote.recipient.id}` : "/leads";

  return (
    <div className="space-y-6">
      {/* ── Toolbar (not printed) ── */}
      <div className="space-y-4 print:hidden">
        <Link href="/quotations" className="inline-flex items-center gap-1.5 text-sm font-medium text-navy-500 hover:text-navy-900">
          <Icon name="arrowRight" size={16} className="rotate-180" /> All quotations
        </Link>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-navy-400">{quote.id}</span>
              <QuoteStatusBadge status={status} />
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">{quote.title}</h1>
            <p className="mt-1 text-sm text-navy-500">
              For{" "}
              <Link href={recipientHref} className="font-medium text-sky-brand-dark hover:underline">
                {quote.recipient.name}
              </Link>{" "}
              ({quote.recipient.kind === "lead" ? `lead ${quote.recipient.id}` : quote.recipient.id}) · {formatMoney(t.total)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit && quote.status === "Draft" && (
              <ToolbarButton primary icon="arrowRight" disabled={busy} onClick={() => run(() => actions.markSent(quote))}>
                Mark as sent
              </ToolbarButton>
            )}
            {canEdit && quote.status === "Sent" && (
              <>
                <ToolbarButton primary icon="check" disabled={busy} onClick={() => run(() => actions.markAccepted(quote))}>
                  Accepted
                </ToolbarButton>
                <ToolbarButton danger icon="close" disabled={busy} onClick={() => run(() => actions.markDeclined(quote))}>
                  Declined
                </ToolbarButton>
              </>
            )}
            {quote.status === "Accepted" &&
              (!BOOKINGS_CONNECTED ? (
                <span className="flex items-center gap-2 rounded-xl bg-navy-50 px-4 py-2 text-sm text-navy-500">
                  <Icon name="calendar" size={16} /> Bookings will be connected next
                </span>
              ) : booking ? (
                <ToolbarLink href={`/bookings/${booking.id}`} icon="calendar">
                  View booking {booking.id}
                </ToolbarLink>
              ) : (
                canBook && (
                  <ToolbarButton primary icon="calendar" onClick={() => createFromQuote(quote)}>
                    Create booking
                  </ToolbarButton>
                )
              ))}
            {editable && (
              <ToolbarLink href={`/quotations/${quote.id}/edit`} icon="settings">
                Edit
              </ToolbarLink>
            )}
            {canEdit && (
              <ToolbarButton icon="document" disabled={busy} onClick={() => run(() => actions.duplicate(quote))}>
                Duplicate
              </ToolbarButton>
            )}
            <ToolbarButton icon="chart" onClick={() => window.print()}>
              Print / PDF
            </ToolbarButton>
          </div>
        </div>
        {status === "Expired" && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            <span>
              This quotation expired on {formatDate(quote.validUntil)}.{" "}
              {canEdit ? (
                <>
                  <Link href={`/quotations/${quote.id}/edit`} className="font-semibold underline">Edit it</Link> to extend the validity and
                  re-check prices before sending again.
                </>
              ) : (
                "Its agent can extend the validity and re-check prices."
              )}
            </span>
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3 print:block">
        <div className="xl:col-span-2">
          <QuoteDocument quote={quote} />
        </div>

        {/* ── Side panel (not printed) ── */}
        <aside className="space-y-6 print:hidden">
          <Card>
            <CardHeader title="Send to customer" subtitle="Opens WhatsApp or your email with a ready-written message." />
            <div className="grid grid-cols-2 gap-2 p-5 sm:px-6">
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-xl border border-navy-100 py-2.5 text-sm font-medium text-navy-700 hover:border-green-300 hover:bg-green-50"
              >
                <Icon name="chat" size={16} className="text-green-600" /> WhatsApp
              </a>
              {mailHref ? (
                <a
                  href={mailHref}
                  className="flex items-center justify-center gap-2 rounded-xl border border-navy-100 py-2.5 text-sm font-medium text-navy-700 hover:border-sky-brand/40 hover:bg-sky-brand-light/40"
                >
                  <Icon name="document" size={16} className="text-sky-brand-dark" /> Email
                </a>
              ) : (
                <span className="flex items-center justify-center gap-2 rounded-xl border border-navy-100 py-2.5 text-sm text-navy-300" title="No email on file">
                  <Icon name="document" size={16} /> No email
                </span>
              )}
              {quote.status === "Draft" && (
                <p className="col-span-2 text-xs text-navy-400">After sending, press “Mark as sent” so the pipeline stays up to date.</p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Profit" subtitle="Internal — never shown to the customer" />
            <dl className="space-y-2 p-5 text-sm sm:px-6">
              <Row label="Customer pays" value={formatMoney(t.total)} />
              <Row label="Supplier cost" value={formatMoney(t.cost)} />
              <Row label="Profit" value={formatMoney(t.profit)} strong />
              <div className="flex items-center justify-between">
                <dt className="text-navy-500">Margin</dt>
                <dd
                  className={cn(
                    "rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums",
                    t.margin < LOW_MARGIN_PERCENT ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700",
                  )}
                >
                  {t.margin.toFixed(1)}%
                </dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="History" />
            <ol className="space-y-3 p-5 text-sm sm:px-6">
              <Step done label="Created" date={quote.created} />
              <Step done={!!quote.sentAt} label="Sent to customer" date={quote.sentAt} />
              <Step
                done={!!quote.respondedAt}
                label={quote.status === "Declined" ? "Declined" : "Accepted"}
                date={quote.respondedAt}
                tone={quote.status === "Declined" ? "rose" : "emerald"}
              />
            </ol>
            <p className="border-t border-navy-50 px-5 py-3 text-xs text-navy-400 sm:px-6">
              Prepared by {quote.agent} · last updated {formatDate(quote.updated)}
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-navy-500">{label}</dt>
      <dd className={cn("tabular-nums", strong ? "font-semibold text-navy-900" : "text-navy-700")}>{value}</dd>
    </div>
  );
}

function Step({ done, label, date, tone = "emerald" }: { done: boolean; label: string; date?: string; tone?: "emerald" | "rose" }) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-full",
          !done ? "border-2 border-dashed border-navy-200" : tone === "rose" ? "bg-rose-100 text-rose-600" : "bg-emerald-100 text-emerald-700",
        )}
      >
        {done && <Icon name={tone === "rose" ? "close" : "check"} size={12} strokeWidth={3} />}
      </span>
      <span className={done ? "text-navy-900" : "text-navy-400"}>{label}</span>
      <span className="ml-auto text-xs text-navy-400">{date ? formatDate(date) : "—"}</span>
    </li>
  );
}

const toolbarCls = (primary?: boolean, danger?: boolean) =>
  cn(
    "flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition",
    primary && "bg-navy-900 text-white shadow-sm hover:bg-navy-800",
    danger && "border border-rose-200 bg-white text-rose-600 hover:bg-rose-50",
    !primary && !danger && "border border-navy-100 bg-white text-navy-700 hover:bg-navy-50",
  );

function ToolbarButton({
  icon,
  primary,
  danger,
  disabled,
  onClick,
  children,
}: {
  icon: IconName;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cn(toolbarCls(primary, danger), "disabled:cursor-wait disabled:opacity-60")}>
      <Icon name={icon} size={16} className={primary ? "text-gold-300" : undefined} /> {children}
    </button>
  );
}

function ToolbarLink({ href, icon, children }: { href: string; icon: IconName; children: ReactNode }) {
  return (
    <Link href={href} className={toolbarCls()}>
      <Icon name={icon} size={16} /> {children}
    </Link>
  );
}
