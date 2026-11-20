import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/ModulePlaceholder";

export const metadata: Metadata = { title: "AI Assistant" };

export default function Page() {
  return <ModulePlaceholder href="/ai-assistant" />;
}
