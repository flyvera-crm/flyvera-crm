import type { Metadata } from "next";
import { QuoteEditor } from "@/components/quotations/QuoteEditor";

export const metadata: Metadata = { title: "New quotation" };

// Optional pre-fill from the URL:
//   /quotations/new?lead=LD-2053      (from a lead)
//   /quotations/new?customer=CU-1001  (from a customer profile)
export default async function NewQuotationPage({ searchParams }: PageProps<"/quotations/new">) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return <QuoteEditor mode="add" leadId={one(params.lead)} customerId={one(params.customer)} />;
}
