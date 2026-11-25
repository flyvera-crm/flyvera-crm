"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import type { Customer, CustomerStatus, CustomerTier } from "@/types/crm";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Icon, type IconName } from "@/components/icons";
import { cn, formatCurrency, formatDate, formatMoney, formatMonthYear, initials } from "@/lib/format";
import { addDays } from "@/lib/customer-history";
import { compactPhone } from "@/lib/customer-validation";
import { revealPassport } from "@/lib/actions/customers";
import type { Invoice } from "@/types/invoices";
import { InvoicesCard } from "@/components/invoices/InvoicesCard";
import { todayIso, useCustomers } from "./CustomersProvider";
import { displayStatus, useQuoteData, useQuotations } from "@/lib/quote-store";
import { quoteTotals } from "@/lib/quote-math";
import { QuoteStatusBadge } from "@/components/quotations/quote-actions";
import { useBookings } from "@/lib/booking-store";
import { bookingMoney } from "@/lib/booking-rules";
import { BookingStatusBadge, bookingTotalLabel, PaymentBadge, TimingChip } from "@/components/bookings/booking-ui";
import { ArchiveButton } from "@/components/archive/ArchiveControls";

const tierTone: Record<CustomerTier, BadgeTone> = { Platinum: "premium", Gold: "gold", Silver: "neutral", Standard: "info" };
const statusTone: Record<CustomerStatus, BadgeTone> = { Active: "success", Travelling: "info", Inactive: "neutral" };

function yearsBetween(fromIso: string, toIso: string) {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  return ty - fy - (tm < fm || (tm === fm && td < fd) ? 1 : 0);
}


