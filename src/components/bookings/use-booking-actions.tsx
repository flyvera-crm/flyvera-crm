"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Booking, BookingPayment, Customer, Quotation } from "@/types/crm";
import { bookingStore, useBookings } from "@/lib/booking-store";
import { useLeadData } from "@/lib/lead-store";
import {
  bookingFromQuote,
  bookingMoney,
  nextBookingId,
  nextStep,
  STATUS_EVENT,
  type PaymentFormValues,
} from "@/lib/booking-rules";
import { compactPhone } from "@/lib/customer-validation";
import { splitName } from "@/lib/lead-validation";
import { todayIso } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { useCustomers } from "@/components/customers/CustomersProvider";
import { useToast } from "@/components/ui/Toast";

/** Every change to a booking goes through here: it stamps `updated` and adds a history line. */
function save(b: Booking, patch: Partial<Booking>, event?: string) {
  const date = todayIso();
  bookingStore.update({
    ...b,
    ...patch,
    updated: date,
    history: event ? [...b.history, { date, text: event }] : b.history,
  }); // ← later: API call
}

/** The booking as just saved in this browser (used by toast buttons clicked a moment later). */
function latestStored(id: string) {
  const s = bookingStore.getSnapshot();
  return s.edited[id] ?? s.added.find((b) => b.id === id);
}

