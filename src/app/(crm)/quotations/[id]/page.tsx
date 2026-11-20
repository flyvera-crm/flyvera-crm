import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QuoteView } from "@/components/quotations/QuoteView";
import { quotations } from "@/lib/mock-quotations";

// Pre-build each demo quotation. Quotations created in the browser are
// still served (dynamicParams defaults to true) and looked up on the client.
export function generateStaticParams() {
  return quotations.map((q) => ({ id: q.id }));
}

export async function generateMetadata({ params }: PageProps<"/quotations/[id]">): Promise<Metadata> {
  const { id } = await params;
  const q = quotations.find((x) => x.id === id);
  return { title: q ? `${q.id} · ${q.title}` : `Quotation ${id}` };
}

export default async function QuotationPage({ params }: PageProps<"/quotations/[id]">) {
  const { id } = await params;
  if (!/^QT-\d+$/.test(id)) notFound();
  return <QuoteView id={id} />;
}
