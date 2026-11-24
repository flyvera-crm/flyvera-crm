import type { IconName } from "@/components/icons";

export type NavItem = {
  label: string;
  href: string;
  icon: IconName;
  description: string;
  badge?: string;
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

// Single source of truth for the sidebar AND the module placeholder pages.
export const navSections: NavSection[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: "dashboard", description: "Your agency at a glance." },
    ],
  },
  {
    title: "Sales & Clients",
    items: [
      { label: "Customers", href: "/customers", icon: "users", description: "Traveller profiles, passports, preferences and trip history." },
      { label: "Leads", href: "/leads", icon: "target", description: "Track enquiries from first contact to confirmed booking.", badge: "12" },
      { label: "WhatsApp", href: "/whatsapp", icon: "chat", description: "Chat with travellers and send itineraries over WhatsApp.", badge: "5" },
      { label: "AI Assistant", href: "/ai-assistant", icon: "sparkles", description: "Draft itineraries, replies and quotations with AI." },
    ],
  },
  {
    title: "Operations",
    items: [
      { label: "Flights", href: "/flights", icon: "plane", description: "Search fares, manage PNRs and monitor schedule changes." },
      { label: "Quotations", href: "/quotations", icon: "document", description: "Build, send and track travel quotations." },
      { label: "Bookings", href: "/bookings", icon: "calendar", description: "All confirmed trips — flights, hotels and packages." },
      { label: "Tickets", href: "/tickets", icon: "ticket", description: "Issued e-tickets, reissues, refunds and voids." },
      { label: "Payments", href: "/payments", icon: "card", description: "Receipts, balances, refunds and supplier payments." },
      { label: "Invoices", href: "/invoices", icon: "wallet", description: "Numbered customer invoices and what's still to collect." },
    ],
  },
  {
    title: "Management",
    items: [
      { label: "Reports", href: "/reports", icon: "chart", description: "Sales, profit and team performance reports." },
      { label: "Team", href: "/team", icon: "team", description: "Agents, roles, targets and permissions." },
      { label: "Settings", href: "/settings", icon: "settings", description: "Agency profile, branding, integrations and preferences." },
    ],
  },
];

export const allNavItems = navSections.flatMap((s) => s.items);

export function getNavItem(href: string): NavItem {
  const item = allNavItems.find((i) => i.href === href);
  if (!item) throw new Error(`Unknown nav item: ${href}`);
  return item;
}
