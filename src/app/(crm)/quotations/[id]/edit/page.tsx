import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QuoteEditor } from "@/components/quotations/QuoteEditor";
import { quotations } from "@/lib/mock-quotations";

export function generateStaticParams() {
  return quotations.map((q) => ({ id: q.id }));
}

export async function generateMetadata({ params }: PageProps<"/quotations/[id]/edit">): Promise<Metadata> {
  const { id } = await params;
  return { title: `Edit ${id}` };
}

export default async function EditQuotationPage({ params }: PageProps<"/quotations/[id]/edit">) {
  const { id } = await params;
  if (!/^QT-\d+$/.test(id)) notFound();
  return <QuoteEditor mode="edit" quoteId={id} />;
}
