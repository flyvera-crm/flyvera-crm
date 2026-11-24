"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Booking, Customer, Quotation } from "@/types/crm";
import { useBookingData, useBookings } from "@/lib/booking-store";
import { useLeadData } from "@/lib/lead-store";
import * as server from "@/lib/actions/bookings";
import { bookingMoney, STATUS_EVENT, type PaymentCorrectionValues, type PaymentFormValues } from "@/lib/booking-rules";
import { compactPhone } from "@/lib/customer-validation";
import { splitName } from "@/lib/lead-validation";
import { formatMoney } from "@/lib/format";
import { useCustomers } from "@/components/customers/CustomersProvider";
import { useToast } from "@/components/ui/Toast";

/**
 * Every booking change, saved to the database through Server Actions (src/lib/actions/bookings.ts).
 * Each returns true when it worked; when the server refuses, the reason is shown in a message.
 */
export function useBookingActions() {
  const router = useRouter();
  const toast = useToast();
  const { bookings } = useBookings();
  const { showSaved } = useBookingData();
  const { customers, getCustomer, openAddForm } = useCustomers();
  const { leads, updateLeadStatus } = useLeadData();

  /** Shows the saved booking, or the server's reason when it refused. */
  const apply = useCallback(
    (result: server.BookingResult) => {
      if (!result.ok) {
        toast({ tone: "info", message: <p>{result.message}</p> });
        return null;
      }
      showSaved(result.booking);
      return result.booking;
    },
    [showSaved, toast],
  );

  /** Moves the booking to its next status (if nothing blocks it). */
  const advance = useCallback(
    async (b: Booking) => {
      const saved = apply(await server.advanceBooking(b.dbId));
      if (saved) toast({ message: <p>{b.id}: {STATUS_EVENT[saved.status].toLowerCase()}.</p> });
      return Boolean(saved);
    },
    [apply, toast],
  );

  const cancel = useCallback(
    async (b: Booking, reason: string) => {
      const saved = apply(await server.cancelBooking(b.dbId, reason));
      if (saved) toast({ tone: "info", message: <p>{b.id} was cancelled.</p> });
      return Boolean(saved);
    },
    [apply, toast],
  );

  const recordPayment = useCallback(
    async (b: Booking, v: PaymentFormValues) => {
      const saved = apply(await server.recordPayment(b.dbId, v));
      if (!saved) return false;
      const { balance } = bookingMoney(saved);
      const amount = Math.round(Number(v.amount.replace(/[,\s$]/g, "")) * 100) / 100;
      toast({
        message: (
          <p>
            {formatMoney(amount)} recorded.{" "}
            {balance > 0 ? <>Balance due: <span className="font-semibold">{formatMoney(balance)}</span>.</> : "Paid in full 🎉"}
          </p>
        ),
        // Deposit just arrived on a Pending booking → offer to confirm it right away.
        action: saved.status === "Pending" ? { label: "Confirm booking", onClick: () => void advance(saved) } : undefined,
      });
      return true;
    },
    [apply, advance, toast],
  );

  /** Finance / admin: corrects a recorded payment (reason required; logged in the audit log and the booking's history). */
  const correctPayment = useCallback(
    async (b: Booking, paymentDbId: string, v: PaymentCorrectionValues) => {
      const saved = apply(await server.correctPayment(b.dbId, paymentDbId, v));
      if (saved) toast({ message: <p>Payment corrected. The change and your reason are in the booking&apos;s history.</p> });
      return Boolean(saved);
    },
    [apply, toast],
  );

  /** Money returned to the customer (after a cancellation). */
  const recordRefund = useCallback(
    async (b: Booking, v: PaymentFormValues) => {
      const saved = apply(await server.recordRefund(b.dbId, v));
      if (saved) toast({ message: <p>Refund of {formatMoney(Number(v.amount.replace(/[,\s$]/g, "")))} to {b.customerName} recorded.</p> });
      return Boolean(saved);
    },
    [apply, toast],
  );

  /** Cancelled booking: keep what was paid (non-refundable deposit / fee). */
  const keepAsFee = useCallback(
    async (b: Booking) => {
      const saved = apply(await server.keepAsFee(b.dbId));
      if (saved) toast({ tone: "info", message: <p>{formatMoney(bookingMoney(b).paid)} from {b.id} kept as a cancellation fee.</p> });
      return Boolean(saved);
    },
    [apply, toast],
  );

  /** Records that the agency paid the supplier for one service; Undo records a reversing entry. */
  const markSupplierPaid = useCallback(
    async (b: Booking, serviceId: string, paid: boolean) => {
      const service = b.services.find((s) => s.id === serviceId);
      if (!service?.dbId) return false;
      const saved = apply(await server.markSupplierPaid(b.dbId, service.dbId, paid));
      if (!saved) return false;
      if (paid)
        toast({
          message: <p>Marked {formatMoney(service.cost)} to the {service.type.toLowerCase()} supplier as paid.</p>,
          action: { label: "Undo", onClick: () => void server.markSupplierPaid(saved.dbId, service.dbId, false).then(apply) },
        });
      else toast({ tone: "info", message: <p>Supplier payment for {service.type.toLowerCase()} reversed.</p> });
      return true;
    },
    [apply, toast],
  );

  const setServiceRef = useCallback(
    async (b: Booking, serviceId: string, ref: string) => {
      const service = b.services.find((s) => s.id === serviceId);
      if (!service?.dbId || (service.ref ?? "") === ref.trim().toUpperCase()) return true;
      return Boolean(apply(await server.setServiceRef(b.dbId, service.dbId, ref)));
    },
    [apply],
  );

  /**
   * Accepted quotation → booking. A quote for a lead needs a customer first:
   * we link an existing customer with the same phone, or open the customer form pre-filled.
   */
  const createFromQuote = useCallback(
    (q: Quotation) => {
      const existing = bookings.find((b) => b.quoteId === q.id);
      if (existing) return router.push(`/bookings/${existing.id}`);

      const make = async (customer: Customer) => {
        if (!q.dbId) return;
        const result = await server.createBookingFromQuote(q.dbId, customer.id);
        if (!result.ok) {
          toast({ tone: "info", message: <p>{result.message}</p> });
          return;
        }
        showSaved(result.booking, true);
        toast({
          message: (
            <p>
              Booking <span className="font-mono text-gold-300">{result.booking.id}</span> created for {customer.name}. Next: record the
              deposit.
            </p>
          ),
        });
        router.push(`/bookings/${result.booking.id}`);
      };

      if (q.recipient.kind === "customer") {
        const c = getCustomer(q.recipient.id);
        if (c) void make(c);
        else toast({ tone: "info", message: <p>Customer {q.recipient.id} isn&apos;t available to you.</p> });
        return;
      }

      const lead = leads.find((l) => l.id === q.recipient.id);
      const linked = lead?.customerId ? getCustomer(lead.customerId) : undefined;
      if (linked) return void make(linked);

      const samePhone = customers.find((c) => compactPhone(c.phone) === compactPhone(q.recipient.phone));
      const linkLead = (customerId: string) => {
        if (lead) void updateLeadStatus(lead, { customerCode: customerId, stage: "Won", nextFollowUp: null, lostReason: null });
      };
      if (samePhone) {
        linkLead(samePhone.id);
        return void make(samePhone);
      }
      openAddForm({
        context: `To book ${q.id}, first save ${q.recipient.name} as a customer — add their city & country.`,
        initialValues: {
          ...splitName(q.recipient.name),
          phone: q.recipient.phone,
          email: q.recipient.email ?? "",
          agent: lead?.agentId ?? q.agentId ?? q.agent,
          favouriteDestination: q.destination,
          whatsappOptIn: lead?.source === "WhatsApp",
          notes: lead?.notes ?? "",
        },
        onSaved: (customer) => {
          linkLead(customer.id);
          void make(customer);
        },
      });
    },
    [bookings, customers, getCustomer, leads, openAddForm, router, showSaved, toast, updateLeadStatus],
  );

  return { advance, cancel, recordPayment, correctPayment, recordRefund, keepAsFee, markSupplierPaid, setServiceRef, createFromQuote };
}
