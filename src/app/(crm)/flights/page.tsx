import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/ModulePlaceholder";

export const metadata: Metadata = { title: "Flights" };

export default function Page() {
  return <ModulePlaceholder href="/flights" />;
}
