import { AppShell } from "@/components/layout/AppShell";
import { ToastProvider } from "@/components/ui/Toast";
import { CustomersProvider } from "@/components/customers/CustomersProvider";
import { customers } from "@/lib/mock-customers";
import { getCurrentUser } from "@/lib/auth";

// Every page inside the (crm) folder gets the sidebar + top bar.
// The "(crm)" folder name is a route group — it does NOT appear in the URL.
//
// Shared across all CRM pages:
//  • ToastProvider     – the little success messages in the corner
//  • CustomersProvider – the customer list + Add/Edit customer panel,
//                        so any module (e.g. Leads → "Convert to customer") can use them
//  • The signed-in user (name, role) for the top bar. Logged-out visitors never
//    get here: src/proxy.ts sends them to /login, and getCurrentUser() does too.
export default async function CrmLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  const shellUser = {
    name: user.name,
    email: user.email,
    initials: user.initials,
    roleLabel: user.membership?.roleLabel ?? "No agency access",
  };

  return (
    <ToastProvider>
      <CustomersProvider initialCustomers={customers}>
        <AppShell user={shellUser}>{children}</AppShell>
      </CustomersProvider>
    </ToastProvider>
  );
}