export function useBookingActions() {
  const router = useRouter();
  const toast = useToast();
  const { bookings } = useBookings();
  const { customers, getCustomer, openAddForm } = useCustomers();
  const { leads, updateLeadStatus } = useLeadData();

  /** Moves the booking to its next status (if nothing blocks it). */
  const advance = useCallback(
    (b: Booking) => {
      const step = nextStep(b, todayIso());
      if (!step || step.blocker) return;
      save(b, { status: step.next }, STATUS_EVENT[step.next]);
      toast({ message: <p>{b.id}: {STATUS_EVENT[step.next].toLowerCase()}.</p> });
    },
    [toast],
  );

  const cancel = useCallback(
    (b: Booking, reason: string) => {
      save(b, { status: "Cancelled", cancelReason: reason }, `Booking cancelled — ${reason}`);
      toast({ tone: "info", message: <p>{b.id} was cancelled.</p> });
    },
    [toast],
  );

  const recordPayment = useCallback(
    (b: Booking, v: PaymentFormValues) => {
      const amount = Math.round(Number(v.amount.replace(/[,\s$]/g, "")) * 100) / 100;
      const nextId = `p${b.payments.reduce((m, p) => Math.max(m, Number(p.id.replace(/\D/g, "")) || 0), 0) + 1}`;
      const payment: BookingPayment = { id: nextId, date: v.date, amount, method: v.method, note: v.note.trim() || undefined };
      const updated: Booking = { ...b, payments: [...b.payments, payment] };
      const { balance } = bookingMoney(updated);
      save(b, { payments: updated.payments }, `Payment of ${formatMoney(amount)} received (${v.method})`);
      toast({
        message: (
          <p>
            {formatMoney(amount)} recorded.{" "}
            {balance > 0 ? <>Balance due: <span className="font-semibold">{formatMoney(balance)}</span>.</> : "Paid in full 🎉"}
          </p>
        ),
        // Deposit just arrived on a Pending booking → offer to confirm it right away.
        action:
          b.status === "Pending"
            ? {
                label: "Confirm booking",
                onClick: () => {
                  const latest = latestStored(b.id);
                  if (latest) advance(latest);
                },
              }
            : undefined,
      });
    },
    [toast, advance],
  );

  const removePayment = useCallback(
    (b: Booking, paymentId: string) => {
      const p = b.payments.find((x) => x.id === paymentId);
      if (!p || !window.confirm(`Remove the ${formatMoney(p.amount)} payment from ${p.date}?`)) return;
      save(b, { payments: b.payments.filter((x) => x.id !== paymentId) }, `Payment of ${formatMoney(p.amount)} removed`);
    },
    [],
  );

  /** Money returned to the customer (usually after a cancellation). */
  const recordRefund = useCallback(
    (b: Booking, v: { amount: string; date: string; method: BookingPayment["method"]; note: string }) => {
      const amount = Math.round(Number(v.amount.replace(/[,\s$]/g, "")) * 100) / 100;
      const nextId = `p${b.payments.reduce((m, p) => Math.max(m, Number(p.id.replace(/\D/g, "")) || 0), 0) + 1}`;
      const refund: BookingPayment = { id: nextId, date: v.date, amount, method: v.method, note: v.note.trim() || undefined, kind: "refund" };
      const payments = [...b.payments, refund];
      const kept = bookingMoney({ ...b, payments }).paid;
      // Anything not refunded is kept as a cancellation fee — the refund settles the case.
      save(b, { payments, refundSettled: true }, `Refund of ${formatMoney(amount)} sent (${v.method})${kept > 0 ? ` — ${formatMoney(kept)} kept as fee` : ""}`);
      toast({ message: <p>Refund of {formatMoney(amount)} to {b.customerName} recorded.</p> });
    },
    [toast],
  );

  /** Cancelled booking: keep what was paid (non-refundable deposit / fee). */
  const keepAsFee = useCallback(
    (b: Booking) => {
      const { paid } = bookingMoney(b);
      save(b, { refundSettled: true }, `No refund — ${formatMoney(paid)} kept as cancellation fee`);
      toast({ tone: "info", message: <p>{formatMoney(paid)} from {b.id} kept as a cancellation fee.</p> });
    },
    [toast],
  );

  /** Records that the agency paid the supplier for one service (with Undo). */
  const markSupplierPaid = useCallback(
    (b: Booking, serviceId: string, paid: boolean) => {
      const service = b.services.find((s) => s.id === serviceId);
      if (!service) return;
      const date = todayIso();
      save(
        b,
        { services: b.services.map((s) => (s.id === serviceId ? { ...s, supplierPaidOn: paid ? date : undefined } : s)) },
        paid ? `Supplier paid for ${service.type.toLowerCase()} (${formatMoney(service.cost)})` : `Supplier payment for ${service.type.toLowerCase()} undone`,
      );
      if (paid)
        toast({
          message: <p>Marked {formatMoney(service.cost)} to the {service.type.toLowerCase()} supplier as paid.</p>,
          action: {
            label: "Undo",
            onClick: () => {
              const latest = latestStored(b.id);
              if (latest) save(latest, { services: latest.services.map((s) => (s.id === serviceId ? { ...s, supplierPaidOn: undefined } : s)) }, `Supplier payment for ${service.type.toLowerCase()} undone`);
            },
          },
        });
    },
    [toast],
  );

  const setServiceRef = useCallback((b: Booking, serviceId: string, ref: string) => {
    const service = b.services.find((s) => s.id === serviceId);
    const clean = ref.trim().toUpperCase();
    if (!service || (service.ref ?? "") === clean) return;
    save(
      b,
      { services: b.services.map((s) => (s.id === serviceId ? { ...s, ref: clean || undefined } : s)) },
      clean ? `${service.type} confirmed — ref ${clean}` : `${service.type} reference removed`,
    );
  }, []);

  /**
   * Accepted quotation → booking. A quote for a lead needs a customer first:
   * we link an existing customer with the same phone, or open the customer form pre-filled.
   */
  const createFromQuote = useCallback(
    (q: Quotation) => {
      const existing = bookings.find((b) => b.quoteId === q.id);
      if (existing) return router.push(`/bookings/${existing.id}`);

      const make = (customer: Customer) => {
        const b = bookingFromQuote(q, customer, nextBookingId(bookings), todayIso());
        bookingStore.add(b);
        toast({
          message: (
            <p>
              Booking <span className="font-mono text-gold-300">{b.id}</span> created for {customer.name}. Next: record the deposit.
            </p>
          ),
        });
        router.push(`/bookings/${b.id}`);
      };

      if (q.recipient.kind === "customer") {
        const c = getCustomer(q.recipient.id);
        if (c) make(c);
        return;
      }

      const lead = leads.find((l) => l.id === q.recipient.id);
      const linked = lead?.customerId ? getCustomer(lead.customerId) : undefined;
      if (linked) return make(linked);

      const samePhone = customers.find((c) => compactPhone(c.phone) === compactPhone(q.recipient.phone));
      const linkLead = (customerId: string) => {
        if (lead) void updateLeadStatus(lead, { customerCode: customerId, stage: "Won", nextFollowUp: null, lostReason: null });
      };
      if (samePhone) {
        linkLead(samePhone.id);
        return make(samePhone);
      }
      openAddForm({
        context: `To book ${q.id}, first save ${q.recipient.name} as a customer — add their city & country.`,
        initialValues: {
          ...splitName(q.recipient.name),
          phone: q.recipient.phone,
          email: q.recipient.email ?? "",
          agent: lead?.agentId ?? q.agent,
          favouriteDestination: q.destination,
          whatsappOptIn: lead?.source === "WhatsApp",
          notes: lead?.notes ?? "",
        },
        onSaved: (customer) => {
          linkLead(customer.id);
          make(customer);
        },
      });
    },
    [bookings, customers, getCustomer, leads, openAddForm, router, toast, updateLeadStatus],
  );

  return { advance, cancel, recordPayment, recordRefund, keepAsFee, markSupplierPaid, removePayment, setServiceRef, createFromQuote };
}
