// The six agency roles (database enum public.app_role), shared by server and browser code.

export type AppRole = "admin" | "sales_manager" | "sales_agent" | "ticketing_agent" | "finance_manager" | "support_agent";

export const ROLES: AppRole[] = ["admin", "sales_manager", "sales_agent", "ticketing_agent", "finance_manager", "support_agent"];

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Agency Admin",
  sales_manager: "Sales Manager",
  sales_agent: "Sales Agent",
  ticketing_agent: "Ticketing Agent",
  finance_manager: "Finance Manager",
  support_agent: "Support Agent",
};

/** What each role can do — shown when inviting someone or changing their role. */
export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  admin: "Everything, including the team, settings and the audit log.",
  sales_manager: "Customers, leads, quotations and bookings of the teams they manage.",
  sales_agent: "Their own customers, leads, quotations and bookings.",
  ticketing_agent: "All bookings, passengers, PNRs and tickets; no leads.",
  finance_manager: "Payments, refunds, invoices and supplier payments.",
  support_agent: "Customer profiles, leads (read) and WhatsApp; no money or passports.",
};
