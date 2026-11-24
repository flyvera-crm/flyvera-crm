"use client";

// Refund dialogs (migration 18): request, record a refund already sent, approve, reject, mark paid.
// Shared by the booking page and the Payments → Refunds tab.
import { useState, type FormEvent, type ReactNode } from "react";
import type { Booking, PaymentMethod, RefundCategory, RefundRequest } from "@/types/crm";
import type { Ticket } from "@/types/ticketing";
import { PAYMENT_METHODS, refundableAmount } from "@/lib/booking-rules";
import {
  REFUND_CATEGORIES,
  validateApprove,
  validatePay,
  validateReason,
  validateRefundRequest,
  type ApproveValues,
  type PayValues,
  type RefundRequestValues,
} from "@/lib/refund-rules";
import { Modal } from "@/components/ui/Modal";
import { Field, fieldA11y, inputClass } from "@/components/ui/form";
import { Icon } from "@/components/icons";
import { formatDate, formatMoney } from "@/lib/format";

export type RecordRefundValues = RefundRequestValues & { paidOn: string; reference: string };

/* ── Small building blocks ── */

function Footer({ onClose, form, label, danger }: { onClose: () => void; form: string; label: string; danger?: boolean }) {
  return (
    <>
      <button onClick={onClose} className="rounded-xl border border-navy-100 px-4 py-2.5 text-sm font-medium text-navy-700 hover:bg-navy-50">
        Cancel
      </button>
      <button
        type="submit"
        form={form}
        className={
          danger
            ? "rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700"
            : "rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-800"
        }
      >
        {label}
      </button>
    </>
  );
}

function MoneyInput({ id, value, onChange, error }: { id: string; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-navy-400">$</span>
      <input
        {...fieldA11y(id, { error })}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        className={inputClass(!!error, "h-11 pl-7")}
      />
    </div>
  );
}

function Select<T extends string>({ id, value, options, onChange, error, placeholder }: {
  id: string;
  value: T | "";
  options: readonly (T | [T, string])[];
  onChange: (v: T) => void;
  error?: string;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <select
        {...fieldA11y(id, { error })}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={inputClass(!!error, "h-11 appearance-none pr-9")}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => {
          const [val, label] = Array.isArray(o) ? o : [o, o];
          return (
            <option key={val} value={val}>
              {label}
            </option>
          );
        })}
      </select>
      <Icon name="chevronDown" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-navy-400" />
    </div>
  );
}

function RequestSummary({ r }: { r: RefundRequest }) {
  return (
    <div className="mb-4 rounded-xl bg-navy-50/60 px-4 py-3 text-sm text-navy-700">
      <p>
        <span className="font-semibold text-navy-900">{formatMoney(r.requestedAmount)}</span> requested by {r.requestedByName} on{" "}
        {formatDate(r.requestedOn)}
        {r.category && <> · {r.category}</>}
      </p>
      {r.details && <p className="mt-1 text-navy-500">“{r.details}”</p>}
      {r.status === "Approved" && r.amount !== r.requestedAmount && (
        <p className="mt-1 font-medium text-amber-700">Approved for {formatMoney(r.amount)}{r.decisionNote && <> — {r.decisionNote}</>}</p>
      )}
    </div>
  );
}

/* ── Request (or record a refund already sent) ── */

/**
 * mode "request": ask Finance to refund the customer.
 * mode "record": Finance / admin record a refund already sent, in one step — marked
 * "recorded directly — no separate approval" in the history.
 */
