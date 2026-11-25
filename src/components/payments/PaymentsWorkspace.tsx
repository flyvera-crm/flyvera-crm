"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Booking, PaymentMethod } from "@/types/crm";
import { useBookingData, useBookings } from "@/lib/booking-store";
import { bookingMoney, PAYMENT_METHODS, refundState } from "@/lib/booking-rules";
import {
  customerDues,
  ledgerEntries,
  monthlyNet,
  reminderText,
  supplierPayables,
} from "@/lib/payment-ledger";
import { compactPhone } from "@/lib/customer-validation";
import { fold } from "@/lib/customer-search";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Icon, type IconName } from "@/components/icons";
import { cn, formatCurrency, formatDate, formatDayMonth, formatMoney } from "@/lib/format";
import { PaidBar } from "@/components/bookings/booking-ui";
import { RecordPaymentModal } from "@/components/bookings/PaymentModals";
import { RefundRequestModal } from "@/components/bookings/RefundModals";
import { RefundRequestsList } from "@/components/bookings/RefundRequestsList";
import type { BookingAccess } from "@/lib/data/bookings";
import { useBookingActions } from "@/components/bookings/use-booking-actions";
import { useAgencySettings } from "@/lib/settings-store";
import { filterBySupplier, payableSuppliers, paymentsCsv } from "@/lib/exports";
import { downloadText } from "@/lib/download";

type Tab = "received" | "due" | "refunds" | "suppliers";