export function CustomerProfile({ id, invoices }: { id: string; invoices: Invoice[] | null }) {
  const { getCustomer, hydrated, addedIds, openEditForm, access } = useCustomers();
  const quotesVisible = useQuoteData().access.canView; // support agents don't see quotations
  const customer = getCustomer(id);

  // Customers are loaded on the server, so a missing one is either not there or not visible to this role.
  if (!customer) return <NotFound id={id} />;

  // Date-based labels (age, passport status) use the visitor's own "today", so only after hydration.
  const today = hydrated ? todayIso() : null;
  const onEdit = access.canEdit ? () => openEditForm(customer) : undefined;

  return (
    <div className="space-y-6">
      <Link href="/customers" className="inline-flex items-center gap-1.5 text-sm font-medium text-navy-500 hover:text-navy-900">
        <Icon name="arrowRight" size={16} className="rotate-180" /> All customers
      </Link>

      <ProfileHeader customer={customer} isNew={addedIds.has(customer.id)} onEdit={onEdit} />
      <ProfileStats customer={customer} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <ContactCard customer={customer} today={today} />
          {access.canSeePassports && <PassportCard customer={customer} today={today} onEdit={onEdit} />}
          <PreferencesCard customer={customer} />
        </div>
        <div className="space-y-6 lg:col-span-2">
          <NotesCard customer={customer} onEdit={onEdit} />
          {invoices && invoices.length > 0 && <InvoicesCard invoices={invoices} canManage={false} />}
          {quotesVisible && <QuotesCard customer={customer} today={today} />}
          <BookingsCard customer={customer} today={today} />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Header ─────────────────────────── */

function ProfileHeader({ customer: c, isNew, onEdit }: { customer: Customer; isNew: boolean; onEdit?: () => void }) {
  const canQuote = useQuoteData().access.canEdit;
  const phoneDigits = compactPhone(c.phone).replace("+", "");
  return (
    <section className="relative overflow-hidden rounded-3xl bg-navy-900 p-5 text-white sm:p-7">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_120%_at_100%_0%,rgba(14,165,233,0.3),transparent_60%)]" />
      <div className="pointer-events-none absolute -bottom-28 -right-16 size-72 rounded-full border border-gold-500/15" />

      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4 sm:gap-5">
          <span
            className={cn(
              "grid size-16 shrink-0 place-items-center rounded-2xl text-xl font-bold sm:size-20 sm:text-2xl",
              c.tier === "Platinum"
                ? "bg-gradient-to-br from-gold-300 to-gold-600 text-navy-950"
                : "bg-white/10 text-white ring-1 ring-white/20",
            )}
          >
            {initials(c.name)}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{c.name}</h1>
              {isNew && (
                <span className="rounded-md bg-gold-500 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-navy-950">
                  New
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone={c.tier === "Platinum" ? "gold" : tierTone[c.tier]}>
                {c.tier === "Platinum" && <Icon name="crown" size={12} />}
                {c.tier}
              </Badge>
              <Badge tone={statusTone[c.status]}>{c.status}</Badge>
            </div>
            {/* each piece stays on one line; the row wraps between pieces */}
            <p className="mt-2 flex flex-wrap gap-x-1.5 text-sm text-navy-200">
              <span className="font-mono text-white">{c.id}</span>
              <span aria-hidden="true">·</span>
              <span className="whitespace-nowrap">Customer since {formatMonthYear(c.joined)}</span>
              <span aria-hidden="true">·</span>
              <span className="whitespace-nowrap">
                Agent <span className="text-white">{c.agent}</span>
              </span>
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <HeaderAction href={`https://wa.me/${phoneDigits}`} icon="chat" external>
            WhatsApp
          </HeaderAction>
          {c.email && (
            <HeaderAction href={`mailto:${c.email}`} icon="document">
              Email
            </HeaderAction>
          )}
          {canQuote && (
            <HeaderAction href={`/quotations/new?customer=${c.id}`} icon="plus">
              New quotation
            </HeaderAction>
          )}
          {onEdit && (
            <button
              onClick={onEdit}
              className="flex items-center justify-center gap-2 rounded-xl bg-gold-500 px-4 py-2.5 text-sm font-semibold text-navy-950 shadow-sm transition hover:bg-gold-400"
            >
              <Icon name="settings" size={16} /> Edit profile
            </button>
          )}
          {onEdit && c.dbId && <ArchiveButton kind="customer" dbId={c.dbId} name={c.name} />}
        </div>
      </div>
    </section>
  );
}

function HeaderAction({ href, icon, external, children }: { href: string; icon: IconName; external?: boolean; children: ReactNode }) {
  const className =
    "flex items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-medium ring-1 ring-white/15 transition hover:bg-white/20";
  const content = (
    <>
      <Icon name={icon} size={16} className="text-sky-brand" /> {children}
    </>
  );
  if (href.startsWith("/")) return <Link href={href} className={className}>{content}</Link>;
  return (
    <a href={href} className={className} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {content}
    </a>
  );
}

/* ─────────────────────────── Stats ─────────────────────────── */

function ProfileStats({ customer: c }: { customer: Customer }) {
  if (c.statsHidden) {
    return (
      <Card className="flex items-center gap-3 p-4 text-sm text-navy-500 sm:p-5">
        <Icon name="wallet" size={16} className="text-navy-400" />
        Trip counts and spending aren&apos;t shown for your role.
      </Card>
    );
  }
  const stats: { label: string; value: string; hint: string; icon: IconName }[] = [
    { label: "Lifetime value", value: formatCurrency(c.lifetimeValue), hint: "Total spent", icon: "wallet" },
    { label: "Trips booked", value: String(c.trips), hint: c.trips === 1 ? "1 trip so far" : `${c.trips} trips so far`, icon: "plane" },
    {
      label: "Average per trip",
      value: c.trips ? formatCurrency(c.lifetimeValue / c.trips) : "—",
      hint: "Lifetime value ÷ trips",
      icon: "chart",
    },
    {
      label: "Last trip",
      value: c.lastTrip ? formatDate(c.lastTrip) : "—",
      hint: c.lastTrip ? (c.favouriteDestination ? `Loves ${c.favouriteDestination}` : "Most recent departure") : "No trips yet",
      icon: "calendar",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      {stats.map((s) => (
        <Card key={s.label} className="p-4 sm:p-5">
          <div className="flex items-center gap-2 text-sm text-navy-500">
            <Icon name={s.icon} size={16} className="text-navy-400" /> {s.label}
          </div>
          <p className="mt-1.5 text-lg font-semibold tracking-tight text-navy-900 sm:text-xl">{s.value}</p>
          <p className="truncate text-xs text-navy-400">{s.hint}</p>
        </Card>
      ))}
    </div>
  );
}

/* ─────────────────────────── Detail cards ─────────────────────────── */

function DetailRow({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-navy-50 text-navy-500">
        <Icon name={icon} size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <dt className="text-xs text-navy-400">{label}</dt>
        <dd className="mt-0.5 break-words text-sm font-medium text-navy-900">{children}</dd>
      </div>
    </div>
  );
}

const Missing = ({ children = "Not on file" }: { children?: ReactNode }) => (
  <span className="font-normal text-navy-300">{children}</span>
);

function ContactCard({ customer: c, today }: { customer: Customer; today: string | null }) {
  return (
    <Card>
      <CardHeader title="Contact details" />
      <dl className="divide-y divide-navy-50 p-5 sm:px-6">
        <DetailRow icon="document" label="Email">
          {c.email ? (
            <a href={`mailto:${c.email}`} className="text-sky-brand-dark hover:underline">
              {c.email}
            </a>
          ) : (
            <Missing />
          )}
        </DetailRow>
        <DetailRow icon="chat" label="Mobile / WhatsApp">
          <a href={`tel:${compactPhone(c.phone)}`} className="text-sky-brand-dark hover:underline">
            {c.phone}
          </a>
          <span className="mt-1 block">
            {c.whatsappOptIn ? (
              <Badge tone="success">WhatsApp opted in</Badge>
            ) : (
              <Badge tone="neutral">No WhatsApp consent</Badge>
            )}
          </span>
        </DetailRow>
        <DetailRow icon="globe" label="Lives in">
          {c.city}, {c.country}
        </DetailRow>
        <DetailRow icon="users" label="Nationality">
          {c.nationality ?? <Missing />}
        </DetailRow>
        <DetailRow icon="calendar" label="Date of birth">
          {c.dateOfBirth ? (
            <>
              {formatDate(c.dateOfBirth)}
              {today && <span className="font-normal text-navy-400"> · {yearsBetween(c.dateOfBirth, today)} years old</span>}
            </>
          ) : (
            <Missing />
          )}
        </DetailRow>
      </dl>
    </Card>
  );
}

function PassportCard({ customer: c, today, onEdit }: { customer: Customer; today: string | null; onEdit?: () => void }) {
  const passport = c.passport;
  // The full number is only fetched on request (the database logs each reveal).
  const [revealed, setRevealed] = useState<{ documentId: string; number: string } | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [revealing, startReveal] = useTransition();
  const shownNumber = revealed && revealed.documentId === passport?.documentId ? revealed.number : null;

  function toggleReveal() {
    if (!passport) return;
    if (shownNumber) {
      setRevealed(null);
      return;
    }
    setRevealError(null);
    startReveal(async () => {
      const result = await revealPassport(passport.documentId);
      if (result.ok) setRevealed({ documentId: passport.documentId, number: result.number });
      else setRevealError(result.message);
    });
  }

  let status: { tone: BadgeTone; label: string; note: string } | null = null;
  if (passport && today) {
    const sixMonths = addDays(today, 182);
    if (passport.expiry <= today)
      status = { tone: "danger", label: "Expired", note: "Ask for a renewed passport before booking." };
    else if (passport.expiry < sixMonths)
      status = { tone: "warning", label: "Expires soon", note: "Under 6 months left — many countries will refuse entry." };
    else status = { tone: "success", label: "Valid", note: "More than 6 months of validity left." };
  }

  return (
    <Card>
      <CardHeader title="Travel document" action={status && <Badge tone={status.tone}>{status.label}</Badge>} />
      {passport ? (
        <div className="p-5 sm:px-6">
          {/* Passport-style card */}
          <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-navy-800 to-navy-950 p-4 text-white">
            <Icon name="globe" size={84} strokeWidth={0.8} className="absolute -right-4 -top-4 text-white/10" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold-300">Passport</p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="font-mono text-lg tracking-widest">{shownNumber ?? `•••••${passport.last4}`}</p>
              <button
                onClick={toggleReveal}
                disabled={revealing}
                aria-pressed={Boolean(shownNumber)}
                className="relative rounded-lg bg-white/10 px-2.5 py-1 text-xs font-medium hover:bg-white/20 disabled:cursor-wait disabled:opacity-60"
              >
                {revealing ? "Loading…" : shownNumber ? "Hide" : "Show"}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs">
              <div>
                <p className="text-navy-300">Issued by</p>
                <p className="font-medium">{passport.issuingCountry}</p>
              </div>
              <div>
                <p className="text-navy-300">Expires</p>
                <p className="font-medium">{formatDate(passport.expiry)}</p>
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-navy-400">Stored encrypted. Every time the full number is shown, it&apos;s recorded in the audit log.</p>
          {revealError && (
            <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs font-medium text-rose-600">
              <Icon name="alert" size={14} className="mt-px shrink-0" />
              {revealError}
            </p>
          )}
          {status && (
            <p
              className={cn(
                "mt-3 flex items-start gap-1.5 text-xs",
                status.tone === "danger" ? "text-rose-600" : status.tone === "warning" ? "text-amber-700" : "text-navy-400",
              )}
            >
              {status.tone !== "success" && <Icon name="alert" size={14} className="mt-px shrink-0" />}
              {status.note}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center p-6 text-center">
          <p className="text-sm text-navy-400">No passport on file yet — needed before tickets can be issued.</p>
          {onEdit && (
            <button onClick={onEdit} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-sky-brand-dark hover:text-navy-900">
              <Icon name="plus" size={16} /> Add passport details
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

function PreferencesCard({ customer: c }: { customer: Customer }) {
  return (
    <Card>
      <CardHeader title="Travel preferences" />
      <dl className="divide-y divide-navy-50 p-5 sm:px-6">
        <DetailRow icon="chat" label="Preferred contact">
          {c.preferredContact ?? <Missing>Not set</Missing>}
        </DetailRow>
        <DetailRow icon="plane" label="Seat">
          {c.seatPreference ?? <Missing>No preference</Missing>}
        </DetailRow>
        <DetailRow icon="target" label="Favourite destination">
          {c.favouriteDestination || <Missing>Not set</Missing>}
        </DetailRow>
      </dl>
    </Card>
  );
}

function NotesCard({ customer: c, onEdit }: { customer: Customer; onEdit?: () => void }) {
  return (
    <Card>
      <CardHeader
        title="Notes"
        action={
          onEdit && (
            <button onClick={onEdit} className="text-sm font-medium text-sky-brand-dark hover:text-navy-900">
              {c.notes ? "Edit" : "Add note"}
            </button>
          )
        }
      />
      <div className="p-5 sm:px-6">
        {c.notes ? (
          <p className="whitespace-pre-line rounded-xl border-l-4 border-gold-500 bg-gold-50/60 px-4 py-3 text-sm leading-relaxed text-navy-700">
            {c.notes}
          </p>
        ) : (
          <p className="text-sm text-navy-300">No notes yet. Add dietary needs, special occasions or service preferences.</p>
        )}
      </div>
    </Card>
  );
}

function NotFound({ id }: { id: string }) {
  return (
    <Card className="flex flex-col items-center px-6 py-20 text-center">
      <div className="grid size-16 place-items-center rounded-2xl bg-navy-50 text-navy-400">
        <Icon name="users" size={28} />
      </div>
      <h1 className="mt-5 text-xl font-semibold text-navy-900">Customer not found</h1>
      <p className="mt-2 max-w-md text-sm text-navy-400">
        There&apos;s no customer <span className="font-mono text-navy-700">{id}</span> that you can see. It may have been
        archived, or it&apos;s assigned to someone outside your team.
      </p>
      <Link href="/customers" className="mt-6 rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-800">
        Back to customers
      </Link>
    </Card>
  );
}

/* ─────────────────────────── Quotations ─────────────────────────── */

function QuotesCard({ customer: c, today }: { customer: Customer; today: string | null }) {
  const { quotes } = useQuotations();
  const canCreate = useQuoteData().access.canEdit;
  const mine = quotes.filter((q) => q.recipient.kind === "customer" && q.recipient.id === c.id);
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Quotations"
        subtitle={mine.length ? `${mine.length} for ${c.name.split(" ")[0]}` : undefined}
        action={
          canCreate && (
            <Link
              href={`/quotations/new?customer=${c.id}`}
              className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-sky-brand-dark hover:text-navy-900"
            >
              <Icon name="plus" size={14} /> New quotation
            </Link>
          )
        }
      />
      {mine.length ? (
        <ul className="mt-4 divide-y divide-navy-50 border-t border-navy-50">
          {mine.map((q) => (
            <li key={q.id}>
              <Link href={`/quotations/${q.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-sky-brand-light/40 sm:px-6">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-navy-900">{q.title}</span>
                  <span className="text-xs text-navy-400">
                    <span className="font-mono">{q.id}</span> · {formatDate(q.created)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="font-semibold tabular-nums text-navy-900">
                    {formatMoney(quoteTotals(q.items, q.discount, q.taxRate).total)}
                  </span>
                  <QuoteStatusBadge status={displayStatus(q, today)} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-5 text-sm text-navy-400 sm:px-6">No quotations yet.</p>
      )}
    </Card>
  );
}

/* ─────────────────────────── Bookings ─────────────────────────── */

function BookingsCard({ customer: c, today }: { customer: Customer; today: string | null }) {
  const { bookings } = useBookings();
  const mine = bookings.filter((b) => b.customerId === c.id).sort((a, b) => b.departDate.localeCompare(a.departDate));
  const owed = mine.filter((b) => b.status !== "Cancelled").reduce((s, b) => s + bookingMoney(b).balance, 0);
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Bookings"
        subtitle={mine.length ? `${mine.length} booked · ${owed > 0 ? `${formatMoney(owed)} still to pay` : "nothing owed"}` : undefined}
        action={
          <Link href="/bookings" className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-sky-brand-dark hover:text-navy-900">
            All bookings <Icon name="arrowRight" size={14} />
          </Link>
        }
      />
      {mine.length ? (
        <ul className="mt-4 divide-y divide-navy-50 border-t border-navy-50">
          {mine.map((b) => (
            <li key={b.id}>
              <Link href={`/bookings/${b.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-sky-brand-light/40 sm:px-6">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-navy-900">{b.title}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-navy-400">
                    <span className="font-mono">{b.id}</span> · {formatDate(b.departDate)}
                    <TimingChip booking={b} today={today} />
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-semibold tabular-nums text-navy-900">{bookingTotalLabel(b)}</span>
                  <span className="flex gap-1">
                    <BookingStatusBadge status={b.status} />
                    <PaymentBadge booking={b} today={today} />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-5 text-sm text-navy-400 sm:px-6">No bookings yet — bookings are created from accepted quotations.</p>
      )}
    </Card>
  );
}
