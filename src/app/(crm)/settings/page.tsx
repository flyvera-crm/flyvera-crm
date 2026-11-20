import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/ModulePlaceholder";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return <ModulePlaceholder href="/settings" />;
}
