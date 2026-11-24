import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CustomerProfile } from "@/components/customers/CustomerProfile";
import { getCustomerData } from "@/lib/data/customers";

// Customers come from Supabase. getCustomerData() is cached per request, so this
// shares the query the CRM layout already ran.
export async function generateMetadata({ params }: PageProps<"/customers/[id]">): Promise<Metadata> {
  const { id } = await params;
  const { customers } = await getCustomerData();
  const customer = customers.find((c) => c.id === id);
  return { title: customer ? customer.name : "Customer profile" };
}

export default async function CustomerProfilePage({ params }: PageProps<"/customers/[id]">) {
  const { id } = await params;
  // Customer codes look like "CU-1025"; anything else is a genuine 404.
  if (!/^CU-\d+$/.test(id)) notFound();
  return <CustomerProfile id={id} />;
}
