"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { Lead, LeadStage } from "@/types/crm";
import { LEAD_STAGES, OPEN_STAGES } from "@/config/lead-options";
import { compactPhone } from "@/lib/customer-validation";
import { Icon, type IconName } from "@/components/icons";
import { cn, formatCurrency, formatDate, formatMoney } from "@/lib/format";
import { FollowUpChip, PriorityBadge, SourceLabel, StageBadge } from "./lead-ui";
import { displayStatus, useQuotations } from "@/lib/quote-store";
import { quoteTotals } from "@/lib/quote-math";
import { QuoteStatusBadge } from "@/components/quotations/quote-actions";

// Quotations still run on demo data whose lead codes can match real leads. Until that
// module reads the database, the panel shows a note instead of mixing in demo quotes.
const QUOTATIONS_CONNECTED = false;

export function LeadDetails({
  lead,
  today,
  canEdit,
  onEdit,
  onMove,
  onConvert,
}: {
  lead: Lead;
  today: string | null;
  /** false for support agents: they can read leads but not change them. */
  canEdit: boolean;
  onEdit: () => void;
  onMove: (stage: LeadStage) => void;
  onConvert: () => void;
}) {
  const stageIndex = OPEN_STAGES.indexOf(lead.stage);
  const nextStage = stageIndex >= 0 && stageIndex < OPEN_STAGES.length - 1 ? OPEN_STAGES[stageIndex + 1] : null;
  const isLost = lead.stage === "Lost";
  const isWon = lead.stage === "Won";
  const nights =
    lead.departDate && lead.returnDate
      ? Math.round((Date.parse(lead.returnDate) - Date.parse(lead.departDate)) / 86_400_000)
      : null;

  return (
    <div className="space-y-6 p-5 sm:p-7">
      {/* ── Status strip ── */}
      <div className="flex flex-wrap items-center gap-2">
        <StageBadge stage={lead.stage} />
        <PriorityBadge priority={lead.priority} />
        <SourceLabel source={lead.source} className="ml-1" />
        <FollowUpChip lead={lead} today={today} className="ml-auto" />
      </div>

      {/* ── Stage progress ── */}
      <section aria-label="Pipeline progress">
        <ol className="flex items-center gap-1">
          {LEAD_STAGES.filter((s) => s.value !== "Lost").map((s, i) => {
            const reached = isWon || (!isLost && i <= stageIndex);
            const current = s.value === lead.stage;
            return (
              <li key={s.value} className="flex-1">
                <button
                  onClick={() => onMove(s.value)}
                  disabled={current || !canEdit}
                  title={current ? `Current stage: ${s.value}` : canEdit ? `Move to ${s.value}` : s.value}
                  className="group w-full text-left disabled:cursor-default"
                >
                  <span
                    className={cn(
                      "block h-2 rounded-full transition",
                      reached ? (s.value === "Won" ? "bg-gold-500" : "bg-sky-brand-dark") : "bg-navy-100 group-hover:bg-navy-200",
                    )}
                  />
                  <span
                    className={cn(
                      "mt-1.5 block truncate text-[11px] font-medium",
                      current ? "text-navy-900" : "text-navy-400 group-hover:text-navy-700",
                    )}
                  >
                    {s.value}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        {isLost && (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            <span>
              Lost{lead.lostReason ? <> — <span className="font-semibold">{lead.lostReason}</span></> : null}. You can reopen it if
              they get back in touch.
            </span>
          </p>
        )}
      </section>

      {/* ── Primary actions ── */}
      {!canEdit ? (
        lead.customerId ? (
          <Link
            href={`/customers/${lead.customerId}`}
            className="flex items-center justify-center gap-2 rounded-xl bg-gold-500 px-4 py-2.5 text-sm font-semibold text-navy-950 hover:bg-gold-400"
          >
            <Icon name="users" size={16} /> View customer {lead.customerId}
          </Link>
        ) : (
          <p className="rounded-xl bg-navy-50 px-3.5 py-2.5 text-sm text-navy-500">
            You can read this lead. Its assigned agent or an admin can update it.
          </p>
        )
      ) : (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {isLost ? (
          <ActionButton primary icon="arrowRight" onClick={() => onMove("Contacted")}>
            Reopen lead
          </ActionButton>
        ) : lead.customerId ? (
          <Link
            href={`/customers/${lead.customerId}`}
            className="flex items-center justify-center gap-2 rounded-xl bg-gold-500 px-4 py-2.5 text-sm font-semibold text-navy-950 hover:bg-gold-400"
          >
            <Icon name="users" size={16} /> View customer {lead.customerId}
          </Link>
        ) : isWon ? (
          <ActionButton primary gold icon="users" onClick={onConvert}>
            Convert to customer
          </ActionButton>
        ) : (
          nextStage && (
            <ActionButton primary icon="arrowRight" onClick={() => onMove(nextStage)}>
              Move to {nextStage}
            </ActionButton>
          )
        )}
        <ActionButton icon="settings" onClick={onEdit}>
          Edit lead
        </ActionButton>
        {!isWon && !isLost && !lead.customerId && (
          <ActionButton icon="users" onClick={onConvert}>
            Convert to customer
          </ActionButton>
        )}
        {!isLost && !isWon && (
          <ActionButton danger icon="close" onClick={() => onMove("Lost")}>
            Mark as lost
          </ActionButton>
        )}
      </div>
      )}

      {/* ── Quotations for this lead ── */}
      {QUOTATIONS_CONNECTED ? (
        <LeadQuotes lead={lead} today={today} />
      ) : (
        <Section title="Quotations">
          <p className="text-sm text-navy-400">Quotations for this lead will appear here once the Quotations module is connected.</p>
        </Section>
      )}

      {/* ── Contact ── */}
      <Section title="Contact">
        <div className="grid grid-cols-3 gap-2">
          <QuickLink href={`https://wa.me/${compactPhone(lead.phone).replace("+", "")}`} icon="chat" external>
            WhatsApp
          </QuickLink>
          <QuickLink href={`tel:${compactPhone(lead.phone)}`} icon="bell">
            Call
          </QuickLink>
          <QuickLink href={lead.email ? `mailto:${lead.email}` : undefined} icon="document">
            Email
          </QuickLink>
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <Item label="Phone">{lead.phone}</Item>
          <Item label="Email">{lead.email ?? <Muted>Not given</Muted>}</Item>
        </dl>
      </Section>

      {/* ── Trip ── */}
      <Section title="Trip">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
          <Item label="Destination">{lead.destination}</Item>
          <Item label="Trip type">{lead.tripType}</Item>
          <Item label="Dates">
            {lead.departDate ? (
              <>
                {formatDate(lead.departDate)}
                {lead.returnDate && <> – {formatDate(lead.returnDate)}</>}
                {nights !== null && <span className="block text-xs font-normal text-navy-400">{nights} nights</span>}
              </>
            ) : (
              <Muted>Flexible</Muted>
            )}
          </Item>
          <Item label="Travellers">{lead.travellers}</Item>
          <Item label="Estimated budget">{lead.budget ? formatCurrency(lead.budget) : <Muted>Not given</Muted>}</Item>
          <Item label="Per traveller">
            {lead.budget ? formatCurrency(lead.budget / lead.travellers) : <Muted>—</Muted>}
          </Item>
        </dl>
      </Section>

      {/* ── Pipeline info ── */}
      <Section title="Pipeline">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
          <Item label="Assigned agent">{lead.agent}</Item>
          <Item label="Source">{lead.source}</Item>
          <Item label="Created">{formatDate(lead.created)}</Item>
          <Item label="Last contact">{formatDate(lead.lastContact)}</Item>
          <Item label="Next follow-up">{lead.nextFollowUp ? formatDate(lead.nextFollowUp) : <Muted>Not set</Muted>}</Item>
        </dl>
      </Section>

      {lead.notes && (
        <Section title="Notes">
          <p className="whitespace-pre-line rounded-xl border-l-4 border-gold-500 bg-gold-50/60 px-4 py-3 text-sm leading-relaxed text-navy-700">
            {lead.notes}
          </p>
        </Section>
      )}
    </div>
  );
}

function LeadQuotes({ lead, today }: { lead: Lead; today: string | null }) {
  const { quotes } = useQuotations();
  const mine = quotes.filter(
    (q) => (q.recipient.kind === "lead" && q.recipient.id === lead.id) || (lead.customerId && q.recipient.id === lead.customerId),
  );
  return (
    <Section
      title={`Quotations${mine.length ? ` (${mine.length})` : ""}`}
      action={
        lead.stage !== "Lost" && (
          <Link
            href={`/quotations/new?lead=${lead.id}`}
            className="inline-flex items-center gap-1 text-sm font-semibold text-sky-brand-dark hover:text-navy-900"
          >
            <Icon name="plus" size={14} /> Create quotation
          </Link>
        )
      }
    >
      {mine.length ? (
        <ul className="divide-y divide-navy-50 rounded-xl border border-navy-100">
          {mine.map((q) => (
            <li key={q.id}>
              <Link href={`/quotations/${q.id}`} className="flex items-center justify-between gap-3 px-3.5 py-2.5 hover:bg-sky-brand-light/40">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-navy-900">{q.title}</span>
                  <span className="font-mono text-xs text-navy-400">{q.id}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums text-navy-900">
                    {formatMoney(quoteTotals(q.items, q.discount, q.taxRate).total)}
                  </span>
                  <QuoteStatusBadge status={displayStatus(q, today)} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-navy-400">No quotations yet.</p>
      )}
    </Section>
  );
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border-t border-navy-50 pt-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-navy-900">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-navy-400">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium text-navy-900">{children}</dd>
    </div>
  );
}

const Muted = ({ children }: { children: ReactNode }) => <span className="font-normal text-navy-300">{children}</span>;

function ActionButton({
  icon,
  primary,
  gold,
  danger,
  onClick,
  children,
}: {
  icon: IconName;
  primary?: boolean;
  gold?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition",
        primary && gold && "bg-gold-500 text-navy-950 hover:bg-gold-400",
        primary && !gold && "bg-navy-900 text-white hover:bg-navy-800",
        !primary && danger && "border border-rose-200 text-rose-600 hover:bg-rose-50",
        !primary && !danger && "border border-navy-100 text-navy-700 hover:bg-navy-50",
      )}
    >
      <Icon name={icon} size={16} className={primary && !gold ? "text-gold-300" : undefined} />
      {children}
    </button>
  );
}

function QuickLink({ href, icon, external, children }: { href?: string; icon: IconName; external?: boolean; children: ReactNode }) {
  const cls = "flex flex-col items-center gap-1 rounded-xl border border-navy-100 py-2.5 text-xs font-medium transition";
  if (!href)
    return (
      <span className={cn(cls, "cursor-not-allowed text-navy-300")} aria-disabled="true">
        <Icon name={icon} size={18} />
        {children}
      </span>
    );
  return (
    <a
      href={href}
      className={cn(cls, "text-navy-700 hover:border-sky-brand/40 hover:bg-sky-brand-light/40")}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      <Icon name={icon} size={18} className={icon === "chat" ? "text-green-600" : "text-sky-brand-dark"} />
      {children}
    </a>
  );
}
