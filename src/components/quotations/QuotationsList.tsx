"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Quotation, QuoteDisplayStatus } from "@/types/crm";
import { displayStatus, quoteStore, useQuotations } from "@/lib/quote-store";
import { quoteTotals } from "@/lib/quote-math";
import { fold } from "@/lib/customer-search";
import { addDays } from "@/lib/dates";
import { Card } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/icons";
import { cn, formatCurrency, formatDate, formatDayMonth, formatMoney } from "@/lib/format";
import { QuoteStatusBadge } from "./quote-actions";

const TABS: (QuoteDisplayStatus | "All")[] = ["All", "Draft", "Sent", "Expired", "Accepted", "Declined"];

function matches(q: Quotation, query: string) {
  const s = fold(query.trim());
  if (!s) return true;
  const hay = fold([q.id, q.title, q.destination, q.recipient.name, q.recipient.id, q.agent].join(" "));
  return s.split(/\s+/).every((w) => hay.includes(w));
}

function Stat({ label, value, hint, icon, gold }: { label: string; value: string; hint: string; icon: IconName; gold?: boolean }) {
  return (
    <Card className="flex items-center gap-4 p-4 sm:p-5">
      <div className={cn("grid size-11 shrink-0 place-items-center rounded-xl", gold ? "bg-navy-900 text-gold-300" : "bg-navy-50 text-navy-700")}>
        <Icon name={icon} size={20} />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-navy-500">{label}</p>
        <p className="text-xl font-semibold tracking-tight text-navy-900">{value}</p>
        <p className="truncate text-xs text-navy-400">{hint}</p>
      </div>
    </Card>
  );
}

