"use client";

// Invoices card for a booking page or a customer profile. On a booking, Finance / admins
// can create the invoice (one active invoice per booking).
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Invoice } from "@/types/invoices";
import * as server from "@/lib/actions/invoices";
import { todayIso, useHydrated } from "@/lib/dates";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Icon } from "@/components/icons";
import { formatDate, formatMoney } from "@/lib/format";
import { CreateInvoiceModal, InvoiceStatusBadge } from "./invoice-ui";

export function InvoicesCard({
  invoices,
  booking,
  canManage,
}: {
  invoices: Invoice[];
  /** Set on a booking page: enables "Create invoice". */
  booking?: { dbId: string; code: string; cancelled: boolean; balanceDue?: string };
  canManage: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const hydrated = useHydrated();
  const today = hydrated ? todayIso() : null;
  const [creating, setCreating] = useState(false);
  const hasActive = invoices.some((i) => i.storedStatus !== "Void");
  const canCreate = canManage && booking && !booking.cancelled && !hasActive;

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Invoices"
        action={
          canCreate && (
            <button onClick={() => setCreating(true)} className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-sky-brand-dark hover:text-navy-900">
              <Icon name="plus" size={14} /> Create invoice
            </button>
          )
        }
      />
      {invoices.length ? (
        <ul className="mt-4 divide-y divide-navy-50 border-t border-navy-50">
          {invoices.map((inv) => (
            <li key={inv.id}>
              <Link href={`/invoices/${inv.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-sky-brand-light/40 sm:px-6">
                <span className="min-w-0">
                  <span className="block font-mono text-sm font-medium text-navy-900">{inv.number ?? "Draft"}</span>
                  <span className="text-xs text-navy-400">
                    {inv.bookingCode} · {inv.issueOn ? `issued ${formatDate(inv.issueOn)}` : `created ${formatDate(inv.created)}`}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-semibold tabular-nums text-navy-900">{formatMoney(inv.total)}</span>
                  <InvoiceStatusBadge invoice={inv} today={today} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 pb-5 text-sm text-navy-400 sm:px-6">{booking?.cancelled ? "Cancelled bookings aren't invoiced." : "No invoices yet."}</p>
      )}

      {creating && booking && today && (
        <CreateInvoiceModal
          bookingCode={booking.code}
          today={today}
          defaultDue={booking.balanceDue}
          onClose={() => setCreating(false)}
          onSave={async (v) => {
            const r = await server.createInvoice(booking.dbId, v);
            if (!r.ok) {
              toast({ tone: "info", message: <p>{r.message}</p> });
              return false;
            }
            toast({ message: <p>Invoice draft created. Review it, then issue it.</p> });
            router.push(`/invoices/${r.invoiceId}`);
            return true;
          }}
        />
      )}
    </Card>
  );
}