export function RefundRequestModal({
  booking,
  tickets,
  today,
  mode,
  onClose,
  onSave,
}: {
  booking: Booking;
  /** The booking's tickets, when this user can see them (to link the refund to one). */
  tickets?: Ticket[];
  today: string;
  mode: "request" | "record";
  onClose: () => void;
  onSave: (v: RecordRefundValues) => void;
}) {
  const available = refundableAmount(booking);
  const [v, setV] = useState<RecordRefundValues>({
    amount: String(available),
    method: "Bank transfer",
    category: "Cancellation",
    details: "",
    ticketId: "",
    paidOn: today,
    reference: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const errors = {
    ...validateRefundRequest(v, available),
    ...(mode === "record" ? validatePay(v, today, booking.created) : {}),
  };
  const err = (f: keyof RecordRefundValues) => (submitted ? errors[f as keyof typeof errors] : undefined);
  const set = (patch: Partial<RecordRefundValues>) => setV({ ...v, ...patch });
  const refundable = (tickets ?? []).filter((t) => t.status !== "Exchanged");

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.values(errors).some(Boolean)) return;
    onSave(v);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === "request" ? "Request refund" : "Record refund already sent"}
      description={
        <>
          {booking.id} · {booking.customerName}. Up to <span className="font-semibold text-navy-900">{formatMoney(available)}</span> can be
          refunded.{" "}
          {mode === "request"
            ? "Finance reviews the request, then sends the money."
            : "Use this only when the money has already gone back to the customer. It's saved as recorded directly, without a separate approval."}
        </>
      }
      footer={<Footer onClose={onClose} form="refund-request-form" label={mode === "request" ? "Send request" : "Save refund"} />}
    >
      <form id="refund-request-form" onSubmit={submit} noValidate className="grid grid-cols-2 gap-4">
        <Field id="rrAmount" label="Amount (USD)" required error={err("amount")} className="col-span-2 sm:col-span-1">
          <MoneyInput id="rrAmount" value={v.amount} onChange={(amount) => set({ amount })} error={err("amount")} />
        </Field>
        <Field id="rrMethod" label={mode === "request" ? "Refund by" : "Refunded by"} required className="col-span-2 sm:col-span-1">
          <Select<PaymentMethod> id="rrMethod" value={v.method} options={PAYMENT_METHODS} onChange={(method) => set({ method })} />
        </Field>
        <Field id="rrCategory" label="Reason" required error={err("category")} className="col-span-2 sm:col-span-1">
          <Select<RefundCategory>
            id="rrCategory"
            value={v.category}
            options={REFUND_CATEGORIES}
            onChange={(category) => set({ category })}
            error={err("category")}
            placeholder="Choose…"
          />
        </Field>
        {mode === "request" && refundable.length > 0 && (
          <Field id="rrTicket" label="Related ticket" className="col-span-2 sm:col-span-1">
            <Select<string>
              id="rrTicket"
              value={v.ticketId}
              options={refundable.map((t) => [t.id, `${t.ticketNumber} · ${t.passengerName} (${t.status})`] as [string, string])}
              onChange={(ticketId) => set({ ticketId })}
              placeholder="None"
            />
          </Field>
        )}
        {mode === "record" && (
          <>
            <Field id="rrPaidOn" label="Date sent" required error={err("paidOn")} className="col-span-2 sm:col-span-1">
              <input
                {...fieldA11y("rrPaidOn", { error: err("paidOn") })}
                type="date"
                max={today}
                value={v.paidOn}
                onChange={(e) => set({ paidOn: e.target.value })}
                className={inputClass(!!err("paidOn"))}
              />
            </Field>
            <Field id="rrRef" label="Bank / card reference" error={err("reference")} className="col-span-2 sm:col-span-1">
              <input id="rrRef" value={v.reference} onChange={(e) => set({ reference: e.target.value })} className={inputClass(!!err("reference"))} />
            </Field>
          </>
        )}
        <Field id="rrDetails" label="Details" required error={err("details")} className="col-span-2">
          <textarea
            {...fieldA11y("rrDetails", { error: err("details") })}
            rows={3}
            maxLength={200}
            value={v.details}
            onChange={(e) => set({ details: e.target.value })}
            placeholder="e.g. Airline refunded the fare minus a $50 penalty"
            className={inputClass(!!err("details"), "py-2.5")}
          />
        </Field>
      </form>
    </Modal>
  );
}

/* ── Finance decisions ── */