export function QuotationsList() {
  const { quotes, today, addedIds, changedCount } = useQuotations();
  const router = useRouter();
  const [tab, setTab] = useState<QuoteDisplayStatus | "All">("All");
  const [query, setQuery] = useState("");

  const rows = useMemo(
    () =>
      quotes.map((q) => ({
        q,
        status: displayStatus(q, today),
        total: quoteTotals(q.items, q.discount, q.taxRate).total,
      })),
    [quotes, today],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { All: rows.length };
    rows.forEach((r) => (c[r.status] = (c[r.status] ?? 0) + 1));
    return c;
  }, [rows]);
  const visible = rows.filter((r) => (tab === "All" || r.status === tab) && matches(r.q, query));

  // Summary figures
  const open = rows.filter((r) => r.status === "Sent");
  const openValue = open.reduce((s, r) => s + r.total, 0);
  const accepted = rows.filter((r) => r.status === "Accepted");
  const decided = accepted.length + (counts.Declined ?? 0);
  const expiringSoon = today ? open.filter((r) => r.q.validUntil <= addDays(today, 3)).length : 0;

  function reset() {
    if (window.confirm(`Undo ${changedCount} change(s) to quotations and restore the demo data?`)) quoteStore.clear();
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Awaiting reply" value={formatCurrency(openValue, { compact: true })} hint={`${open.length} sent quotations`} icon="clock" gold />
        <Stat
          label="Accepted value"
          value={formatCurrency(accepted.reduce((s, r) => s + r.total, 0), { compact: true })}
          hint={`${accepted.length} accepted`}
          icon="check"
        />
        <Stat
          label="Acceptance rate"
          value={decided ? `${Math.round((accepted.length / decided) * 100)}%` : "—"}
          hint={`${accepted.length} of ${decided} decided`}
          icon="chart"
        />
        <Stat
          label="Needs attention"
          value={today ? String((counts.Draft ?? 0) + expiringSoon + (counts.Expired ?? 0)) : "—"}
          hint={today ? attentionHint(counts.Draft ?? 0, expiringSoon, counts.Expired ?? 0) : "Checking dates…"}
          icon="alert"
        />
      </div>

      <Card className="overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-col gap-3 border-b border-navy-50 p-4 sm:p-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1" role="tablist" aria-label="Filter by status">
            {TABS.map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={tab === s}
                onClick={() => setTab(s)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition",
                  tab === s ? "bg-navy-900 text-white" : "text-navy-500 hover:bg-navy-50 hover:text-navy-900",
                )}
              >
                {s}
                <span className={cn("rounded-full px-1.5 text-xs", tab === s ? "bg-white/20" : "bg-navy-50 text-navy-500")}>{counts[s] ?? 0}</span>
              </button>
            ))}
          </div>
          <label className="relative block min-w-0 xl:w-80">
            <span className="sr-only">Search quotations</span>
            <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ID, customer, destination…"
              className="h-10 w-full rounded-xl border border-navy-100 bg-canvas pl-10 pr-3 text-sm text-navy-900 placeholder:text-navy-300 focus:border-sky-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-sky-brand/15"
            />
          </label>
        </div>

        {visible.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <Icon name="document" size={28} className="text-navy-300" />
            <p className="mt-3 font-semibold text-navy-900">No quotations here</p>
            <p className="mt-1 text-sm text-navy-400">Try another tab or search — or create a new quotation.</p>
            <Link href="/quotations/new" className="mt-5 rounded-xl bg-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-800">
              New quotation
            </Link>
          </div>
        ) : (
          <>
            {/* Phones: cards */}
            <ul className="divide-y divide-navy-50 md:hidden">
              {visible.map(({ q, status, total }) => (
                <li key={q.id} className="relative px-4 py-4 active:bg-sky-brand-light/40">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-navy-400">{q.id}</p>
                      <Link href={`/quotations/${q.id}`} className="block truncate font-semibold text-navy-900 after:absolute after:inset-0">
                        {q.title}
                      </Link>
                      <p className="truncate text-sm text-navy-500">{q.recipient.name}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="font-semibold tabular-nums text-navy-900">{formatMoney(total)}</span>
                      <QuoteStatusBadge status={status} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {/* Tablet & desktop: table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <caption className="sr-only">Quotations</caption>
                <thead>
                  <tr className="border-b border-navy-50 bg-canvas/60 text-left text-xs font-semibold uppercase tracking-wider text-navy-400">
                    <th scope="col" className="py-3 pl-6 pr-3">Quotation</th>
                    <th scope="col" className="px-3 py-3">For</th>
                    <th scope="col" className="hidden px-3 py-3 lg:table-cell">Travel</th>
                    <th scope="col" className="px-3 py-3 text-right">Total</th>
                    <th scope="col" className="px-3 py-3">Status</th>
                    <th scope="col" className="hidden py-3 pl-3 pr-6 xl:table-cell">Valid until</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-50">
                  {visible.map(({ q, status, total }) => (
                    <tr
                      key={q.id}
                      onClick={(e) => {
                        if (!(e.target as HTMLElement).closest("a")) router.push(`/quotations/${q.id}`);
                      }}
                      className="group cursor-pointer transition-colors hover:bg-sky-brand-light/40"
                    >
                      <td className="py-3.5 pl-6 pr-3">
                        <Link href={`/quotations/${q.id}`} className="font-medium text-navy-900 group-hover:text-sky-brand-dark">
                          {q.title}
                        </Link>
                        <p className="flex items-center gap-1.5 text-xs text-navy-400">
                          <span className="font-mono">{q.id}</span> · {q.items.length} items · {q.agent}
                          {addedIds.has(q.id) && (
                            <span className="rounded bg-gold-500 px-1 text-[10px] font-bold uppercase text-navy-950">New</span>
                          )}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3.5">
                        <p className="font-medium text-navy-700">{q.recipient.name}</p>
                        <p className="text-xs text-navy-400">{q.recipient.kind === "lead" ? "Lead" : "Customer"} · {q.recipient.id}</p>
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-3.5 lg:table-cell">
                        <p className="text-navy-700">{q.destination}</p>
                        <p className="text-xs text-navy-400">{q.departDate ? formatDayMonth(q.departDate) : "Flexible"} · {q.adults + q.children} pax</p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3.5 text-right font-semibold tabular-nums text-navy-900">{formatMoney(total)}</td>
                      <td className="px-3 py-3.5">
                        <QuoteStatusBadge status={status} />
                      </td>
                      <td className="hidden whitespace-nowrap py-3.5 pl-3 pr-6 text-navy-600 xl:table-cell">
                        {q.status === "Accepted" || q.status === "Declined" ? <span className="text-navy-300">—</span> : formatDate(q.validUntil)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {changedCount > 0 && (
          <div className="border-t border-navy-50 px-6 py-3 text-right text-sm">
            <button onClick={reset} className="text-navy-400 hover:text-rose-600">
              Reset demo data
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}

/** "2 drafts · 1 expired" — only the parts that aren't zero. */
function attentionHint(drafts: number, expiring: number, expired: number) {
  const parts = [
    drafts && `${drafts} draft${drafts === 1 ? "" : "s"}`,
    expired && `${expired} expired`,
    expiring && `${expiring} expiring soon`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "All caught up";
}