export function PaymentsWorkspace() {
  const { bookings, today, hydrated } = useBookings();
  const { access } = useBookingData();
  const canRecord = access.canRecordMoney; // admin & finance record money; others see the ledger
  const actions = useBookingActions();
  const [tab, setTab] = useState<Tab>("received");
  const [paying, setPaying] = useState<Booking | null>(null);
  const [refunding, setRefunding] = useState<Booking | null>(null);

  const entries = useMemo(() => ledgerEntries(bookings), [bookings]);
  const dues = useMemo(() => customerDues(bookings, today), [bookings, today]);
  const supplierDays = useAgencySettings().defaults.supplierDaysBeforeDeparture;
  const payables = useMemo(() => supplierPayables(bookings, supplierDays), [bookings, supplierDays]);
  const toSettle = bookings.filter((b) => refundState(b) === "To settle");
  // Refund requests waiting for a decision or for the money to be sent (migration 18).
  const pending = bookings.filter((b) => b.refundRequests?.some((r) => r.status === "Requested" || r.status === "Approved"));
  const pendingCount = pending.reduce((n, b) => n + b.refundRequests!.filter((r) => r.status === "Requested" || r.status === "Approved").length, 0);
  const refundsWaiting = pendingCount + toSettle.length;

  const month = today?.slice(0, 7);
  const receivedThisMonth = month ? entries.filter((e) => e.payment.date.startsWith(month)).reduce((s, e) => s + e.signedAmount, 0) : 0;
  const dueTotal = dues.reduce((s, d) => s + d.balance, 0);
  const overdue = dues.filter((d) => d.overdue);
  const owedSuppliers = payables.reduce((s, p) => s + p.service.cost, 0);

  const tabs: { id: Tab; label: string; count?: number; alert?: boolean }[] = [
    { id: "received", label: "Received", count: entries.length },
    { id: "due", label: "Due from customers", count: dues.length, alert: overdue.length > 0 },
    { id: "refunds", label: "Refunds", count: refundsWaiting, alert: refundsWaiting > 0 },
    // Supplier payments are visible to admin, finance and ticketing only.
    ...(access.canSeeSuppliers ? [{ id: "suppliers" as const, label: "Supplier payments", count: payables.length }] : []),
  ];

  return (
    <div className="space-y-6">
      {/* ── Overview ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Received this month"
          value={today ? formatCurrency(receivedThisMonth, { compact: true }) : "—"}
          hint="Payments minus refunds"
          icon="wallet"
          tone="gold"
        />
        <Stat label="Due from customers" value={formatCurrency(dueTotal, { compact: true })} hint={`${dues.length} booking${dues.length === 1 ? "" : "s"} with a balance`} icon="card" />
        <Stat
          label="Overdue"
          value={today ? formatCurrency(overdue.reduce((s, d) => s + d.balance, 0), { compact: true }) : "—"}
          hint={overdue.length ? `${overdue.length} booking${overdue.length === 1 ? "" : "s"} to chase` : "Nothing overdue"}
          icon="alert"
          tone={overdue.length ? "rose" : undefined}
        />
        <Stat
          label="Owed to suppliers"
          value={access.canSeeSuppliers ? formatCurrency(owedSuppliers, { compact: true }) : "—"}
          hint={access.canSeeSuppliers ? `${payables.length} service${payables.length === 1 ? "" : "s"} unpaid` : "Seen by Finance and Ticketing"}
          icon="plane"
        />
      </div>

      {hydrated && today && <MonthlyChart data={monthlyNet(entries, today)} />}

      {/* ── Tabs ── */}
      <Card className="overflow-hidden">
        <div className="-mx-1 flex gap-1 overflow-x-auto border-b border-navy-50 px-5 py-4 sm:px-6" role="tablist" aria-label="Payment views">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition",
                tab === t.id ? "bg-navy-900 text-white" : t.alert ? "text-rose-600 hover:bg-rose-50" : "text-navy-500 hover:bg-navy-50 hover:text-navy-900",
              )}
            >
              {t.label}
              <span className={cn("rounded-full px-1.5 text-xs", tab === t.id ? "bg-white/20" : "bg-navy-50 text-navy-500")}>{t.count}</span>
            </button>
          ))}
        </div>

        {tab === "received" && <ReceivedTab entries={entries} canExport={canRecord} today={today} />}
        {tab === "due" && (
          <DueTab
            dues={dues}
            today={today}
            onRecord={canRecord ? (b) => setPaying(b) : undefined}
          />
        )}
        {tab === "refunds" && (
          <RefundsTab
            pending={pending}
            access={access}
            today={today}
            toSettle={toSettle}
            refunds={entries.filter((e) => e.payment.kind === "refund")}
            onRefund={canRecord ? (b) => setRefunding(b) : undefined}
            onKeep={canRecord ? (b) => void actions.keepAsFee(b) : undefined}
          />
        )}
        {tab === "suppliers" && access.canSeeSuppliers && (
          <SuppliersTab
            payables={payables}
            today={today}
            onPaid={canRecord ? (b, serviceId) => void actions.markSupplierPaid(b, serviceId, true) : undefined}
          />
        )}
        {!canRecord && (
          <p className="border-t border-navy-50 px-5 py-3 text-xs text-navy-400 sm:px-6">
            Payments, refunds and supplier payments are recorded by Finance or an admin.
          </p>
        )}
      </Card>

      {paying && today && (
        <RecordPaymentModal
          booking={paying}
          today={today}
          onClose={() => setPaying(null)}
          onSave={(v) => {
            void actions.recordPayment(paying, v);
            setPaying(null);
          }}
        />
      )}
      {refunding && today && (
        <RefundRequestModal
          booking={refunding}
          today={today}
          mode="record"
          onClose={() => setRefunding(null)}
          onSave={(v) => {
            void actions.recordPaidRefund(refunding, v);
            setRefunding(null);
          }}
        />
      )}
    </div>
  );
}

/* ─────────────── Overview pieces ─────────────── */

function Stat({ label, value, hint, icon, tone }: { label: string; value: string; hint: string; icon: IconName; tone?: "gold" | "rose" }) {
  return (
    <Card className="flex items-center gap-4 p-4 sm:p-5">
      <div
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-xl",
          tone === "gold" ? "bg-navy-900 text-gold-300" : tone === "rose" ? "bg-rose-50 text-rose-600" : "bg-navy-50 text-navy-700",
        )}
      >
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

