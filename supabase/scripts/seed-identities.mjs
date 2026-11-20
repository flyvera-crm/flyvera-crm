// Fixed IDs for the development seed. Shared by build-seed.mjs and the tests.
// DEVELOPMENT ONLY — fictional people, *.test email domains.

export const ORG = "11111111-1111-4111-8111-111111111111"; // FLYVERA TRAVEL
export const OTHER_ORG = "22222222-2222-4222-8222-222222222222"; // Northwind Travel (tenant-isolation tests)

const U = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const USERS = {
  aisha: { id: U(1), name: "Aisha Khan", display: "Aisha K.", email: "aisha.khan@flyvera.test", role: "admin" },
  maya: { id: U(2), name: "Maya Torres", display: "Maya T.", email: "maya.torres@flyvera.test", role: "sales_manager" },
  sara: { id: U(3), name: "Sara Kim", display: "Sara K.", email: "sara.kim@flyvera.test", role: "sales_agent" },
  daniel: { id: U(4), name: "Daniel Reyes", display: "Daniel R.", email: "daniel.reyes@flyvera.test", role: "sales_agent" },
  priya: { id: U(5), name: "Priya Nair", display: "Priya N.", email: "priya.nair@flyvera.test", role: "sales_agent" },
  leo: { id: U(6), name: "Leo Martins", display: "Leo M.", email: "leo.martins@flyvera.test", role: "ticketing_agent" },
  fiona: { id: U(7), name: "Fiona Walsh", display: "Fiona W.", email: "fiona.walsh@flyvera.test", role: "finance_manager" },
  sam: { id: U(8), name: "Sam Okoye", display: "Sam O.", email: "sam.okoye@flyvera.test", role: "support_agent" },
  tom: { id: U(9), name: "Tom Former", display: "Tom F.", email: "tom.former@flyvera.test", role: "sales_agent", disabled: true },
  nora: { id: U(10), name: "Nora West", display: "Nora W.", email: "nora.west@northwind.test", role: "admin", org: OTHER_ORG },
};

// Team Atlas: Maya (manager), Sara, Daniel · Team Horizon: Priya (no manager)
export const TEAM_ATLAS = "c0000000-0000-4000-8000-000000000001";
export const TEAM_HORIZON = "c0000000-0000-4000-8000-000000000002";

// Frontend agent labels → seeded users
export const AGENT = { "Sara K.": USERS.sara.id, "Daniel R.": USERS.daniel.id, "Priya N.": USERS.priya.id };
