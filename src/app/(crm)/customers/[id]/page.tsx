import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CustomerProfile } from "@/components/customers/CustomerProfile";
import { customers } from "@/lib/mock-customers";

// Pre-build a page for every demo customer at build time.
// Customers added in the browser (not known here) are still served —
// dynamicParams defaults to true — and looked up on the client.
export function generateStaticParams() {
  return customers.map((c) => ({ id: c.id }));
}

export async function generateMetadata({ params }: PageProps<"/customers/[id]">): Promise<Metadata> {
  const { id } = await params;
  const customer = customers.find((c) => c.id === id);
  return { title: customer ? customer.name : "Customer profile" };
}

export default async function CustomerProfilePage({ params }: PageProps<"/customers/[id]">) {
  const { id } = await params;
  // Customer IDs look like "CU-1025"; anything else is a genuine 404.
  if (!/^CU-\d+$/.test(id)) notFound();
  return <CustomerProfile id={id} />;
}
