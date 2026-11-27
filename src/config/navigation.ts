import type { IconName } from "@/components/icons";

export type NavItem = {
  label: string;
  href: string;
  icon: IconName;
  description: string;
  badge?: string;
  /** A count worked out from live data in the sidebar (shown only when above 0). */
  liveBadge?: "leadFollowUps";
  /** Not built yet: left out of the sidebar; its page shows "coming soon" if opened directly. */
  planned?: true;
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
      { label: "Leads", href: "/leads", icon: "target", description: "Track enquiries from first contact to confirmed booking.", liveBadge: "leadFollowUps" },
      { label: "WhatsApp", href: "/whatsapp", icon: "chat", description: "Chat with travellers and send itineraries over WhatsApp.", planned: true },
      { label: "AI Assistant", href: "/ai-assistant", icon: "sparkles", description: "Draft itineraries, replies and quotations with AI.", planned: true },
    ],
  },
  {
    title: "Operations",
    items: [
      { label: "Flights", href: "/flights", icon: "plane", description: "Turn trip requests into flight searches with AI. No live fares until a supplier is connected." },
      { label: "Quotations", href: "/quotations", icon: "document", description: "Build, send and track travel quotations." },
      { label: "Bookings", href: "/bookings", icon: "calendar", description: "All confirmed trips — flights, hotels and packages." },
      { label: "Tickets", href: "/tickets", icon: "ticket", description: "Issued e-tickets, reissues, refunds and voids." },
      { label: "Payments", href: "/payments", icon: "card", description: "Receipts, balances, refunds and supplier payments." },
      { label: "Invoices", href: "/invoices", icon: "wallet", description: "Numbered customer invoices and what's still to collect." },
      { label: "Suppliers", href: "/suppliers", icon: "globe", description: "Airlines, hotels and partners you book with." },
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

/** What the sidebar shows: built modules only (sections left empty are dropped). */
export const sidebarSections: NavSection[] = navSections
  .map((s) => ({ ...s, items: s.items.filter((i) => !i.planned) }))
  .filter((s) => s.items.length > 0);

export function getNavItem(href: string): NavItem {
  const item = allNavItems.find((i) => i.href === href);
  if (!item) throw new Error(`Unknown nav item: ${href}`);
  return item;
}
