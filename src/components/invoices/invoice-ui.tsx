"use client";

// Shared invoice pieces: status badge, the printable document, and the create / issue / void dialogs.
import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import type { Invoice, InvoiceStatus } from "@/types/invoices";
import { balanceDue, invoiceStatus, validateCreateInvoice, validateIssueInvoice, validateVoidReason, type CreateInvoiceValues, type IssueInvoiceValues } from "@/lib/invoice-rules";
import { receiptNumber } from "@/lib/payment-ledger";
import { siteConfig } from "@/config/site";
import { QUOTE_TERMS } from "@/config/quote-options";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Field, inputClass } from "@/components/ui/form";
import { cn, formatDate, formatMoney } from "@/lib/format";

export const INVOICE_TONE: Record<InvoiceStatus, BadgeTone> = {
  Draft: "neutral",
  Unpaid: "info",
  "Partially paid": "warning",
  Overdue: "danger",
  Paid: "success",
  Void: "neutral",
};

export function InvoiceStatusBadge({ invoice, today }: { invoice: Invoice; today: string | null }) {
  const s = invoiceStatus(invoice, today);
  return <Badge tone={INVOICE_TONE[s]}>{s}</Badge>;
}

/* ─────────────── the document (screen + print) ─────────────── */

export function InvoiceDocument({ invoice: inv, today }: { invoice: Invoice; today: string | null }) {
  const status = invoiceStatus(inv, today);
  return (
    <article className="overflow-hidden rounded-2xl border border-navy-100 bg-white shadow-sm print:rounded-none print:border-0 print:shadow-none">
      <header className="flex flex-col gap-4 bg-navy-900 px-6 py-6 text-white sm:flex-row sm:items-start sm:justify-between sm:px-10">
        <div>
          <p className="text-2xl font-bold tracking-[0.2em]">{siteConfig.name}</p>
          <p className="text-xs font-medium uppercase tracking-wider text-gold-300">{siteConfig.tagline}</p>
        </div>
        <div className="sm:text-right">
          <p className="text-xs font-semibold uppercase tracking-wider text-navy-200">{inv.number ? "Invoice" : "Draft invoice"}</p>
          <p className="font-mono text-lg">{inv.number ?? "Not numbered yet"}</p>
          <p className="text-sm text-navy-200">
            {inv.issueOn ? `Issued ${formatDate(inv.issueOn)}` : "Not issued"}
            {inv.dueOn && <> · due {formatDate(inv.dueOn)}</>}
          </p>
        </div>
      </header>

      <div className="space-y-8 px-6 py-8 sm:px-10">
        {status === "Void" && (
          <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            VOID{inv.voidReason && <> — {inv.voidReason}</>}
            {inv.voidedOn && <span className="font-normal"> ({formatDate(inv.voidedOn)})</span>}
          </p>
        )}
        {status === "Draft" && (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">Draft — not a valid invoice until it&apos;s issued.</p>
        )}

        <div className="grid grid-cols-1 gap-6 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-navy-400">Bill to</p>
            <p className="mt-1 font-semibold text-navy-900">{inv.billTo.name}</p>
            {inv.billTo.email && <p className="text-navy-500">{inv.billTo.email}</p>}
            {inv.billTo.phone && <p className="text-navy-500">{inv.billTo.phone}</p>}
            <p className="text-navy-500">{[inv.billTo.city, inv.billTo.country].filter(Boolean).join(", ")}</p>
            {inv.billTo.code && <p className="font-mono text-xs text-navy-400">{inv.billTo.code}</p>}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-navy-400">Booking</p>
            <p className="mt-1 font-semibold text-navy-900">
              <Link href={`/bookings/${inv.bookingCode}`} className="hover:text-sky-brand-dark print:no-underline">
                {inv.bookingCode}
              </Link>{" "}
              · {inv.bookingTitle}
            </p>
            {inv.passengers.length > 0 && (
              <>
                <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-navy-400">Passengers</p>
                <ul className="mt-1 space-y-0.5 text-navy-600">
                  {inv.passengers.map((p, i) => (
                    <li key={i}>
                      {p.name} <span className="text-navy-400">({p.type})</span>
                      {p.tickets.length > 0 && <span className="font-mono text-xs text-navy-500"> · ticket {p.tickets.join(", ")}</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-100 text-left text-xs font-semibold uppercase tracking-wider text-navy-400">
                <th className="py-2 pr-3">Item</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Unit price</th>
                <th className="py-2 pl-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-50">
              {inv.lines.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap py-2.5 pr-3 font-medium text-navy-700">{l.type}</td>
                  <td className="px-3 py-2.5 text-navy-900">{l.description}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{l.quantity}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{formatMoney(l.unitPrice)}</td>
                  <td className="whitespace-nowrap py-2.5 pl-3 text-right font-semibold tabular-nums text-navy-900">{formatMoney(l.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="ml-auto max-w-xs space-y-1.5 text-sm">
          <Row label="Subtotal" value={formatMoney(inv.subtotal)} />
          {inv.discount > 0 && <Row label="Discount" value={`− ${formatMoney(inv.discount)}`} />}
          {inv.tax > 0 && <Row label={`Tax (${inv.taxRate}%)`} value={formatMoney(inv.tax)} />}
          <div className="flex items-baseline justify-between border-t border-navy-900 pt-2">
            <dt className="font-semibold text-navy-900">Total ({inv.currency})</dt>
            <dd className="text-xl font-bold tabular-nums text-navy-900">{formatMoney(inv.total)}</dd>
          </div>
          {status !== "Draft" && status !== "Void" && (
            <>
              <Row label="Paid" value={formatMoney(inv.paid)} />
              <Row label="Balance due" value={formatMoney(balanceDue(inv))} strong />
            </>
          )}
        </dl>

        <footer className="space-y-2 border-t border-navy-100 pt-6 text-xs text-navy-500">
          {inv.notes && <p className="text-sm text-navy-700">{inv.notes}</p>}
          <ul className="list-disc space-y-0.5 pl-4">
            {QUOTE_TERMS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </footer>
      </div>
    </article>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-navy-500">{label}</dt>
      <dd className={cn("tabular-nums", strong ? "font-semibold text-navy-900" : "text-navy-700")}>{value}</dd>
    </div>
  );
}

/** Payment history of an invoice: receipts and refund notes, linked to their printable pages. */
export function InvoicePayments({ invoice: inv }: { invoice: Invoice }) {
  if (!inv.payments.length) return <p className="text-sm text-navy-400">No payments linked yet.</p>;
  return (
    <ul className="divide-y divide-navy-50">
      {inv.payments.map((p) => (
        <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
          <span>
            <Link href={`/payments/${inv.bookingCode}/${p.id}`} className="font-mono text-sky-brand-dark hover:underline">
              {receiptNumber(inv.bookingCode, p.id)}
            </Link>
            <span className="text-navy-400"> · {formatDate(p.date)} · {p.method}</span>
          </span>
          <span className={cn("font-semibold tabular-nums", p.kind === "refund" ? "text-rose-600" : "text-navy-900")}>
            {p.kind === "refund" ? "− " : ""}
            {formatMoney(p.amount)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ─────────────── dialogs ─────────────── */

function Dialog({
  title,
  description,
  formId,
  saving,
  label,
  onClose,
  danger,
  children,
}: {
  title: string;
  description: ReactNode;
  formId: string;
  saving: boolean;
  label: string;
  onClose: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-xl border border-navy-100 px-4 py-2.5 text-sm font-medium text-navy-700 hover:bg-navy-50">
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            disabled={saving}
            className={cn(
              "rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-70",
              danger ? "bg-rose-600 hover:bg-rose-700" : "bg-navy-900 hover:bg-navy-800",
            )}
          >
            {saving ? "Saving…" : label}
          </button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

function useSubmit<T>(onSave: (v: T) => Promise<boolean>, onClose: () => void) {
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent, v: T, invalid: boolean) {
    e.preventDefault();
    setSubmitted(true);
    if (invalid || saving) return;
    setSaving(true);
    const ok = await onSave(v);
    setSaving(false);
    if (ok) onClose();
  }
  return { submitted, saving, submit };
}

export function CreateInvoiceModal({
  bookingCode,
  today,
  defaultDue,
  onClose,
  onSave,
}: {
  bookingCode: string;
  today: string;
  defaultDue?: string;
  onClose: () => void;
  onSave: (v: CreateInvoiceValues) => Promise<boolean>;
}) {
  const [v, setV] = useState<CreateInvoiceValues>({ serviceFee: "", dueOn: defaultDue && defaultDue >= today ? defaultDue : "", notes: "" });
  const errors = validateCreateInvoice(v, today);
  const { submitted, saving, submit } = useSubmit(onSave, onClose);
  const err = (k: keyof CreateInvoiceValues) => (submitted ? errors[k] : undefined);
  return (
    <Dialog
      title="Create invoice"
      description={<>For {bookingCode}. Lines, discount and tax come from the booking; the number is given when you issue it.</>}
      formId="create-invoice-form"
      saving={saving}
      label="Create draft"
      onClose={onClose}
    >
      <form id="create-invoice-form" onSubmit={(e) => submit(e, v, Object.keys(errors).length > 0)} noValidate className="grid grid-cols-2 gap-4">
        <Field id="invFee" label="Service fee (USD)" error={err("serviceFee")} hint="Added to the booking as a service, so totals match." className="col-span-2 sm:col-span-1">
          <input id="invFee" value={v.serviceFee} inputMode="decimal" placeholder="0" onChange={(e) => setV({ ...v, serviceFee: e.target.value })} className={inputClass(!!err("serviceFee"))} />
        </Field>
        <Field id="invDue" label="Due date" error={err("dueOn")} className="col-span-2 sm:col-span-1">
          <input id="invDue" type="date" min={today} value={v.dueOn} onChange={(e) => setV({ ...v, dueOn: e.target.value })} className={inputClass(!!err("dueOn"))} />
        </Field>
        <Field id="invNotes" label="Note on the invoice" error={err("notes")} className="col-span-2">
          <textarea id="invNotes" rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} placeholder="e.g. Bank details or payment instructions" className={inputClass(!!err("notes"), "min-h-16 resize-y py-2.5")} />
        </Field>
      </form>
    </Dialog>
  );
}

export function IssueInvoiceModal({
  invoice,
  today,
  bookingCreated,
  onClose,
  onSave,
}: {
  invoice: Invoice;
  today: string;
  bookingCreated: string;
  onClose: () => void;
  onSave: (v: IssueInvoiceValues) => Promise<boolean>;
}) {
  const [v, setV] = useState<IssueInvoiceValues>({ issueOn: today, dueOn: invoice.dueOn && invoice.dueOn >= today ? invoice.dueOn : today });
  const errors = validateIssueInvoice(v, today, bookingCreated);
  const { submitted, saving, submit } = useSubmit(onSave, onClose);
  const err = (k: keyof IssueInvoiceValues) => (submitted ? errors[k] : undefined);
  return (
    <Dialog
      title="Issue invoice"
      description={
        <>
          The invoice gets its number, the customer and passenger details are frozen, and the booking&apos;s payments are linked. After this
          it can only be voided.
        </>
      }
      formId="issue-invoice-form"
      saving={saving}
      label="Issue invoice"
      onClose={onClose}
    >
      <form id="issue-invoice-form" onSubmit={(e) => submit(e, v, Object.keys(errors).length > 0)} noValidate className="grid grid-cols-2 gap-4">
        <Field id="issueOn" label="Issue date" required error={err("issueOn")} className="col-span-2 sm:col-span-1">
          <input id="issueOn" type="date" max={today} value={v.issueOn} onChange={(e) => setV({ ...v, issueOn: e.target.value })} className={inputClass(!!err("issueOn"))} />
        </Field>
        <Field id="issueDue" label="Due date" required error={err("dueOn")} className="col-span-2 sm:col-span-1">
          <input id="issueDue" type="date" min={v.issueOn} value={v.dueOn} onChange={(e) => setV({ ...v, dueOn: e.target.value })} className={inputClass(!!err("dueOn"))} />
        </Field>
        <p className="col-span-2 text-sm text-navy-500">
          Total <span className="font-semibold text-navy-900">{formatMoney(invoice.total)}</span> for {invoice.billTo.name}.
        </p>
      </form>
    </Dialog>
  );
}

export function VoidInvoiceModal({ invoice, onClose, onSave }: { invoice: Invoice; onClose: () => void; onSave: (reason: string) => Promise<boolean> }) {
  const [reason, setReason] = useState("");
  const error = validateVoidReason(reason);
  const { submitted, saving, submit } = useSubmit(onSave, onClose);
  return (
    <Dialog
      title={`Void ${invoice.number ?? "draft invoice"}`}
      description="The invoice stays on record marked VOID, with your reason. You can then create and issue a new one for this booking."
      formId="void-invoice-form"
      saving={saving}
      label="Void invoice"
      onClose={onClose}
      danger
    >
      <form id="void-invoice-form" onSubmit={(e) => submit(e, reason, Boolean(error))} noValidate>
        <Field id="voidReason" label="Reason" required error={submitted ? error : undefined}>
          <textarea id="voidReason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong billing name — reissued" className={inputClass(submitted && !!error, "min-h-16 resize-y py-2.5")} />
        </Field>
      </form>
    </Dialog>
  );
}
