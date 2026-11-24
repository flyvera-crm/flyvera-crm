import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Receipt } from "@/components/payments/Receipt";
import { receiptNumber } from "@/lib/payment-ledger";

// Receipt (payment "p1", "p2"…) or refund note (refund "r1", "r2"…) for a booking.
// The booking and its payments come from the CRM layout's shared booking list.
export async function generateMetadata({ params }: PageProps<"/payments/[bookingId]/[paymentId]">): Promise<Metadata> {
  const { bookingId, paymentId } = await params;
  return { title: `${paymentId.startsWith("r") ? "Refund note" : "Receipt"} ${receiptNumber(bookingId, paymentId)}` };
}

export default async function ReceiptPage({ params }: PageProps<"/payments/[bookingId]/[paymentId]">) {
  const { bookingId, paymentId } = await params;
  if (!/^FV-\d+$/.test(bookingId) || !/^[pr]\d+$/.test(paymentId)) notFound();
  return <Receipt bookingId={bookingId} paymentId={paymentId} />;
}
