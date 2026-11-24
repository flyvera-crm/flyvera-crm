"use client";

// Dialogs shared by the booking page and the Payments page.
import { useState, type FormEvent } from "react";
import type { Booking, BookingPayment, PaymentMethod } from "@/types/crm";
import {
  bookingMoney,
  CANCEL_REASONS,
  PAYMENT_METHODS,
  validatePayment,
  validatePaymentCorrection,
  type PaymentCorrectionValues,
  type PaymentFormValues,
} from "@/lib/booking-rules";
import { receiptNumber } from "@/lib/payment-ledger";
import { Modal } from "@/components/ui/Modal";
import { Field, fieldA11y, inputClass } from "@/components/ui/form";
import { Icon } from "@/components/icons";
import { cn, formatMoney } from "@/lib/format";

export function RecordPaymentModal({
  booking,
  today,
  onClose,
  onSave,
}: {
  booking: Booking;
  today: string;
  onClose: () => void;
  onSave: (v: PaymentFormValues) => void;
}) {
  const { balance, paid } = bookingMoney(booking);
  const [v, setV] = useState<PaymentFormValues>({
    amount: String(balance),
    date: today,
    method: "Card",
    note: paid === 0 ? "Deposit" : "",
  });
  const [submitted, setSubmitted] = useState(false);
  const errors = validatePayment(v, booking, today);
  const err = (f: keyof PaymentFormValues) => (submitted ? errors[f] : undefined);

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length) return;
    onSave(v);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Record payment"
      description={
        <>
          {booking.id} · balance due <span className="font-semibold text-navy-900">{formatMoney(balance)}</span>
        </>
      }
      footer={
        <>
          <button onClick={onClose} className="rounded-xl border border-navy-100 px-4 py-2.5 text-sm font-medium text-navy-700 hover:bg-navy-50">
            Cancel
          </button>
          <button type="submit" form="payment-form" className="rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-800">
            Save payment
          </button>
        </>
      }
    >
      <form id="payment-form" onSubmit={submit} noValidate className="grid grid-cols-2 gap-4">
        <Field id="amount" label="Amount (USD)" required error={err("amount")} className="col-span-2 sm:col-span-1">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-navy-400">$</span>
            <input
              {...fieldA11y("amount", { error: err("amount") })}
              value={v.amount}
              onChange={(e) => setV({ ...v, amount: e.target.value })}
              inputMode="decimal"
              className={inputClass(!!err("amount"), "h-11 pl-7")}
            />
          </div>
        </Field>
        <Field id="date" label="Date received" required error={err("date")} className="col-span-2 sm:col-span-1">
          <input
            {...fieldA11y("date", { error: err("date") })}
            type="date"
            max={today}
            value={v.date}
            onChange={(e) => setV({ ...v, date: e.target.value })}
            className={inputClass(!!err("date"))}
          />
        </Field>
        <fieldset className="col-span-2">
          <legend className="mb-1.5 text-sm font-medium text-navy-700">Method</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PAYMENT_METHODS.map((pm) => (
              <label
                key={pm}
                className={cn(
                  "flex h-10 cursor-pointer items-center justify-center rounded-xl border text-sm font-medium transition has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-sky-brand/20",
                  v.method === pm ? "border-navy-900 bg-navy-900 text-white" : "border-navy-100 text-navy-600 hover:bg-navy-50",
                )}
              >
                <input type="radio" name="method" value={pm} checked={v.method === pm} onChange={() => setV({ ...v, method: pm as PaymentMethod })} className="sr-only" />
                {pm}
              </label>
            ))}
          </div>
        </fieldset>
        <Field id="note" label="Note" error={err("note")} className="col-span-2">
          <input
            {...fieldA11y("note", { error: err("note") })}
            value={v.note}
            onChange={(e) => setV({ ...v, note: e.target.value })}
            placeholder="e.g. Deposit, balance, receipt number…"
            className={inputClass(!!err("note"))}
          />
        </Field>
      </form>
    </Modal>
  );
}