/** Single-series column chart: net money received per month (value on each column cap). */
function MonthlyChart({ data }: { data: { key: string; label: string; value: number }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="font-semibold text-navy-900">Money received</h2>
          <p className="text-sm text-navy-400">Last 6 months, net of refunds</p>
        </div>
        <p className="text-sm text-navy-500">
          Total <span className="font-semibold text-navy-900">{formatMoney(total)}</span>
        </p>
      </div>
      <div className="mt-6 flex h-44 items-end gap-3 border-b border-navy-100 sm:gap-6" aria-hidden="true">
        {data.map((d) => (
          <div key={d.key} className="flex h-full flex-1 flex-col items-center justify-end" title={`${d.label}: ${formatMoney(d.value)}`}>
            <span className="mb-1 text-xs font-medium tabular-nums text-navy-600">
              {d.value ? formatCurrency(d.value, { compact: true }) : ""}
            </span>
            <span
              className="w-full max-w-6 rounded-t bg-sky-brand-dark transition-[height] duration-500"
              style={{ height: `${(Math.max(d.value, 0) / max) * 100}%`, minHeight: d.value > 0 ? 2 : 0 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-3 sm:gap-6" aria-hidden="true">
        {data.map((d) => (
          <span key={d.key} className="flex-1 text-center text-xs text-navy-400">
            {d.label}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Money received per month</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}>
              <th scope="row">{d.label}</th>
              <td>{formatMoney(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/* ─────────────── Tabs ─────────────── */

function Empty({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600">
        <Icon name={icon} size={24} />
      </div>
      <p className="mt-4 font-semibold text-navy-900">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-navy-400">{text}</p>
    </div>
  );
}

/** `canExport`: admins and Finance (bulk financial data). */
function ReceivedTab({ entries, canExport, today }: { entries: ReturnType<typeof ledgerEntries>; canExport: boolean; today: string | null }) {
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState<PaymentMethod | "All">("All");
  const [kind, setKind] = useState<"all" | "payment" | "refund">("all");
  const q = fold(query.trim());
  const rows = entries.filter(
    (e) =>
      (method === "All" || e.payment.method === method) &&
      (kind === "all" || (kind === "refund" ? e.payment.kind === "refund" : e.payment.kind !== "refund")) &&
      (!q || q.split(/\s+/).every((w) => fold([e.receiptNo, e.booking.id, e.booking.customerName, e.booking.title, e.payment.note ?? ""].join(" ")).includes(w))),
  );
  const net = rows.reduce((s, e) => s + e.signedAmount, 0);

  return (
    <>
      <div className="flex flex-col gap-3 border-b border-navy-50 p-4 sm:flex-row sm:items-center sm:px-6">
        <label className="relative block min-w-0 flex-1">
          <span className="sr-only">Search payments</span>
          <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy-300" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search receipt, booking, customer…"
            className="h-10 w-full rounded-xl border border-navy-100 bg-canvas pl-10 pr-3 text-sm text-navy-900 placeholder:text-navy-300 focus:border-sky-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-sky-brand/15"
          />
        </label>
        <div className="flex gap-2">
          <SmallSelect label="Type" value={kind} onChange={(v) => setKind(v as typeof kind)} options={[["all", "Payments & refunds"], ["payment", "Payments only"], ["refund", "Refunds only"]]} />
          <SmallSelect label="Method" value={method} onChange={(v) => setMethod(v as PaymentMethod | "All")} options={[["All", "All methods"], ...PAYMENT_METHODS.map((m) => [m, m] as [string, string])]} />
          {canExport && (
            <button
              type="button"
              disabled={!rows.length}
              onClick={() => downloadText(`flyvera-payments-${today ?? "export"}.csv`, paymentsCsv(rows))}
              title="The payments and refunds shown, as a spreadsheet"
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-navy-100 bg-white px-3 text-sm font-medium text-navy-700 hover:bg-navy-50 disabled:opacity-50"
            >
              <Icon name="document" size={15} /> CSV
            </button>
          )}
        </div>
      </div>
      {rows.length === 0 ? (
        <Empty icon="search" title="No payments match" text="Try a different search or filter." />
      ) : (
        <>
          <ul className="divide-y divide-navy-50 md:hidden">
            {rows.map((e) => (
              <li key={e.receiptNo} className="relative flex items-center justify-between gap-3 px-4 py-3.5">
                <div className="min-w-0">
                  <Link href={`/payments/${e.booking.id}/${e.payment.id}`} className="block truncate font-medium text-navy-900 after:absolute after:inset-0">
                    {e.booking.customerName}
                  </Link>
                  <p className="truncate text-xs text-navy-400">
                    {formatDate(e.payment.date)} · {e.payment.method} · {e.receiptNo}
                  </p>
                </div>
                <Amount value={e.signedAmount} />
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Payments received</caption>
              <thead>
                <tr className="border-b border-navy-50 bg-canvas/60 text-left text-xs font-semibold uppercase tracking-wider text-navy-400">
                  <th scope="col" className="py-3 pl-6 pr-3">Date</th>
                  <th scope="col" className="px-3 py-3">Receipt</th>
                  <th scope="col" className="px-3 py-3">Customer</th>
                  <th scope="col" className="hidden px-3 py-3 lg:table-cell">Booking</th>
                  <th scope="col" className="px-3 py-3">Method</th>
                  <th scope="col" className="py-3 pl-3 pr-6 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-50">
                {rows.map((e) => (
                  <tr key={e.receiptNo} className="hover:bg-sky-brand-light/30">
                    <td className="whitespace-nowrap py-3 pl-6 pr-3 text-navy-600">{formatDate(e.payment.date)}</td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <Link href={`/payments/${e.booking.id}/${e.payment.id}`} className="font-mono text-xs text-sky-brand-dark hover:underline">
                        {e.receiptNo}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <p className="whitespace-nowrap font-medium text-navy-900">{e.booking.customerName}</p>
                      {e.payment.note && <p className="text-xs text-navy-400">{e.payment.note}</p>}
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-3 lg:table-cell">
                      <Link href={`/bookings/${e.booking.id}`} className="text-navy-700 hover:text-sky-brand-dark">
                        {e.booking.title}
                      </Link>
                      <p className="font-mono text-xs text-navy-400">{e.booking.id}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-navy-600">{e.payment.method}</td>
                    <td className="whitespace-nowrap py-3 pl-3 pr-6 text-right">
                      <Amount value={e.signedAmount} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-navy-50 px-6 py-3 text-right text-sm text-navy-500">
            {rows.length} {rows.length === 1 ? "entry" : "entries"} · net <span className="font-semibold text-navy-900">{formatMoney(net)}</span>
          </p>
        </>
      )}
    </>
  );
}

function DueTab({
  dues,
  today,
  onRecord,
}: {
  dues: ReturnType<typeof customerDues>;
  today: string | null;
  /** Absent for roles that don't record payments. */
  onRecord?: (b: Booking) => void;
}) {
  if (!dues.length) return <Empty icon="check" title="Nothing to collect" text="Every active booking is paid in full." />;
  return (
    <ul className="divide-y divide-navy-50">
      {dues.map(({ booking: b, balance, dueDate, overdue }) => {
        const text = reminderText(b, balance, dueDate, overdue, formatMoney, formatDate);
        return (
          <li key={b.id} className="grid grid-cols-1 gap-3 px-5 py-4 sm:px-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] lg:items-center">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-medium text-navy-900">
                {b.customerName}
                {overdue && <Badge tone="danger">Overdue</Badge>}
              </p>
              <p className="truncate text-sm text-navy-500">
                <Link href={`/bookings/${b.id}`} className="hover:text-sky-brand-dark">
                  {b.title}
                </Link>{" "}
                · <span className="font-mono text-xs">{b.id}</span> · departs {formatDayMonth(b.departDate)}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <PaidBar booking={b} />
              </div>
              <div className="text-right">
                <p className="font-semibold tabular-nums text-navy-900">{formatMoney(balance)}</p>
                <p className={cn("text-xs", overdue ? "font-medium text-rose-600" : "text-navy-400")}>
                  {overdue ? "was due" : "due"} {today ? formatDate(dueDate) : formatDayMonth(dueDate)}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <a
                href={`https://wa.me/${compactPhone(b.customerPhone).replace("+", "")}?text=${encodeURIComponent(text)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-navy-100 px-3 py-2 text-sm font-medium text-navy-700 hover:border-green-300 hover:bg-green-50 lg:flex-none"
              >
                <Icon name="chat" size={15} className="text-green-600" /> Remind
              </a>
              {onRecord && (
                <button
                  onClick={() => onRecord(b)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-navy-900 px-3 py-2 text-sm font-semibold text-white hover:bg-navy-800 lg:flex-none"
                >
                  <Icon name="plus" size={15} className="text-gold-300" /> Record payment
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function RefundsTab({
  pending,
  access,
  today,
  toSettle,
  refunds,
  onRefund,
  onKeep,
}: {
  pending: Booking[];
  access: BookingAccess;
  today: string | null;
  toSettle: Booking[];
  refunds: ReturnType<typeof ledgerEntries>;
  /** Absent for roles that don't settle refunds. */
  onRefund?: (b: Booking) => void;
  onKeep?: (b: Booking) => void;
}) {
  return (
    <>
      {pending.length > 0 && (
        <div className="border-b border-navy-50">
          <p className="px-6 pt-4 text-xs font-semibold uppercase tracking-wider text-navy-400">
            {access.canRecordMoney ? "Refund requests waiting for you" : "Refund requests waiting for Finance"}
          </p>
          {pending.map((b) => (
            <RefundRequestsList
              key={b.id}
              booking={b}
              access={access}
              today={today}
              showBooking
              requests={b.refundRequests!.filter((r) => r.status === "Requested" || r.status === "Approved")}
            />
          ))}
        </div>
      )}
      {toSettle.length === 0 ? (
        pending.length === 0 && (
          <Empty icon="check" title="No refunds to settle" text="Every cancelled booking has been refunded or its payment kept as a fee." />
        )
      ) : (
        <ul className="divide-y divide-navy-50">
          {toSettle.map((b) => (
            <li key={b.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="min-w-0">
                <p className="font-medium text-navy-900">
                  {b.customerName} · <span className="text-navy-500">{formatMoney(bookingMoney(b).paid)} paid</span>
                </p>
                <p className="text-sm text-navy-500">
                  <Link href={`/bookings/${b.id}`} className="hover:text-sky-brand-dark">
                    {b.title}
                  </Link>{" "}
                  · <span className="font-mono text-xs">{b.id}</span> · cancelled: {b.cancelReason ?? "—"}
                </p>
              </div>
              {onKeep && onRefund && (
                <div className="flex gap-2" title="Record refund sent: the money has already gone back — saved without a separate approval">
                  <button onClick={() => onKeep(b)} className="rounded-xl border border-navy-100 px-3 py-2 text-sm font-medium text-navy-700 hover:bg-navy-50">
                    Keep as fee
                  </button>
                  <button onClick={() => onRefund(b)} className="rounded-xl bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700">
                    Record refund sent
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {refunds.length > 0 && (
        <div className="border-t border-navy-50">
          <p className="px-6 pt-4 text-xs font-semibold uppercase tracking-wider text-navy-400">Refunds already sent</p>
          <ul className="divide-y divide-navy-50">
            {refunds.map((e) => (
              <li key={e.receiptNo} className="flex items-center justify-between gap-3 px-6 py-3 text-sm">
                <span className="min-w-0 truncate">
                  {e.booking.customerName} · <span className="text-navy-400">{formatDate(e.payment.date)} · {e.payment.method}</span>
                </span>
                <Link href={`/payments/${e.booking.id}/${e.payment.id}`} className="shrink-0">
                  <Amount value={e.signedAmount} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function SuppliersTab({
  payables,
  today,
  onPaid,
}: {
  payables: ReturnType<typeof supplierPayables>;
  today: string | null;
  /** Absent for roles that don't record supplier payments. */
  onPaid?: (b: Booking, serviceId: string) => void;
}) {
  const supplierDays = useAgencySettings().defaults.supplierDaysBeforeDeparture;
  const [supplier, setSupplier] = useState("");
  if (!payables.length) return <Empty icon="check" title="All suppliers paid" text="There are no unpaid services on confirmed bookings." />;
  const options = payableSuppliers(payables);
  const shown = filterBySupplier(payables, supplier);
  const total = shown.reduce((s, p) => s + p.service.cost, 0);
  return (
    <>
      <div className="flex flex-col gap-2 border-b border-navy-50 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-navy-500">Pay suppliers at least {supplierDays} days before departure. Costs come from each booking&apos;s services.</p>
        <SmallSelect
          label="Supplier"
          value={supplier}
          onChange={setSupplier}
          options={[["", "All suppliers"], ...options.map((o) => [o.id, o.name] as [string, string]), ["none", "No supplier linked"]]}
        />
      </div>
      {shown.length === 0 && <Empty icon="check" title="Nothing to pay here" text="No unpaid services for this supplier." />}
      <ul className="divide-y divide-navy-50">
        {shown.map(({ booking: b, service: s, dueDate }) => {
          const late = !!today && dueDate < today;
          return (
            <li key={`${b.id}-${s.id}`} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-sky-brand-dark">
                  {s.type}
                  {s.supplierName ? <span className="ml-1.5 normal-case tracking-normal text-navy-500">· {s.supplierName}</span> : null}
                </p>
                <p className="text-sm font-medium text-navy-900">{s.description}</p>
                <p className="text-xs text-navy-400">
                  <Link href={`/bookings/${b.id}`} className="font-mono hover:text-sky-brand-dark">
                    {b.id}
                  </Link>{" "}
                  · {b.customerName} · {s.ref ? <>ref {s.ref}</> : <span className="text-amber-700">no supplier ref yet</span>}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="font-semibold tabular-nums text-navy-900">{formatMoney(s.cost)}</p>
                  <p className={cn("text-xs", late ? "font-medium text-rose-600" : "text-navy-400")}>
                    {late ? "pay now — was due" : "pay by"} {formatDayMonth(dueDate)}
                  </p>
                </div>
                {onPaid && (
                  <button
                    onClick={() => onPaid(b, s.id)}
                    className="flex items-center gap-1.5 rounded-xl bg-navy-900 px-3 py-2 text-sm font-semibold text-white hover:bg-navy-800"
                  >
                    <Icon name="check" size={15} className="text-gold-300" strokeWidth={2.5} /> Mark paid
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-navy-50 px-6 py-3 text-right text-sm text-navy-500">
        Total to pay suppliers <span className="font-semibold text-navy-900">{formatMoney(total)}</span>
      </p>
    </>
  );
}

/* ─────────────── Bits ─────────────── */

function Amount({ value }: { value: number }): ReactNode {
  return (
    <span className={cn("font-semibold tabular-nums", value < 0 ? "text-rose-600" : "text-emerald-700")}>
      {value < 0 ? "− " : "+ "}
      {formatMoney(Math.abs(value))}
    </span>
  );
}

function SmallSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
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
