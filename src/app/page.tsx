import { redirect } from "next/navigation";

// The CRM lives under /dashboard — send visitors of "/" straight there.
export default function Home() {
  redirect("/dashboard");
}