export function CancelModal({ open, booking, onClose, onConfirm }: { open: boolean; booking: Booking; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState(CANCEL_REASONS[0]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cancel this booking?"
      description={
        <>
          <span className="font-semibold text-navy-900">{booking.title}</span> for {booking.customerName}. Remember to cancel with each supplier too.
        </>
      }
      footer={
        <>
          <button onClick={onClose} className="rounded-xl border border-navy-100 px-4 py-2.5 text-sm font-medium text-navy-700 hover:bg-navy-50">
            Keep booking
          </button>
          <button onClick={() => onConfirm(reason)} className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700">
            Cancel booking
          </button>
        </>
      }
    >
      <label htmlFor="cancelReason" className="mb-1.5 block text-sm font-medium text-navy-700">
        Reason
      </label>
      <div className="relative">
        <select id="cancelReason" value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass(false, "h-11 appearance-none pr-9")}>
          {CANCEL_REASONS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <Icon name="chevronDown" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-navy-400" />
      </div>
    </Modal>
  );
}


/**
 * Finance / admin: correct a payment that was recorded wrongly (typo in the amount, wrong date
 * or method). A reason is required. The database keeps the receipt number and the booking, writes
 * the before/after values and the reason to the audit log, and adds a line to the booking's history.
 * Money actually returned to the customer is a refund, not a correction.
 */
export function EditPaymentModal({
  booking,
  payment,
  today,
  onClose,
  onSave,
}: {
  booking: Booking;
  payment: BookingPayment;
  today: string;
  onClose: () => void;
  onSave: (v: PaymentCorrectionValues) => Promise<boolean>;
}) {
  const [v, setV] = useState<PaymentCorrectionValues>({
    amount: String(payment.amount),
    date: payment.date,
    method: payment.method,
    note: payment.note ?? "",
    reference: payment.reference ?? "",
    reason: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const errors = validatePaymentCorrection(v, payment, booking, today);
  const unchanged =
    Number(v.amount.replace(/[,\s$]/g, "")) === payment.amount &&
    v.date === payment.date &&
    v.method === payment.method &&
    v.note.trim() === (payment.note ?? "") &&
    v.reference.trim() === (payment.reference ?? "");
  const err = (f: keyof PaymentCorrectionValues) => (submitted ? errors[f] : undefined);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length || unchanged || saving) return;
    setSaving(true);
    const ok = await onSave(v);
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Correct payment"
      description={
        <>
          {receiptNumber(booking.id, payment.id)} · recorded as <span className="font-semibold text-navy-900">{formatMoney(payment.amount)}</span> on{" "}
          {payment.date}. The receipt number stays the same; the change and your reason are logged.
        </>
      }
      footer={
        <>
          <button onClick={onClose} className="rounded-xl border border-navy-100 px-4 py-2.5 text-sm font-medium text-navy-700 hover:bg-navy-50">
            Cancel
          </button>
          <button
            type="submit"
            form="correct-payment-form"
            disabled={saving}
            className="rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-800 disabled:cursor-wait disabled:opacity-70"
          >
            {saving ? "Saving…" : "Save correction"}
          </button>
        </>
      }
    >
      <form id="correct-payment-form" onSubmit={submit} noValidate className="grid grid-cols-2 gap-4">
        <p className="col-span-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
          Use this only to fix how a payment was recorded. If money was sent back to the customer, record a refund instead.
        </p>
        <Field id="fixAmount" label="Amount actually received (USD)" required error={err("amount")} className="col-span-2 sm:col-span-1">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-navy-400">$</span>
            <input
              {...fieldA11y("fixAmount", { error: err("amount") })}
              value={v.amount}
              onChange={(e) => setV({ ...v, amount: e.target.value })}
              inputMode="decimal"
              className={inputClass(!!err("amount"), "h-11 pl-7")}
            />
          </div>
        </Field>
        <Field id="fixDate" label="Date received" required error={err("date")} className="col-span-2 sm:col-span-1">
          <input
            {...fieldA11y("fixDate", { error: err("date") })}
            type="date"
            max={today}
            value={v.date}
            onChange={(e) => setV({ ...v, date: e.target.value })}
            className={inputClass(!!err("date"))}
          />
        </Field>
        <Field id="fixMethod" label="Method" required className="col-span-2 sm:col-span-1">
          <div className="relative">
            <select
              id="fixMethod"
              value={v.method}
              onChange={(e) => setV({ ...v, method: e.target.value as PaymentMethod })}
              className={inputClass(false, "h-11 appearance-none pr-9")}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <Icon name="chevronDown" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-navy-400" />
          </div>
        </Field>
        <Field id="fixReference" label="Bank / card reference" error={err("reference")} className="col-span-2 sm:col-span-1">
          <input
            {...fieldA11y("fixReference", { error: err("reference") })}
            value={v.reference}
            onChange={(e) => setV({ ...v, reference: e.target.value })}
            className={inputClass(!!err("reference"))}
          />
        </Field>
        <Field id="fixNote" label="Note" error={err("note")} className="col-span-2">
          <input
            {...fieldA11y("fixNote", { error: err("note") })}
            value={v.note}
            onChange={(e) => setV({ ...v, note: e.target.value })}
            className={inputClass(!!err("note"))}
          />
        </Field>
        <Field id="fixReason" label="Reason for the correction" required error={err("reason")} className="col-span-2">
          <textarea
            {...fieldA11y("fixReason", { error: err("reason") })}
            value={v.reason}
            onChange={(e) => setV({ ...v, reason: e.target.value })}
            rows={2}
            placeholder="e.g. Typed 1,500 instead of 1,050 — bank statement shows 1,050"
            className={inputClass(!!err("reason"), "min-h-16 resize-y py-2.5")}
          />
        </Field>
        {submitted && unchanged && (
          <p role="alert" className="col-span-2 text-sm font-medium text-rose-600">
            Nothing was changed — edit at least one detail, or cancel.
          </p>
        )}
      </form>
    </Modal>
  );
}
