import { AppShell } from "@/components/layout/AppShell";
import { ToastProvider } from "@/components/ui/Toast";
import { CustomersProvider } from "@/components/customers/CustomersProvider";
import { customers } from "@/lib/mock-customers";

// Every page inside the (crm) folder gets the sidebar + top bar.
// The "(crm)" folder name is a route group — it does NOT appear in the URL.
//
// Shared across all CRM pages:
//  • ToastProvider     – the little success messages in the corner
//  • CustomersProvider – the customer list + Add/Edit customer panel,
//                        so any module (e.g. Leads → "Convert to customer") can use them
export default function CrmLayout({ children }: LayoutProps<"/">) {
  return (
    <ToastProvider>
      <CustomersProvider initialCustomers={customers}>
        <AppShell>{children}</AppShell>
      </CustomersProvider>
    </ToastProvider>
  );
}
