"use client";

// A booking's refund requests with the buttons each person may use (migration 18).
// The database enforces the same rules: Finance / admins decide, the requester can't approve or pay
// their own request (admins excepted), and only the requester can withdraw a pending one.
import { useState, useTransition } from "react";
import Link from "next/link";
import type { Booking, RefundRequest } from "@/types/crm";
import type { BookingAccess } from "@/lib/data/bookings";
import { formatDate, formatMoney } from "@/lib/format";
import { useBookingActions } from "./use-booking-actions";
import { ApproveRefundModal, PayRefundModal, RefundStatusChip, RejectRefundModal } from "./RefundModals";

type Dialog = { kind: "approve" | "reject" | "pay"; request: RefundRequest } | null;

const btn = "rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-60";

export function RefundRequestsList({
  booking,
  access,
  today,
  requests,
  showBooking,
}: {
  booking: Booking;
  access: BookingAccess;
  today: string | null;
  /** Defaults to all of the booking's requests. */
  requests?: RefundRequest[];
  /** Show the booking code and customer (Payments page). */
  showBooking?: boolean;
}) {
  const actions = useBookingActions();
  const [busy, startBusy] = useTransition();
  const [dialog, setDialog] = useState<Dialog>(null);
  const list = requests ?? booking.refundRequests ?? [];
  const run = (fn: () => Promise<unknown>) => startBusy(async () => void (await fn()));
  const close = () => setDialog(null);

  return (
    <>
      <ul className="divide-y divide-navy-50">
        {list.map((r) => {
          const mine = r.requestedById === access.me;
          const ownBlocked = mine && !access.isAdmin; // separation of duties
          const decide = access.canRecordMoney && !ownBlocked;
          return (
            <li key={r.dbId} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-6">
              <div className="min-w-0 text-sm">
                <p className="flex flex-wrap items-center gap-2 font-medium text-navy-900">
                  {showBooking && (
                    <Link href={`/bookings/${booking.id}`} className="text-sky-brand-dark hover:underline">
                      {booking.id}
                    </Link>
                  )}
                  <span className="font-mono text-xs text-navy-500">{r.reference}</span>
                  <span className="tabular-nums">{formatMoney(r.status === "Requested" ? r.requestedAmount : r.amount)}</span>
                  {r.status !== "Requested" && r.amount !== r.requestedAmount && (
                    <span className="text-xs font-normal text-navy-400 line-through">{formatMoney(r.requestedAmount)}</span>
                  )}
                  <RefundStatusChip status={r.status} />
                  {r.recordedDirectly && <RefundStatusChip status="Withdrawn">Recorded directly · no separate approval</RefundStatusChip>}
                </p>
                <p className="mt-0.5 text-xs text-navy-500">
                  {showBooking && <>{booking.customerName} · </>}
                  {r.category ?? "Refund"} · {r.method} · requested by {mine ? "you" : r.requestedByName} on {formatDate(r.requestedOn)}
                </p>
                {r.details && <p className="mt-1 text-xs text-navy-600">“{r.details}”</p>}
                {r.decisionNote && r.status !== "Withdrawn" && (
                  <p className="mt-1 text-xs text-navy-600">
                    <span className="font-medium">{r.status === "Rejected" ? "Rejected" : "Note"}{r.decidedByName && <> by {r.decidedByName}</>}:</span> {r.decisionNote}
                  </p>
                )}
                {r.status === "Paid" && r.paidOn && (
                  <p className="mt-1 text-xs text-emerald-700">
                    Sent {formatDate(r.paidOn)}
                    {r.paymentReference && <> · ref {r.paymentReference}</>}
                  </p>
                )}
                {ownBlocked && access.canRecordMoney && (r.status === "Requested" || r.status === "Approved") && (
                  <p className="mt-1 text-xs text-amber-700">You made this request, so another Finance user or an admin must decide on it.</p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap gap-1.5">
                {r.status === "Requested" && decide && (
                  <button disabled={busy} onClick={() => setDialog({ kind: "approve", request: r })} className={`${btn} bg-navy-900 text-white hover:bg-navy-800`}>
                    Approve
                  </button>
                )}
                {r.status === "Approved" && decide && (
                  <button disabled={busy} onClick={() => setDialog({ kind: "pay", request: r })} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
                    Mark paid
                  </button>
                )}
                {(r.status === "Requested" || r.status === "Approved") && access.canRecordMoney && (
                  <button disabled={busy} onClick={() => setDialog({ kind: "reject", request: r })} className={`${btn} border border-rose-200 text-rose-700 hover:bg-rose-50`}>
                    Reject
                  </button>
                )}
                {r.status === "Requested" && mine && (
                  <button disabled={busy} onClick={() => run(() => actions.withdrawRefund(booking, r))} className={`${btn} border border-navy-100 text-navy-600 hover:bg-navy-50`}>
                    Withdraw
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {dialog?.kind === "approve" && (
        <ApproveRefundModal
          request={dialog.request}
          onClose={close}
          onSave={(v) => {
            close();
            run(() => actions.approveRefund(booking, dialog.request, v));
          }}
        />
      )}
      {dialog?.kind === "reject" && (
        <RejectRefundModal
          request={dialog.request}
          onClose={close}
          onSave={(reason) => {
            close();
            run(() => actions.rejectRefund(booking, dialog.request, reason));
          }}
        />
      )}
      {dialog?.kind === "pay" && today && (
        <PayRefundModal
          request={dialog.request}
          booking={booking}
          today={today}
          onClose={close}
          onSave={(v) => {
            close();
            run(() => actions.payRefund(booking, dialog.request, v));
          }}
        />
      )}
    </>
  );
}
