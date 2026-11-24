"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Invoice, InvoiceStatus } from "@/types/invoices";
import { balanceDue, INVOICE_STATUSES, invoiceStatus } from "@/lib/invoice-rules";
import { fold } from "@/lib/customer-search";
import { todayIso, useHydrated } from "@/lib/dates";
import { addDays } from "@/lib/customer-history";
import { Card } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/icons";
import { cn, formatCurrency, formatDate, formatMoney } from "@/lib/format";
import { InvoiceStatusBadge } from "./invoice-ui";

type Period = "all" | "30" | "month" | "year";
const PERIODS: { value: Period; label: string }[] = [
  { value: "all", label: "Any date" },
  { value: "30", label: "Last 30 days" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
];

/** Invoices page: totals, status tabs, search and date filter (by issue date; drafts by creation date). */
export function InvoicesWorkspace({ invoices }: { invoices: Invoice[] }) {
  const hydrated = useHydrated();
  const today = hydrated ? todayIso() : null;
  const [tab, setTab] = useState<InvoiceStatus | "All">("All");
  const [period, setPeriod] = useState<Period>("all");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => invoices.map((inv) => ({ inv, status: invoiceStatus(inv, today), balance: balanceDue(inv) })), [invoices, today]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { All: rows.length };
    rows.forEach((r) => (c[r.status] = (c[r.status] ?? 0) + 1));
    return c;
  }, [rows]);

  const inPeriod = (inv: Invoice) => {
    if (period === "all" || !today) return true;
    const d = inv.issueOn ?? inv.created;
    if (period === "30") return d >= addDays(today, -30);
    if (period === "month") return d.startsWith(today.slice(0, 7));
    return d.startsWith(today.slice(0, 4));
  };
  const matches = (inv: Invoice) => {
    const q = fold(query.trim());
    if (!q) return true;
    const hay = fold([inv.number ?? "draft", inv.billTo.name, inv.customerCode, inv.bookingCode, inv.bookingTitle, inv.billTo.email ?? ""].join(" "));
    return q.split(/\s+/).every((w) => hay.includes(w));
  };
  const visible = rows.filter((r) => (tab === "All" || r.status === tab) && inPeriod(r.inv) && matches(r.inv));

  const open = rows.filter((r) => ["Unpaid", "Partially paid", "Overdue"].includes(r.status));
  const overdue = rows.filter((r) => r.status === "Overdue");
  const month = today?.slice(0, 7);
  const issuedThisMonth = month ? rows.filter((r) => r.inv.issueOn?.startsWith(month) && r.status !== "Void") : [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Outstanding" value={formatCurrency(open.reduce((s, r) => s + r.balance, 0), { compact: true })} hint={`${open.length} unpaid or part-paid`} icon="card" />
        <Stat
          label="Overdue"
          value={today ? formatCurrency(overdue.reduce((s, r) => s + r.balance, 0), { compact: true }) : "—"}
          hint={overdue.length ? `${overdue.length} to chase` : "Nothing overdue"}
          icon="alert"
          rose={overdue.length > 0}
        />
        <Stat label="Invoiced this month" value={formatCurrency(issuedThisMonth.reduce((s, r) => s + r.inv.total, 0), { compact: true })} hint={`${issuedThisMonth.length} issued`} icon="document" />
        <Stat label="Drafts" value={String(counts.Draft ?? 0)} hint="Not issued yet" icon="clock" />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-navy-50 p-4 sm:p-5 2xl:flex-row 2xl:items-center 2xl:justify-between">
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1" role="tablist" aria-label="Filter invoices">
            {(["All", ...INVOICE_STATUSES] as const).map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={tab === s}
                onClick={() => setTab(s)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition",
                  tab === s ? "bg-navy-900 text-white" : s === "Overdue" && counts.Overdue ? "text-rose-600 hover:bg-rose-50" : "text-navy-500 hover:bg-navy-50 hover:text-navy-900",
                )}
              >
                {s}
                <span className={cn("rounded-full px-1.5 text-xs", tab === s ? "bg-white/20" : "bg-navy-50 text-navy-500")}>{counts[s] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Date" className="h-10 rounded-xl border border-navy-100 bg-white px-3 text-sm text-navy-700">
              {PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <label className="relative block min-w-0 sm:w-72">
              <span className="sr-only">Search invoices</span>
              <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Number, customer, booking…"
                className="h-10 w-full rounded-xl border border-navy-100 bg-canvas pl-10 pr-3 text-sm text-navy-900 placeholder:text-navy-300 focus:border-sky-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-sky-brand/15"
              />
            </label>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <Icon name="document" size={28} className="text-navy-300" />
            <p className="mt-3 font-semibold text-navy-900">{invoices.length ? "No invoices match" : "No invoices yet"}</p>
            <p className="mt-1 text-sm text-navy-400">{invoices.length ? "Try another tab, date or search." : "Invoices are created from bookings (or accepted quotations)."}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-50 text-left text-xs font-semibold uppercase tracking-wider text-navy-400">
                  <th className="py-3 pl-6 pr-3">Invoice</th>
                  <th className="px-3 py-3">Customer</th>
                  <th className="hidden px-3 py-3 md:table-cell">Booking</th>
                  <th className="hidden px-3 py-3 lg:table-cell">Issued</th>
                  <th className="hidden px-3 py-3 lg:table-cell">Due</th>
                  <th className="px-3 py-3 text-right">Total</th>
                  <th className="hidden px-3 py-3 text-right sm:table-cell">Balance</th>
                  <th className="py-3 pl-3 pr-6">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-50">
                {visible.map(({ inv, status, balance }) => (
                  <tr key={inv.id} className="hover:bg-sky-brand-light/30">
                    <td className="whitespace-nowrap py-3 pl-6 pr-3">
                      <Link href={`/invoices/${inv.id}`} className="font-mono font-medium text-sky-brand-dark hover:underline">
                        {inv.number ?? "Draft"}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-navy-800">{inv.billTo.name}</td>
                    <td className="hidden whitespace-nowrap px-3 py-3 font-mono text-navy-600 md:table-cell">{inv.bookingCode}</td>
                    <td className="hidden whitespace-nowrap px-3 py-3 text-navy-600 lg:table-cell">{inv.issueOn ? formatDate(inv.issueOn) : "—"}</td>
                    <td className={cn("hidden whitespace-nowrap px-3 py-3 lg:table-cell", status === "Overdue" ? "font-medium text-rose-600" : "text-navy-600")}>
                      {inv.dueOn ? formatDate(inv.dueOn) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-navy-900">{formatMoney(inv.total)}</td>
                    <td className="hidden whitespace-nowrap px-3 py-3 text-right tabular-nums text-navy-700 sm:table-cell">
                      {status === "Draft" || status === "Void" ? "—" : formatMoney(balance)}
                    </td>
                    <td className="py-3 pl-3 pr-6">
                      <InvoiceStatusBadge invoice={inv} today={today} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, hint, icon, rose }: { label: string; value: string; hint: string; icon: IconName; rose?: boolean }) {
  return (
    <Card className="flex items-center gap-4 p-4 sm:p-5">
      <div className={cn("grid size-11 shrink-0 place-items-center rounded-xl", rose ? "bg-rose-50 text-rose-600" : "bg-navy-50 text-navy-700")}>
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
