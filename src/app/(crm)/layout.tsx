import { AppShell } from "@/components/layout/AppShell";
import { ToastProvider } from "@/components/ui/Toast";
import { CustomersProvider } from "@/components/customers/CustomersProvider";
import { getCurrentUser } from "@/lib/auth";
import { getCustomerData } from "@/lib/data/customers";
import { getLeadData } from "@/lib/data/leads";
import { LeadListProvider } from "@/lib/lead-store";
import { getQuoteData } from "@/lib/data/quotations";
import { QuoteListProvider } from "@/lib/quote-store";
import { getBookingData } from "@/lib/data/bookings";
import { BookingListProvider } from "@/lib/booking-store";

// Every page inside the (crm) folder gets the sidebar + top bar.
// The "(crm)" folder name is a route group — it does NOT appear in the URL.
//
// Shared across all CRM pages:
//  • ToastProvider     – the little success messages in the corner
//  • CustomersProvider – customers from Supabase (only those this user's role may see)
//                        + the Add/Edit customer panel, so any module (e.g. Leads →
//                        "Convert to customer") can use them
//  • LeadListProvider  – leads from Supabase, shared by Leads, Quotations, Bookings and Reports
//  • QuoteListProvider – quotations from Supabase, shared by Quotations, Customers, Leads, Bookings and Reports
//  • BookingListProvider – bookings (with payments) from Supabase, shared by Bookings, Payments, Customers,
//                          Quotations, Dashboard and Reports
//  • The signed-in user (name, role) for the top bar. Logged-out visitors never
//    get here: src/proxy.ts sends them to /login, and getCurrentUser() does too.
export default async function CrmLayout({ children }: LayoutProps<"/">) {
  const [user, { customers, access }, leadData, quoteData, bookingData] = await Promise.all([
    getCurrentUser(),
    getCustomerData(),
    getLeadData(),
    getQuoteData(),
    getBookingData(),
  ]);
  const shellUser = {
    name: user.name,
    email: user.email,
    initials: user.initials,
    roleLabel: user.membership?.roleLabel ?? "No agency access",
  };

  return (
    <ToastProvider>
      <CustomersProvider initialCustomers={customers} access={access}>
        <LeadListProvider initialLeads={leadData.leads} access={leadData.access}>
          <QuoteListProvider initialQuotes={quoteData.quotes} access={quoteData.access}>
            <BookingListProvider initialBookings={bookingData.bookings} access={bookingData.access}>
              <AppShell user={shellUser}>{children}</AppShell>
            </BookingListProvider>
          </QuoteListProvider>
        </LeadListProvider>
      </CustomersProvider>
    </ToastProvider>
  );
}
