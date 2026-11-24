"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Invoice, InvoiceAccess, InvoiceHistoryLine } from "@/types/invoices";
import * as server from "@/lib/actions/invoices";
import { balanceDue, invoiceStatus, validateCreateInvoice } from "@/lib/invoice-rules";
import { todayIso, useHydrated } from "@/lib/dates";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Field, inputClass } from "@/components/ui/form";
import { Icon, type IconName } from "@/components/icons";
import { cn, formatDate, formatMoney } from "@/lib/format";
import { InvoiceDocument, InvoicePayments, InvoiceStatusBadge, IssueInvoiceModal, VoidInvoiceModal } from "./invoice-ui";

export function InvoiceView({
  invoice: inv,
  history,
  access,
  bookingCreated,
}: {
  invoice: Invoice;
  history: InvoiceHistoryLine[];
  access: InvoiceAccess;
  bookingCreated: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const hydrated = useHydrated();
  const today = hydrated ? todayIso() : null;
  const [dialog, setDialog] = useState<"issue" | "void" | null>(null);
  const [busy, startBusy] = useTransition();
  const status = invoiceStatus(inv, today);
  const isDraft = inv.storedStatus === "Draft";
  const canVoid = access.canManage && inv.storedStatus !== "Void";

  async function run(action: Promise<server.InvoiceActionResult>, success?: string) {
    const r = await action;
    if (!r.ok) {
      toast({ tone: "info", message: <p>{r.message}</p> });
      return false;
    }
    toast({ message: <p>{r.message ?? success}</p> });
    router.refresh();
    return true;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4 print:hidden">
        <Link href="/invoices" className="inline-flex items-center gap-1.5 text-sm font-medium text-navy-500 hover:text-navy-900">
          <Icon name="arrowRight" size={16} className="rotate-180" /> All invoices
        </Link>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-navy-400">{inv.number ?? "Draft"}</span>
              <InvoiceStatusBadge invoice={inv} today={today} />
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">{inv.billTo.name}</h1>
            <p className="mt-1 text-sm text-navy-500">
              <Link href={`/bookings/${inv.bookingCode}`} className="font-mono text-sky-brand-dark hover:underline">
                {inv.bookingCode}
              </Link>{" "}
              · {inv.bookingTitle} · {formatMoney(inv.total)}
              {status !== "Draft" && status !== "Void" && <> · balance {formatMoney(balanceDue(inv))}</>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {access.canManage && isDraft && (
              <>
                <ToolbarButton primary icon="check" onClick={() => setDialog("issue")} disabled={busy}>
                  Issue invoice
                </ToolbarButton>
                <ToolbarButton icon="arrowRight" onClick={() => startBusy(async () => void (await run(server.refreshInvoiceDraft(inv.id), "Draft refreshed from the booking.")))} disabled={busy}>
                  Refresh from booking
                </ToolbarButton>
              </>
            )}
            <a href={`/invoices/${inv.id}/pdf`} className={toolbarCls()}>
              <Icon name="document" size={16} /> Download PDF
            </a>
            <ToolbarButton icon="chart" onClick={() => window.print()}>
              Print
            </ToolbarButton>
            {canVoid && (
              <ToolbarButton danger icon="close" onClick={() => setDialog("void")} disabled={busy}>
                Void
              </ToolbarButton>
            )}
          </div>
        </div>
        {status === "Overdue" && (
          <p className="flex items-center gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <Icon name="alert" size={16} /> Overdue since {formatDate(inv.dueOn!)} — {formatMoney(balanceDue(inv))} still to collect.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3 print:block">
        <div className="xl:col-span-2">
          <InvoiceDocument invoice={inv} today={today} />
        </div>
        <aside className="space-y-6 print:hidden">
          {access.canManage && isDraft && <DraftDetails invoice={inv} today={today} run={run} />}
          <Card>
            <CardHeader title="Payments" subtitle={status === "Draft" ? "Linked when the invoice is issued." : `${formatMoney(inv.paid)} received`} />
            <div className="px-5 pb-4 sm:px-6">
              <InvoicePayments invoice={inv} />
              {status !== "Draft" && status !== "Void" && !access.canManage && balanceDue(inv) > 0 && (
                <p className="mt-2 text-xs text-navy-400">Payments are recorded by Finance on the booking.</p>
              )}
              {access.canManage && status !== "Draft" && status !== "Void" && balanceDue(inv) > 0 && (
                <Link href={`/bookings/${inv.bookingCode}`} className="mt-3 inline-flex text-sm font-semibold text-sky-brand-dark hover:text-navy-900">
                  Record a payment on the booking →
                </Link>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="History" subtitle="Who created, issued or voided this invoice is in the audit log." />
            <ol className="space-y-3 p-5 sm:px-6">
              {[...history].reverse().map((e, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-sky-brand-dark" />
                  <div>
                    <p className="text-navy-700">{e.text}</p>
                    <p className="text-xs text-navy-400">{formatDate(e.date)}</p>
                  </div>
                </li>
              ))}
              {history.length === 0 && <li className="text-sm text-navy-400">No history yet.</li>}
            </ol>
          </Card>
        </aside>
      </div>

      {dialog === "issue" && today && (
        <IssueInvoiceModal
          invoice={inv}
          today={today}
          bookingCreated={bookingCreated}
          onClose={() => setDialog(null)}
          onSave={(v) => run(server.issueInvoice(inv.id, v, bookingCreated))}
        />
      )}
      {dialog === "void" && <VoidInvoiceModal invoice={inv} onClose={() => setDialog(null)} onSave={(reason) => run(server.voidInvoice(inv.id, reason), "Invoice voided.")} />}
    </div>
  );
}

/** Draft-only edits: due date and the note printed on the invoice (amounts come from the booking). */
function DraftDetails({ invoice, today, run }: { invoice: Invoice; today: string | null; run: (a: Promise<server.InvoiceActionResult>, s?: string) => Promise<boolean> }) {
  const [dueOn, setDueOn] = useState(invoice.dueOn ?? "");
  const [notes, setNotes] = useState(invoice.notes ?? "");
  const [saving, startSaving] = useTransition();
  const errors = today ? validateCreateInvoice({ serviceFee: "", dueOn, notes }, today) : {};
  const changed = dueOn !== (invoice.dueOn ?? "") || notes !== (invoice.notes ?? "");
  return (
    <Card>
      <CardHeader title="Draft details" subtitle="Amounts come from the booking — use Refresh after a booking change." />
      <form
        className="grid gap-4 p-5 sm:px-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (Object.keys(errors).length || !changed) return;
          startSaving(async () => void (await run(server.updateInvoiceDraft(invoice.id, { dueOn, notes }), "Draft saved.")));
        }}
      >
        <Field id="draftDue" label="Due date" error={errors.dueOn}>
          <input id="draftDue" type="date" min={today ?? undefined} value={dueOn} onChange={(e) => setDueOn(e.target.value)} className={inputClass(!!errors.dueOn)} />
        </Field>
        <Field id="draftNotes" label="Note on the invoice" error={errors.notes}>
          <textarea id="draftNotes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass(!!errors.notes, "min-h-20 resize-y py-2.5")} />
        </Field>
        <button
          type="submit"
          disabled={saving || !changed}
          className="rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-800 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save draft"}
        </button>
      </form>
    </Card>
  );
}

const toolbarCls = (primary?: boolean, danger?: boolean) =>
  cn(
    "flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-wait disabled:opacity-60",
    primary ? "bg-navy-900 text-white hover:bg-navy-800" : danger ? "border border-rose-200 text-rose-700 hover:bg-rose-50" : "border border-navy-100 bg-white text-navy-700 hover:bg-navy-50",
  );

function ToolbarButton({ icon, primary, danger, disabled, onClick, children }: { icon: IconName; primary?: boolean; danger?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={toolbarCls(primary, danger)}>
      <Icon name={icon} size={16} className={primary ? "text-gold-300" : undefined} /> {children}
    </button>
  );
}