export function ApproveRefundModal({ request, onClose, onSave }: { request: RefundRequest; onClose: () => void; onSave: (v: ApproveValues) => void }) {
  const [v, setV] = useState<ApproveValues>({ amount: String(request.requestedAmount), note: "" });
  const [submitted, setSubmitted] = useState(false);
  const errors = validateApprove(v, request.requestedAmount);
  const err = (f: keyof ApproveValues) => (submitted ? errors[f] : undefined);
  const less = Number(v.amount.replace(/[,\s$]/g, "")) < request.requestedAmount - 0.005;

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.values(errors).some(Boolean)) return;
    onSave(v);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Approve ${request.reference}`}
      description="Approve the requested amount, or less (for example after an airline penalty). The money is sent in the next step."
      footer={<Footer onClose={onClose} form="approve-refund-form" label="Approve" />}
    >
      <RequestSummary r={request} />
      <form id="approve-refund-form" onSubmit={submit} noValidate className="grid gap-4">
        <Field id="arAmount" label="Amount to approve (USD)" required error={err("amount")}>
          <MoneyInput id="arAmount" value={v.amount} onChange={(amount) => setV({ ...v, amount })} error={err("amount")} />
        </Field>
        <Field id="arNote" label={less ? "Why less than requested" : "Note"} required={less} error={err("note")}>
          <input
            {...fieldA11y("arNote", { error: err("note") })}
            maxLength={200}
            value={v.note}
            onChange={(e) => setV({ ...v, note: e.target.value })}
            className={inputClass(!!err("note"))}
          />
        </Field>
      </form>
    </Modal>
  );
}

export function RejectRefundModal({
  request,
  title,
  onClose,
  onSave,
}: {
  request: RefundRequest;
  title?: string;
  onClose: () => void;
  onSave: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const error = submitted ? validateReason(reason) : undefined;

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (validateReason(reason)) return;
    onSave(reason);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={title ?? `Reject ${request.reference}`}
      description="The requester sees your reason on the booking. The booking goes back to “To settle”."
      footer={<Footer onClose={onClose} form="reject-refund-form" label="Reject" danger />}
    >
      <RequestSummary r={request} />
      <form id="reject-refund-form" onSubmit={submit} noValidate>
        <Field id="rjReason" label="Reason" required error={error}>
          <input
            {...fieldA11y("rjReason", { error })}
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Deposit was non-refundable under the fare rules"
            className={inputClass(!!error)}
          />
        </Field>
      </form>
    </Modal>
  );
}

export function PayRefundModal({
  request,
  booking,
  today,
  onClose,
  onSave,
}: {
  request: RefundRequest;
  booking: Booking;
  today: string;
  onClose: () => void;
  onSave: (v: PayValues) => void;
}) {
  const [v, setV] = useState<PayValues>({ paidOn: today, method: request.method, reference: "" });
  const [submitted, setSubmitted] = useState(false);
  const errors = validatePay(v, today, booking.created);
  const err = (f: keyof PayValues) => (submitted ? errors[f] : undefined);

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.values(errors).some(Boolean)) return;
    onSave(v);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Mark ${request.reference} paid`}
      description={
        <>
          Confirm that <span className="font-semibold text-navy-900">{formatMoney(request.amount)}</span> has been sent to {booking.customerName}.
        </>
      }
      footer={<Footer onClose={onClose} form="pay-refund-form" label="Mark paid" />}
    >
      <RequestSummary r={request} />
      <form id="pay-refund-form" onSubmit={submit} noValidate className="grid grid-cols-2 gap-4">
        <Field id="prDate" label="Date sent" required error={err("paidOn")} className="col-span-2 sm:col-span-1">
          <input
            {...fieldA11y("prDate", { error: err("paidOn") })}
            type="date"
            max={today}
            value={v.paidOn}
            onChange={(e) => setV({ ...v, paidOn: e.target.value })}
            className={inputClass(!!err("paidOn"))}
          />
        </Field>
        <Field id="prMethod" label="Sent by" required className="col-span-2 sm:col-span-1">
          <Select<PaymentMethod> id="prMethod" value={v.method} options={PAYMENT_METHODS} onChange={(method) => setV({ ...v, method })} />
        </Field>
        <Field id="prRef" label="Bank / card reference" error={err("reference")} className="col-span-2">
          <input id="prRef" value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} className={inputClass(!!err("reference"))} />
        </Field>
      </form>
    </Modal>
  );
}

/* ── Status chip ── */

const CHIP: Record<RefundRequest["status"], string> = {
  Requested: "bg-amber-50 text-amber-700",
  Approved: "bg-sky-50 text-sky-700",
  Paid: "bg-emerald-50 text-emerald-700",
  Rejected: "bg-rose-50 text-rose-700",
  Withdrawn: "bg-navy-50 text-navy-500",
};

export function RefundStatusChip({ status, children }: { status: RefundRequest["status"]; children?: ReactNode }) {
  return <span className={`rounded-md px-1.5 py-px text-[11px] font-semibold ${CHIP[status]}`}>{children ?? status}</span>;
}
