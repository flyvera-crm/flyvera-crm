import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Receipt } from "@/components/payments/Receipt";
import { bookings } from "@/lib/mock-bookings";
import { receiptNumber } from "@/lib/payment-ledger";

// Pre-build a receipt page for every demo payment. Payments recorded in the
// browser are still served (dynamicParams defaults to true) and looked up on the client.
export function generateStaticParams() {
  return bookings.flatMap((b) => b.payments.map((p) => ({ bookingId: b.id, paymentId: p.id })));
}

export async function generateMetadata({ params }: PageProps<"/payments/[bookingId]/[paymentId]">): Promise<Metadata> {
  const { bookingId, paymentId } = await params;
  return { title: `Receipt ${receiptNumber(bookingId, paymentId)}` };
}

export default async function ReceiptPage({ params }: PageProps<"/payments/[bookingId]/[paymentId]">) {
  const { bookingId, paymentId } = await params;
  if (!/^FV-\d+$/.test(bookingId) || !/^p\d+$/.test(paymentId)) notFound();
  return <Receipt bookingId={bookingId} paymentId={paymentId} />;
}
