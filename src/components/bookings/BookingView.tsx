"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import type { BookingPayment } from "@/types/crm";
import { useBookingData, useBookings } from "@/lib/booking-store";
import { BOOKING_FLOW, bookingMoney, daysBetween, isRefund, nextStep, paymentState, refundState } from "@/lib/booking-rules";
import { receiptNumber } from "@/lib/payment-ledger";
import { QUOTE_ITEM_TYPES, LOW_MARGIN_PERCENT } from "@/config/quote-options";
import { compactPhone } from "@/lib/customer-validation";
import { lineTotal } from "@/lib/quote-math";
import { Card, CardHeader } from "@/components/ui/Card";
import { inputClass } from "@/components/ui/form";
import { Icon, type IconName } from "@/components/icons";
import { cn, formatDate, formatMoney } from "@/lib/format";
import { BookingStatusBadge, PaymentBadge, TimingChip } from "./booking-ui";
import { useBookingActions } from "./use-booking-actions";
import { CancelModal, EditPaymentModal, RecordPaymentModal, RefundModal } from "./PaymentModals";

export function BookingView({ id }: { id: string }) {
  const { bookings, today } = useBookings();
  const { access } = useBookingData();
  const actions = useBookingActions();
  const [busy, startBusy] = useTransition();
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [correcting, setCorrecting] = useState<BookingPayment | null>(null);
  const b = bookings.find((x) => x.id === id);

  // Bookings are loaded on the server, so a missing one isn't there or isn't visible to this role.
  if (!b) return <Missing id={id} />;

  const m = bookingMoney(b);
  const step = nextStep(b, today);
  const closed = b.status === "Cancelled" || b.status === "Completed";
  const state = paymentState(b, today);
  const refund = refundState(b);
  const nights = b.returnDate ? daysBetween(b.departDate, b.returnDate) : null;
  const confirmedCount = b.services.filter((s) => s.ref).length;
  const showMoney = access.canSeeMoney;
  const canPay = access.canRecordMoney && !closed && m.balance > 0;
  /** Runs one change at a time (buttons are disabled until it finishes). */
  const run = (action: () => Promise<unknown>) => startBusy(async () => void (await action()));

  return (
    <div className="space-y-6">
      <Link href="/bookings" className="inline-flex items-center gap-1.5 text-sm font-medium text-navy-500 hover:text-navy-900">
        <Icon name="arrowRight" size={16} className="rotate-180" /> All bookings
      </Link>

      {/* ── Header ── */}
      <section className="relative overflow-hidden rounded-3xl bg-navy-900 p-5 text-white sm:p-7">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_120%_at_100%_0%,rgba(14,165,233,0.3),transparent_60%)]" />
        <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-navy-200">{b.id}</span>
              <BookingStatusBadge status={b.status} />
              <PaymentBadge booking={b} today={today} />
              <TimingChip booking={b} today={today} />
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{b.title}</h1>
            <p className="mt-1 flex flex-wrap gap-x-1.5 text-sm text-navy-200">
              <Link href={`/customers/${b.customerId}`} className="font-medium text-white hover:underline">
                {b.customerName}
              </Link>
              <span aria-hidden="true">·</span>
              <span className="whitespace-nowrap">
                {formatDate(b.departDate)}
                {b.returnDate && <> – {formatDate(b.returnDate)}</>}
              </span>
              <span aria-hidden="true">·</span>
              <span className="whitespace-nowrap">
                {b.adults + b.children} traveller{b.adults + b.children === 1 ? "" : "s"}
              </span>
            </p>
          </div>

          <div className="flex flex-col gap-2 xl:items-end">
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              {step && access.canEdit && (
                <button
                  onClick={() => run(() => actions.advance(b))}
                  disabled={!!step.blocker || busy}
                  className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-gold-500 px-4 py-2.5 text-sm font-semibold text-navy-950 shadow-sm transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-navy-200 sm:col-span-1"
                >
                  <Icon name="check" size={16} strokeWidth={2.5} /> {step.action}
                </button>
              )}
              {canPay && (
                <HeaderButton icon="wallet" onClick={() => setPaying(true)}>
                  Record payment
                </HeaderButton>
              )}
              {b.customerPhone && (
                <a
                  href={`https://wa.me/${compactPhone(b.customerPhone).replace("+", "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={headerBtnCls}
                >
                  <Icon name="chat" size={16} className="text-sky-brand" /> WhatsApp
                </a>
              )}
              {!closed && access.canEdit && (
                <HeaderButton icon="close" onClick={() => setCancelling(true)}>
                  Cancel
                </HeaderButton>
              )}
            </div>
            {step?.blocker && access.canEdit && (
              <p className="flex items-center gap-1.5 text-xs text-gold-300">
                <Icon name="alert" size={13} /> {step.action}: {step.blocker}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ── Progress ── */}
      {b.status === "Cancelled" ? (
        <div className="flex flex-col gap-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            <span>
              Cancelled{b.cancelReason && <> — <span className="font-semibold">{b.cancelReason}</span></>}.
              {showMoney && refund === "To settle" && <> The customer has paid {formatMoney(m.paid)} — refund it or keep it as a fee.</>}
              {showMoney && refund === "Kept as fee" && <> {formatMoney(m.paid)} kept as a cancellation fee.</>}
              {showMoney && refund === "Refunded" && <> {formatMoney(m.refunded)} refunded in full.</>}
            </span>
          </p>
          {refund === "To settle" &&
            (access.canRecordMoney ? (
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => setRefunding(true)}
                  disabled={busy}
                  className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                >
                  Record refund
                </button>
                <button
                  onClick={() => run(() => actions.keepAsFee(b))}
                  disabled={busy}
                  className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                >
                  Keep as fee
                </button>
              </div>
            ) : (
              showMoney && <span className="shrink-0 text-xs font-medium">Finance will settle the refund.</span>
            ))}
        </div>
      ) : (
        <ol className="grid grid-cols-4 gap-2" aria-label="Booking progress">
          {BOOKING_FLOW.map((s, i) => {
            const reached = i <= BOOKING_FLOW.indexOf(b.status);
            return (
              <li key={s}>
                <span className={cn("block h-2 rounded-full", reached ? (s === "Completed" ? "bg-gold-500" : "bg-sky-brand-dark") : "bg-navy-100")} />
                <span className={cn("mt-1.5 block truncate text-xs font-medium", s === b.status ? "text-navy-900" : "text-navy-400")}>
                  {s}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {/* ── Services ── */}
          {showMoney ? (
            <Card className="overflow-hidden">
              <CardHeader
                title="Services"
                subtitle={`${confirmedCount} of ${b.services.length} confirmed with suppliers — add the PNR / confirmation number as each is booked.`}
              />
              <ul className="mt-4 divide-y divide-navy-50 border-t border-navy-50">
                {b.services.map((s) => (
                  <li key={s.id} className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_200px] sm:items-center sm:px-6">
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className={cn(
                          "grid size-9 shrink-0 place-items-center rounded-xl",
                          s.ref ? "bg-emerald-50 text-emerald-600" : "bg-navy-50 text-navy-500",
                        )}
                      >
                        <Icon name={s.ref ? "check" : (QUOTE_ITEM_TYPES.find((t) => t.value === s.type)?.icon ?? "plus")} size={16} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wider text-sky-brand-dark">{s.type}</p>
                        <p className="text-sm text-navy-900">{s.description}</p>
                        <p className="text-xs text-navy-400">
                          {s.quantity} × {formatMoney(s.unitPrice)} = <span className="font-medium text-navy-600">{formatMoney(lineTotal(s))}</span>
                        </p>
                        {access.canSeeSuppliers && s.cost > 0 && b.status !== "Pending" && b.status !== "Cancelled" && (
                          <p className="mt-0.5 text-xs">
                            {s.supplierPaidOn ? (
                              <span className="text-emerald-700">✓ Supplier paid {formatDate(s.supplierPaidOn)}</span>
                            ) : (
                              <span className="text-amber-700">
                                Supplier not paid yet ({formatMoney(s.cost)}) · <Link href="/payments" className="underline">Payments</Link>
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                    <label className="block">
                      <span className="mb-1 block text-xs text-navy-400">Supplier reference</span>
                      <input
                        key={s.ref ?? ""}
                        defaultValue={s.ref ?? ""}
                        disabled={closed || !access.canEditServices}
                        placeholder={closed || !access.canEditServices ? "—" : "e.g. EK7Q2M"}
                        onBlur={(e) => run(() => actions.setServiceRef(b, s.id, e.target.value))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                        aria-label={`Supplier reference for ${s.type}: ${s.description}`}
                        className={inputClass(false, cn("h-10 font-mono uppercase placeholder:font-sans placeholder:normal-case", s.ref && "border-emerald-200 bg-emerald-50/40"))}
                      />
                    </label>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <Card className="flex items-start gap-3 p-5 text-sm text-navy-500 sm:px-6">
              <Icon name="wallet" size={18} className="mt-0.5 shrink-0 text-navy-400" />
              Services, prices and payments aren&apos;t shown for your role. You can still see the trip, its dates and its history.
            </Card>
          )}

          {/* ── Payments ── */}
          {showMoney && (
            <Card className="overflow-hidden">
              <CardHeader
                title="Payments"
                subtitle={`${b.payments.length} payment${b.payments.length === 1 ? "" : "s"} · ${formatMoney(m.paid)} received`}
                action={
                  canPay ? (
                    <button onClick={() => setPaying(true)} className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-sky-brand-dark hover:text-navy-900">
                      <Icon name="plus" size={14} /> Record payment
                    </button>
                  ) : (
                    !access.canRecordMoney && !closed && m.balance > 0 && <span className="text-xs text-navy-400">Payments are recorded by Finance.</span>
                  )
                }
              />
              <div className="px-5 pt-4 sm:px-6">
                <div className="h-2.5 overflow-hidden rounded-full bg-navy-100">
                  <div className={cn("h-full rounded-full", m.balance <= 0 ? "bg-emerald-500" : "bg-sky-brand-dark")} style={{ width: `${m.percentPaid}%` }} />
                </div>
                <div className="mt-2 flex justify-between text-sm">
                  <span className="text-navy-500">
                    Paid <span className="font-semibold text-navy-900">{formatMoney(m.paid)}</span>
                  </span>
                  <span className="text-navy-500">
                    Balance <span className={cn("font-semibold", state === "Overdue" ? "text-rose-600" : "text-navy-900")}>{formatMoney(m.balance)}</span>
                  </span>
                </div>
              </div>
              {b.payments.length ? (
                <ul className="mt-4 divide-y divide-navy-50 border-t border-navy-50">
                  {b.payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3 sm:px-6">
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            "grid size-8 place-items-center rounded-lg",
                            isRefund(p) ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600",
                          )}
                        >
                          <Icon name={isRefund(p) ? "arrowRight" : "wallet"} size={15} className={isRefund(p) ? "rotate-180" : undefined} />
                        </span>
                        <div>
                          <p className="text-sm font-medium text-navy-900">
                            {isRefund(p) ? <span className="text-rose-600">− {formatMoney(p.amount)} refund</span> : formatMoney(p.amount)}{" "}
                            <span className="font-normal text-navy-400">· {p.method}</span>
                            {p.corrected && (
                              <span
                                className="ml-2 rounded-md bg-amber-50 px-1.5 py-px text-[11px] font-semibold text-amber-700"
                                title="Corrected by Finance — the change and reason are in the history below"
                              >
                                Corrected
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-navy-400">
                            {formatDate(p.date)}
                            {p.note && <> · {p.note}</>} ·{" "}
                            <Link href={`/payments/${b.id}/${p.id}`} className="text-sky-brand-dark hover:underline">
                              {isRefund(p) ? "Refund note" : "Receipt"} {receiptNumber(b.id, p.id)}
                            </Link>
                          </p>
                        </div>
                      </div>
                      {access.canRecordMoney && !isRefund(p) && p.dbId && b.status !== "Cancelled" && (
                        <button
                          onClick={() => setCorrecting(p)}
                          className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-navy-500 hover:bg-navy-50 hover:text-navy-900"
                        >
                          Edit
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-5 text-sm text-navy-400 sm:px-6">No payments yet. The deposit is due {formatDate(b.depositDue)}.</p>
              )}
            </Card>
          )}
        </div>

        {/* ── Side column ── */}
        <aside className="space-y-6">
          {showMoney && (
            <Card>
              <CardHeader title="Money" />
              <dl className="space-y-2 p-5 text-sm sm:px-6">
                <Row label="Subtotal" value={formatMoney(m.subtotal)} />
                {m.discount > 0 && <Row label="Discount" value={`− ${formatMoney(m.discount)}`} />}
                {m.tax > 0 && <Row label={`Tax (${b.taxRate}%)`} value={formatMoney(m.tax)} />}
                <Row label="Total" value={formatMoney(m.total)} strong />
                <div className="my-2 border-t border-navy-50" />
                <Row label="Deposit due" value={formatDate(b.depositDue)} alert={state === "Overdue" && m.paid === 0} />
                <Row label="Balance due" value={formatDate(b.balanceDue)} alert={state === "Overdue" && m.paid > 0} />
                {state === "Overdue" && (
                  <p className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-2.5 py-2 text-xs font-medium text-rose-700">
                    <Icon name="alert" size={13} className="mt-px shrink-0" /> Payment is overdue — chase {b.customerName.split(" ")[0]}.
                  </p>
                )}
                <div className="my-2 border-t border-navy-50" />
                <p className="text-xs font-semibold uppercase tracking-wider text-navy-400">Internal</p>
                <Row label="Supplier cost" value={formatMoney(m.cost)} />
                <Row label="Profit" value={`${formatMoney(m.profit)} (${m.margin.toFixed(1)}%)`} strong alert={m.margin < LOW_MARGIN_PERCENT} />
              </dl>
            </Card>
          )}

          <Card>
            <CardHeader title="Trip" />
            <dl className="space-y-2 p-5 text-sm sm:px-6">
              <Row label="Destination" value={b.destination} />
              <Row label="Nights" value={nights !== null ? String(nights) : "—"} />
              <Row label="Adults / children" value={`${b.adults} / ${b.children}`} />
              <Row label="Agent" value={b.agent} />
              {b.quoteId && (
                <div className="flex items-center justify-between">
                  <dt className="text-navy-500">From quotation</dt>
                  <dd>
                    <Link href={`/quotations/${b.quoteId}`} className="font-mono text-sky-brand-dark hover:underline">
                      {b.quoteId}
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
          </Card>

          <Card>
            <CardHeader title="History" />
            <ol className="space-y-3 p-5 sm:px-6">
              {[...b.history].reverse().map((e, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-sky-brand-dark" />
                  <div>
                    <p className="text-navy-700">{e.text}</p>
                    <p className="text-xs text-navy-400">{formatDate(e.date)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>

      {paying && today && (
        <RecordPaymentModal
          booking={b}
          today={today}
          onClose={() => setPaying(false)}
          onSave={(v) => {
            setPaying(false);
            run(() => actions.recordPayment(b, v));
          }}
        />
      )}
      {refunding && today && (
        <RefundModal
          booking={b}
          today={today}
          onClose={() => setRefunding(false)}
          onSave={(v) => {
            setRefunding(false);
            run(() => actions.recordRefund(b, v));
          }}
        />
      )}
      {correcting && correcting.dbId && today && (
        <EditPaymentModal
          booking={b}
          payment={correcting}
          today={today}
          onClose={() => setCorrecting(null)}
          onSave={(v) => actions.correctPayment(b, correcting.dbId!, v)}
        />
      )}
      <CancelModal
        open={cancelling}
        booking={b}
        onClose={() => setCancelling(false)}
        onConfirm={(reason) => {
          setCancelling(false);
          run(() => actions.cancel(b, reason));
        }}
      />
    </div>
  );
}

/* ─────────────── Bits ─────────────── */

const headerBtnCls =
  "flex items-center justify-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-medium text-white ring-1 ring-white/15 transition hover:bg-white/20";

function HeaderButton({ icon, onClick, children }: { icon: IconName; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className={headerBtnCls}>
      <Icon name={icon} size={16} className="text-sky-brand" /> {children}
    </button>
  );
}

function Row({ label, value, strong, alert }: { label: string; value: string; strong?: boolean; alert?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-navy-500">{label}</dt>
      <dd className={cn("text-right tabular-nums", strong ? "font-semibold" : "", alert ? "text-rose-600" : strong ? "text-navy-900" : "text-navy-700")}>
        {value}
      </dd>
    </div>
  );
}

function Missing({ id }: { id: string }) {
  return (
    <Card className="flex flex-col items-center px-6 py-20 text-center">
      <Icon name="calendar" size={28} className="text-navy-300" />
      <h1 className="mt-4 text-xl font-semibold text-navy-900">Booking not found</h1>
      <p className="mt-2 max-w-md text-sm text-navy-400">
        There&apos;s no booking <span className="font-mono text-navy-700">{id}</span> that you can see. It may belong to a customer outside
        your team.
      </p>
      <Link href="/bookings" className="mt-6 rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-800">
        All bookings
      </Link>
    </Card>
  );
}
