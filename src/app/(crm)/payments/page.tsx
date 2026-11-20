import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { PaymentsWorkspace } from "@/components/payments/PaymentsWorkspace";

export const metadata: Metadata = { title: "Payments" };

export default function PaymentsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Payments"
        description="Money in from customers, refunds, and what you owe suppliers. Showing demo data."
      />
      <PaymentsWorkspace />
    </>
  );
}
