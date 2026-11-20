import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/ModulePlaceholder";

export const metadata: Metadata = { title: "WhatsApp" };

export default function Page() {
  return <ModulePlaceholder href="/whatsapp" />;
}
