import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QuoteView } from "@/components/quotations/QuoteView";
import { QuotationsNoAccess } from "@/components/quotations/QuotationsNoAccess";
import { getQuoteData } from "@/lib/data/quotations";

// Quotations come from Supabase. getQuoteData() is cached per request, so this
// shares the query the CRM layout already ran.
export async function generateMetadata({ params }: PageProps<"/quotations/[id]">): Promise<Metadata> {
  const { id } = await params;
  const { quotes } = await getQuoteData();
  const q = quotes.find((x) => x.id === id);
  return { title: q ? `${q.id} · ${q.title}` : `Quotation ${id}` };
}

export default async function QuotationPage({ params }: PageProps<"/quotations/[id]">) {
  const { id } = await params;
  if (!/^QT-\d+$/.test(id)) notFound();
  const { access } = await getQuoteData();
  if (!access.canView) return <QuotationsNoAccess />;
  return <QuoteView id={id} />;
}
