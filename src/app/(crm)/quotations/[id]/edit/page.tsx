import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QuoteEditor } from "@/components/quotations/QuoteEditor";
import { QuotationsNoAccess } from "@/components/quotations/QuotationsNoAccess";
import { getQuoteData } from "@/lib/data/quotations";

export async function generateMetadata({ params }: PageProps<"/quotations/[id]/edit">): Promise<Metadata> {
  const { id } = await params;
  return { title: `Edit ${id}` };
}

export default async function EditQuotationPage({ params }: PageProps<"/quotations/[id]/edit">) {
  const { id } = await params;
  if (!/^QT-\d+$/.test(id)) notFound();
  const { access } = await getQuoteData();
  if (!access.canView) return <QuotationsNoAccess />;
  return <QuoteEditor mode="edit" quoteId={id} />;
}
