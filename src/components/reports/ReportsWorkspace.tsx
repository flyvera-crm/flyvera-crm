"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { AGENTS } from "@/config/customer-options";
import { useBookings } from "@/lib/booking-store";
import { useQuotations } from "@/lib/quote-store";
import { useLeadList } from "@/lib/lead-store";
import {
  bookingsCsv,
  cashCollected,
  leadSources,
  leadSummary,
  lostReasons,
  monthlySales,
  PERIODS,
  periodRange,
  quoteFunnel,
  salesSummary,
  teamPerformance,
  toCsv,
  topCustomers,
  topDestinations,
  type PeriodKey,
} from "@/lib/report-metrics";
import { downloadText } from "@/lib/download";
import { Card, CardHeader } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/icons";
import { cn, formatCurrency, formatDate, formatMoney } from "@/lib/format";

const VALUE_COLOR = "bg-sky-brand-dark";
const PROFIT_COLOR = "bg-gold-500";

export function ReportsWorkspace() {
  const { bookings, today, hydrated } = useBookings();
  const { quotes } = useQuotations();
  const leads = useLeadList();
  const [periodKey, setPeriodKey] = useState<PeriodKey>("12m");
  const [agent, setAgent] = useState("All");

  const report = useMemo(() => {
    if (!today) return null;
    const p = periodRange(periodKey, today);
    const mine = <T extends { agent: string }>(xs: T[]) => (agent === "All" ? xs : xs.filter((x) => x.agent === agent));
    const b = mine(bookings);
    const q = mine(quotes);
    const l = mine(leads);
    return {
      p,
      sales: salesSummary(b, p),
      cash: cashCollected(b, p),
      months: monthlySales(b, p),
      destinations: topDestinations(b, p),
      customers: topCustomers(b, p),
      funnel: quoteFunnel(q, bookings, p),
      leadStats: leadSummary(l, p),
      sources: leadSources(l, p),
      lost: lostReasons(l, p),
      team: teamPerformance(AGENTS, { bookings, quotes, leads }, p),
      csv: () => bookingsCsv(b, p),
    };
  }, [bookings, quotes, leads, periodKey, agent, today]);

  if (!hydrated || !report) return <ReportSkeleton />;
  const { p, sales, cash, months, destinations, customers, funnel, leadStats, sources, lost, team } = report;
  const periodLabel = PERIODS.find((x) => x.key === periodKey)!.label;
  const scope = agent === "All" ? "Whole agency" : agent;
  const stamp = `${p.from === "0000-01-01" ? "all-time" : p.from}_to_${p.to}`;

  function exportTeam() {
    downloadText(
      `flyvera-team-${stamp}.csv`,
      toCsv([
        ["Agent", "Leads", "Lead win rate %", "Quotes sent", "Quotes accepted", "Bookings", "Booked value", "Profit", "Margin %", "Cash collected"],
        ...team.map((t) => [t.agent, t.leads, t.leadWinRate, t.quotesSent, t.quotesAccepted, t.bookings, t.value, t.profit, t.margin, t.cash]),
      ]),
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Controls ── */}
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <div className="flex flex-wrap gap-2">
          <Select label="Period" value={periodKey} onChange={(v) => setPeriodKey(v as PeriodKey)} options={PERIODS.map((x) => [x.key, x.label])} />
          <Select label="Agent" value={agent} onChange={setAgent} options={[["All", "All agents"], ...AGENTS.map((a) => [a, a] as [string, string])]} />
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton icon="document" onClick={() => downloadText(`flyvera-bookings-${stamp}.csv`, report.csv())}>
            Bookings CSV
          </ActionButton>
          <ActionButton icon="team" onClick={exportTeam}>
            Team CSV
          </ActionButton>
          <ActionButton icon="chart" onClick={() => window.print()}>
            Print
          </ActionButton>
        </div>
      </Card>
      <p className="text-sm text-navy-500">
        <span className="font-semibold text-navy-900">{scope}</span> · {periodLabel}
        {p.from !== "0000-01-01" && (
          <>
            {" "}
            ({formatDate(p.from)} – {formatDate(p.to)})
          </>
        )}
        . Sales are counted on the date a booking was made; cash on the date it was received.
      </p>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-6">
        <Kpi label="Sales" value={formatCurrency(sales.value, { compact: true })} hint={`${sales.count} booking${sales.count === 1 ? "" : "s"}`} icon="wallet" gold />
        <Kpi label="Profit" value={formatCurrency(sales.profit, { compact: true })} hint={sales.margin === null ? "—" : `${sales.margin}% margin`} icon="chart" />
        <Kpi label="Cash collected" value={formatCurrency(cash, { compact: true })} hint="Payments minus refunds" icon="card" />
        <Kpi label="Avg. booking" value={sales.count ? formatCurrency(sales.average, { compact: true }) : "—"} hint={`${sales.cancelledCount} cancelled`} icon="calendar" />
        <Kpi
          label="Quote acceptance"
          value={funnel.acceptanceRate === null ? "—" : `${Math.round(funnel.acceptanceRate)}%`}
          hint={`${funnel.accepted} of ${funnel.accepted + funnel.declined} decided`}
          icon="document"
        />
        <Kpi
          label="Lead win rate"
          value={leadStats.winRate === null ? "—" : `${Math.round(leadStats.winRate)}%`}
          hint={`${leadStats.won} won · ${leadStats.lost} lost · ${leadStats.open} open`}
          icon="target"
        />
      </div>

      {/* ── Sales chart + destinations ── */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Sales & profit by month" subtitle="Value of bookings made each month (excluding cancellations)" />
          <div className="p-5 sm:p-6">
            <SalesChart data={months} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Top destinations" subtitle="By booked value" />
          <div className="p-5 sm:p-6">
            {destinations.length ? (
              <BarRows
                rows={destinations.map((d) => ({
                  key: d.place,
                  label: d.place,
                  value: d.value,
                  display: formatCurrency(d.value, { compact: true }),
                  sub: `${d.count} booking${d.count === 1 ? "" : "s"} · ${formatCurrency(d.profit, { compact: true })} profit`,
                }))}
              />
            ) : (
              <NoData />
            )}
          </div>
        </Card>
      </div>

      {/* ── Team ── */}
      <Card className="overflow-hidden">
        <CardHeader title="Team performance" subtitle={`${periodLabel} · each agent's leads, quotes and bookings`} />
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-navy-50 bg-canvas/60 text-left text-xs font-semibold uppercase tracking-wider text-navy-400">
                <th scope="col" className="py-3 pl-6 pr-3">Agent</th>
                <th scope="col" className="px-3 py-3 text-right">Leads</th>
                <th scope="col" className="px-3 py-3 text-right">Win rate</th>
                <th scope="col" className="px-3 py-3 text-right">Quotes sent / won</th>
                <th scope="col" className="px-3 py-3 text-right">Bookings</th>
                <th scope="col" className="px-3 py-3 text-right">Sales</th>
                <th scope="col" className="px-3 py-3 text-right">Profit</th>
                <th scope="col" className="py-3 pl-3 pr-6 text-right">Cash in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-50">
              {team.map((t) => (
                <tr key={t.agent} className={cn(agent === t.agent && "bg-gold-50/60")}>
                  <th scope="row" className="whitespace-nowrap py-3 pl-6 pr-3 text-left font-medium text-navy-900">
                    <span className="flex items-center gap-2">
                      <span className="grid size-7 place-items-center rounded-full bg-navy-100 text-[11px] font-semibold text-navy-700">
                        {t.agent
                          .split(" ")
                          .map((x) => x[0])
                          .join("")}
                      </span>
                      {t.agent}
                    </span>
                  </th>
                  <Num>{t.leads}</Num>
                  <Num>{t.leadWinRate === null ? "—" : `${Math.round(t.leadWinRate)}%`}</Num>
                  <Num>
                    {t.quotesSent} / {t.quotesAccepted}
                  </Num>
                  <Num>{t.bookings}</Num>
                  <Num strong>{formatMoney(t.value)}</Num>
                  <Num>
                    {formatMoney(t.profit)}
                    {t.margin !== null && <span className="ml-1 text-xs text-navy-400">({t.margin}%)</span>}
                  </Num>
                  <Num last>{formatMoney(t.cash)}</Num>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-navy-100 font-semibold text-navy-900">
                <th scope="row" className="py-3 pl-6 pr-3 text-left">Agency total</th>
                <Num>{team.reduce((s, t) => s + t.leads, 0)}</Num>
                <Num>—</Num>
                <Num>
                  {team.reduce((s, t) => s + t.quotesSent, 0)} / {team.reduce((s, t) => s + t.quotesAccepted, 0)}
                </Num>
                <Num>{team.reduce((s, t) => s + t.bookings, 0)}</Num>
                <Num strong>{formatMoney(team.reduce((s, t) => s + t.value, 0))}</Num>
                <Num>{formatMoney(team.reduce((s, t) => s + t.profit, 0))}</Num>
                <Num last>{formatMoney(team.reduce((s, t) => s + t.cash, 0))}</Num>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* ── Pipeline insights ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Quote → booking funnel" subtitle="Quotations sent in the period" />
          <div className="p-5 sm:p-6">
            <Funnel
              steps={[
                { label: "Sent", value: funnel.sent },
                { label: "Accepted", value: funnel.accepted },
                { label: "Booked", value: funnel.booked },
              ]}
            />
            <p className="mt-4 text-xs text-navy-400">
              {funnel.declined} declined · the rest are still awaiting a reply.{" "}
              <Link href="/quotations" className="text-sky-brand-dark hover:underline print:hidden">
                Open quotations
              </Link>
            </p>
          </div>
        </Card>
        <Card>
          <CardHeader title="Lead sources" subtitle="Leads created in the period" />
          <div className="p-5 sm:p-6">
            {sources.length ? (
              <BarRows
                rows={sources.map((s) => ({
                  key: s.source,
                  label: s.source,
                  value: s.leads,
                  display: `${s.leads}`,
                  sub: s.winRate === null ? `${s.won} won · none decided yet` : `${s.won} won · ${Math.round(s.winRate)}% win rate`,
                }))}
              />
            ) : (
              <NoData />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Why leads were lost" subtitle="Reasons recorded when marking leads lost" />
          <div className="p-5 sm:p-6">
            {lost.length ? (
              <BarRows rows={lost.map((r) => ({ key: r.reason, label: r.reason, value: r.count, display: String(r.count) }))} muted />
            ) : (
              <NoData text="No lost leads in this period 🎉" />
            )}
          </div>
        </Card>
      </div>

      {/* ── Top customers ── */}
      <Card className="overflow-hidden">
        <CardHeader title="Top customers" subtitle="By value of bookings made in the period" />
        {customers.length ? (
          <ol className="mt-4 divide-y divide-navy-50 border-t border-navy-50">
            {customers.map((c, i) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3 sm:px-6">
                <span className="flex min-w-0 items-center gap-3">
                  <span
                    className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold",
                      i === 0 ? "bg-gold-500 text-navy-950" : "bg-navy-50 text-navy-500",
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <Link href={`/customers/${c.id}`} className="block truncate font-medium text-navy-900 hover:text-sky-brand-dark">
                      {c.name}
                    </Link>
                    <span className="text-xs text-navy-400">
                      {c.bookings} booking{c.bookings === 1 ? "" : "s"} · {formatMoney(c.paid)} paid
                    </span>
                  </span>
                </span>
                <span className="font-semibold tabular-nums text-navy-900">{formatMoney(c.value)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="p-6">
            <NoData />
          </div>
        )}
      </Card>
    </div>
  );
}

/* ─────────────── Charts ─────────────── */

/** Grouped columns: booked value + profit per month. Legend (2 series) + value labels on the value columns. */
function SalesChart({ data }: { data: { key: string; label: string; value: number; profit: number; count: number }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  if (!data.some((d) => d.value)) return <NoData />;
  return (
    <div>
      <div className="mb-4 flex items-center gap-4 text-xs text-navy-500" aria-hidden="true">
        <span className="flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-sm", VALUE_COLOR)} /> Sales
        </span>
        <span className="flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-sm", PROFIT_COLOR)} /> Profit
        </span>
      </div>
      <div className="flex h-56 items-end gap-2 border-b border-navy-100 sm:gap-4" aria-hidden="true">
        {data.map((d) => (
          <div
            key={d.key}
            className="flex h-full flex-1 flex-col justify-end"
            title={`${d.label}: ${formatMoney(d.value)} sales · ${formatMoney(d.profit)} profit · ${d.count} bookings`}
          >
            <span className="mb-1 text-center text-[11px] font-medium tabular-nums text-navy-600">
              {d.value ? formatCurrency(d.value, { compact: true }) : ""}
            </span>
            <div className="flex h-full items-end justify-center gap-[2px]">
              <span className={cn("w-full max-w-6 rounded-t", VALUE_COLOR)} style={{ height: `${(d.value / max) * 100}%` }} />
              <span className={cn("w-full max-w-6 rounded-t", PROFIT_COLOR)} style={{ height: `${(Math.max(d.profit, 0) / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2 sm:gap-4" aria-hidden="true">
        {data.map((d) => (
          <span key={d.key} className="flex-1 text-center text-xs text-navy-400">
            {d.label}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Sales and profit by month</caption>
        <thead>
          <tr>
            <th>Month</th>
            <th>Sales</th>
            <th>Profit</th>
            <th>Bookings</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}>
              <th scope="row">{d.label}</th>
              <td>{formatMoney(d.value)}</td>
              <td>{formatMoney(d.profit)}</td>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Horizontal single-series bars: label + value above a thin bar, optional sub-line. */
function BarRows({ rows, muted }: { rows: { key: string; label: string; value: number; display: string; sub?: string }[]; muted?: boolean }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-3.5">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate font-medium text-navy-700">{r.label}</span>
            <span className="shrink-0 font-semibold tabular-nums text-navy-900">{r.display}</span>
          </div>
          <div className="h-2 rounded-r bg-navy-50">
            <div className={cn("h-full rounded-r", muted ? "bg-navy-400" : VALUE_COLOR)} style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          {r.sub && <p className="mt-1 text-xs text-navy-400">{r.sub}</p>}
        </li>
      ))}
    </ul>
  );
}

function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const first = Math.max(steps[0].value, 1);
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        return (
          <li key={s.label}>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="font-medium text-navy-700">{s.label}</span>
              <span className="tabular-nums">
                <span className="font-semibold text-navy-900">{s.value}</span>
                {prev !== null && prev > 0 && <span className="ml-1.5 text-xs text-navy-400">{Math.round((s.value / prev) * 100)}% of previous</span>}
              </span>
            </div>
            <div className="h-6 rounded-r bg-navy-50">
              <div
                className={cn("h-full rounded-r", i === steps.length - 1 ? "bg-gold-500" : VALUE_COLOR)}
                style={{ width: `${(s.value / first) * 100}%`, opacity: 1 - i * 0.15 }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ─────────────── Bits ─────────────── */

function Kpi({ label, value, hint, icon, gold }: { label: string; value: string; hint: string; icon: IconName; gold?: boolean }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-navy-500">{label}</p>
        <span className={cn("grid size-8 place-items-center rounded-lg", gold ? "bg-navy-900 text-gold-300" : "bg-navy-50 text-navy-600")}>
          <Icon name={icon} size={16} />
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-navy-900">{value}</p>
      <p className="truncate text-xs text-navy-400">{hint}</p>
    </Card>
  );
}

function Num({ children, strong, last }: { children: ReactNode; strong?: boolean; last?: boolean }) {
  return <td className={cn("whitespace-nowrap py-3 text-right tabular-nums", last ? "pl-3 pr-6" : "px-3", strong ? "font-semibold text-navy-900" : "text-navy-700")}>{children}</td>;
}

function NoData({ text = "No data for this period." }: { text?: string }) {
  return <p className="py-6 text-center text-sm text-navy-400">{text}</p>;
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 appearance-none rounded-xl border border-navy-100 bg-white pl-3 pr-8 text-sm font-medium text-navy-700 focus:border-sky-brand focus:outline-none focus:ring-4 focus:ring-sky-brand/15"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-navy-400" />
    </label>
  );
}

function ActionButton({ icon, onClick, children }: { icon: IconName; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 rounded-xl border border-navy-100 bg-white px-3.5 py-2 text-sm font-medium text-navy-700 hover:bg-navy-50">
      <Icon name={icon} size={15} /> {children}
    </button>
  );
}

function ReportSkeleton() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Loading reports">
      <div className="h-16 rounded-2xl bg-navy-50" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-28 rounded-2xl bg-navy-50" />
        ))}
      </div>
      <div className="h-80 rounded-2xl bg-navy-50" />
    </div>
  );
}
