// FLYVERA CRM — database tests (PGlite).   Run with:  npm run db:test
//
// Builds a fresh in-memory PostgreSQL, applies every migration + the dev seed,
// then checks structure, relationships, money rules and Row Level Security for
// all six roles. Every "as user" block runs in a transaction that is rolled
// back, so tests are independent.
//
// ⚠️ These tests use PGlite plus minimal Supabase stand-ins. They do NOT replace
// testing against a real Supabase staging project — see docs/database/README.md.
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { asAnon, asOwner, asUser, createDb, migrationFiles } from "./helpers.mjs";
import { ORG, OTHER_ORG, USERS } from "../scripts/seed-identities.mjs";
import { customers } from "../../src/lib/mock-customers.ts";
import { leads } from "../../src/lib/mock-leads.ts";
import { quotations } from "../../src/lib/mock-quotations.ts";
import { bookings } from "../../src/lib/mock-bookings.ts";

let db;
const ids = {};

// ── Expected values derived from the frontend's demo data ─────────────────────
const agentOfCustomer = Object.fromEntries(customers.map((c) => [c.id, c.agent]));
const agentOfLead = Object.fromEntries(leads.map((l) => [l.id, l.agent]));
const customersOf = (...agents) => customers.filter((c) => agents.includes(c.agent));
const leadsOf = (...agents) => leads.filter((l) => agents.includes(l.agent));
const bookingsVisibleTo = (...agents) =>
  bookings.filter((b) => agents.includes(b.agent) || agents.includes(agentOfCustomer[b.customerId]));
const quotesVisibleTo = (...agents) =>
  quotations.filter((q) =>
    agents.includes(q.agent) ||
    (q.recipient.kind === "customer" && agents.includes(agentOfCustomer[q.recipient.id])) ||
    (q.recipient.kind === "lead" && agents.includes(agentOfLead[q.recipient.id])));
const paymentsOf = (bs) => bs.reduce((n, b) => n + b.payments.length, 0);
const money = (n) => Math.round(n * 100) / 100;
const bookingTotal = (b) => money(b.services.reduce((s, i) => s + money(i.quantity * i.unitPrice), 0));
const customersWithBookings = new Set(bookings.map((b) => b.customerId));

const count = async (q, sql, params) => (await q(`select count(*)::int as n from (${sql}) x`, params))[0].n;
const N = (rows) => rows.length;

before(async () => {
  db = await createDb({ seed: true });
  const lookup = async (table, code, org = ORG) =>
    (await db.query(`select id from public.${table} where code = $1 and organization_id = $2`, [code, org])).rows[0]?.id;
  for (const code of ["CU-1001", "CU-1002", "CU-1005", "CU-1007", "CU-1013", "CU-1018", "CU-1022"]) ids[code] = await lookup("customers", code);
  for (const code of ["FV-10476", "FV-10477", "FV-10479", "FV-10480", "FV-10481", "FV-10483"]) ids[code] = await lookup("bookings", code);
  for (const code of ["LD-2050", "LD-2061"]) ids[code] = await lookup("leads", code);
  ids.northwindCustomer = await lookup("customers", "CU-1001", OTHER_ORG);
  ids.docAmelia = (await db.query("select id from public.customer_travel_documents where customer_id = $1", [ids["CU-1001"]])).rows[0].id;
  ids.docDaniels = (await db.query("select id from public.customer_travel_documents where customer_id = $1", [ids["CU-1005"]])).rows[0].id;
  ids.docPriyas = (await db.query("select id from public.customer_travel_documents where customer_id = $1", [ids["CU-1018"]])).rows[0].id;
  ids.paxRahul = (await db.query("select id from public.passengers where booking_id = $1 and is_lead_passenger", [ids["FV-10476"]])).rows[0].id;
  ids.someDanielCustomer = customersOf("Daniel R.")[0].id;
  ids.somePriyaCustomer = customersOf("Priya N.")[0].id;
});

// ═════════════════════════════════════════════════════════════════════════════
describe("1 · Migrations & structure", () => {
  it("applies all 17 migrations in order on an empty database", () => {
    const files = migrationFiles();
    assert.equal(files.length, 17);
    assert.deepEqual(files, [...files].sort());
  });

  it("has Row Level Security switched on for every table in public", async () => {
    const r = await db.query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`);
    assert.deepEqual(r.rows, [], `RLS is off on: ${r.rows.map((x) => x.relname).join(", ")}`);
  });

  it("gives every table at least one policy, and every policy applies to signed-in users only", async () => {
    const noPolicy = await db.query(`
      select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
        and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)`);
    assert.deepEqual(noPolicy.rows, []);
    const wrongRole = await db.query(`select tablename, policyname, roles from pg_policies where schemaname = 'public' and roles <> '{authenticated}'`);
    assert.deepEqual(wrongRole.rows, []);
  });

  it("gives logged-out visitors (anon) no privileges on any table or view", async () => {
    const r = await db.query(`select table_name, privilege_type from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'`);
    assert.deepEqual(r.rows, []);
  });

  it("puts a required organization_id on every business table", async () => {
    const r = await db.query(`
      select c.relname from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
        and c.relname not in ('organizations', 'profiles')
        and not exists (select 1 from information_schema.columns k
                        where k.table_schema = 'public' and k.table_name = c.relname
                          and k.column_name = 'organization_id' and (k.is_nullable = 'NO' or c.relname = 'audit_logs'))`);
    assert.deepEqual(r.rows, []);
  });

  it("makes every view run with the reader's permissions (security_invoker)", async () => {
    const r = await db.query(`
      select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v'
        and not coalesce(reloptions @> array['security_invoker=true'], false)`);
    assert.deepEqual(r.rows, []);
  });

  it("pins search_path on every SECURITY DEFINER function", async () => {
    const r = await db.query(`
      select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    assert.deepEqual(r.rows, []);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("2 · Development seed matches the frontend demo data", () => {
  it("loads the same customers, leads, quotations, bookings and payments", async () => {
    const c = async (sql) => (await db.query(sql, [ORG])).rows[0].n;
    assert.equal(await c("select count(*)::int n from customers where organization_id = $1"), customers.length);
    assert.equal(await c("select count(*)::int n from leads where organization_id = $1"), leads.length);
    assert.equal(await c("select count(*)::int n from quotations where organization_id = $1"), quotations.length);
    assert.equal(await c("select count(*)::int n from bookings where organization_id = $1"), bookings.length);
    assert.equal(await c("select count(*)::int n from payments where organization_id = $1"), paymentsOf(bookings));
  });

  it("calculates booking totals, balances and supplier amounts like the frontend", async () => {
    const rows = await asUser(db, USERS.aisha.id, (q) => q("select code, total, paid, balance, supplier_paid, supplier_owed from booking_financials order by code"));
    assert.equal(rows.length, bookings.length);
    for (const b of bookings) {
      const r = rows.find((x) => x.code === b.id);
      assert.equal(Number(r.total), bookingTotal(b), `${b.id} total`);
    }
    const omar = rows.find((r) => r.code === "FV-10481");
    assert.deepEqual([omar.total, omar.paid, omar.balance, omar.supplier_paid, omar.supplier_owed].map(Number), [3150, 950, 2200, 1780, 990]);
    const live = rows.filter((r) => r.code !== "FV-10477").reduce((s, r) => s + Number(r.total), 0);
    assert.equal(live, 41020, "booked value shown on the Reports page");
  });

  it("keeps the customer profile figures (imported history + live bookings)", async () => {
    const rows = await asUser(db, USERS.aisha.id, (q) =>
      q("select c.code, s.trip_count, s.lifetime_value from customer_stats s join customers c on c.id = s.customer_id where c.code in ('CU-1001', 'CU-1013')"));
    for (const code of ["CU-1001", "CU-1013"]) {
      const mock = customers.find((c) => c.id === code);
      const r = rows.find((x) => x.code === code);
      assert.equal(r.trip_count, mock.trips, `${code} trips`);
      assert.equal(Number(r.lifetime_value), mock.lifetimeValue, `${code} lifetime value`);
    }
  });

  it("reproduces the frontend's receipt numbers and quotation totals", async () => {
    const receipts = (await db.query("select receipt_number from payments where booking_id = $1 order by sequence_no", [ids["FV-10479"]])).rows.map((r) => r.receipt_number);
    assert.deepEqual(receipts, ["RC-10479-1", "RC-10479-2"]);
    const total = await asUser(db, USERS.aisha.id, (q) => q("select total from quotation_totals where code = 'QT-3002'"));
    assert.equal(Number(total[0].total), 6390);
  });

  it("continues readable codes after the imported ones (CU-1025, LD-2062, QT-3009, FV-10484)", async () => {
    await asUser(db, USERS.aisha.id, async (q) => {
      const [c] = await q(`insert into customers (organization_id, first_name, last_name, phone, city, country) values ($1, 'New', 'Traveller', '+44 7700 900777', 'Leeds', 'United Kingdom') returning code, id`, [ORG]);
      assert.equal(c.code, "CU-1025");
      const [l] = await q(`insert into leads (organization_id, full_name, phone, destination) values ($1, 'New Lead', '+44 7700 900778', 'Rome') returning code`, [ORG]);
      assert.equal(l.code, "LD-2062");
      const [qt] = await q(`insert into quotations (organization_id, customer_id, recipient, title, destination, valid_until) values ($1, $2, '{"name":"New Traveller"}', 'Rome weekend', 'Rome', '2026-12-31') returning code`, [ORG, c.id]);
      assert.equal(qt.code, "QT-3009");
      const [b] = await q(`insert into bookings (organization_id, customer_id, title, destination, depart_on, deposit_due_on, balance_due_on) values ($1, $2, 'Rome weekend', 'Rome', '2027-01-10', '2026-11-27', '2026-12-10') returning code`, [ORG, c.id]);
      assert.equal(b.code, "FV-10484");
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("3 · Relationships & data integrity", () => {
  it("rejects records that point at something that doesn't exist", async () => {
    await asOwner(db, async (q) => {
      await q.fails(`insert into bookings (organization_id, customer_id, title, destination, depart_on, deposit_due_on, balance_due_on)
                     values ($1, gen_random_uuid(), 'X', 'Y', '2027-01-01', '2026-12-01', '2026-12-10')`, [ORG], /foreign key/);
    });
  });

  it("makes it impossible to link a record to ANOTHER agency's customer", async () => {
    await asOwner(db, async (q) => {
      await q.fails(`insert into bookings (organization_id, customer_id, title, destination, depart_on, deposit_due_on, balance_due_on)
                     values ($1, $2, 'X', 'Y', '2027-01-01', '2026-12-01', '2026-12-10')`, [ORG, ids.northwindCustomer], /foreign key/);
    });
  });

  it("requires a quotation to be for exactly one customer OR lead", async () => {
    await asOwner(db, async (q) => {
      await q.fails(`insert into quotations (organization_id, customer_id, lead_id, recipient, title, destination, valid_until)
                     values ($1, $2, $3, '{"name":"x"}', 'T', 'D', '2027-01-01')`, [ORG, ids["CU-1001"], ids["LD-2061"]], /check constraint/);
      await q.fails(`insert into quotations (organization_id, recipient, title, destination, valid_until)
                     values ($1, '{"name":"x"}', 'T', 'D', '2027-01-01')`, [ORG], /check constraint/);
    });
  });

  it("protects history: a customer with bookings can't be deleted; quotation items go with their quotation", async () => {
    await asOwner(db, async (q) => {
      await q.fails("delete from customers where id = $1", [ids["CU-1001"]], /foreign key/);
      const [qt] = await q("select id from quotations where code = 'QT-3008'");
      await q("delete from quotations where id = $1", [qt.id]);
      assert.equal(await count(q, "select 1 from quotation_items where quotation_id = $1", [qt.id]), 0);
    });
  });

  it("refuses duplicate customer phone numbers in the same agency (any spacing)", async () => {
    await asOwner(db, async (q) => {
      await q.fails(`insert into customers (organization_id, first_name, last_name, phone, city, country)
                     values ($1, 'Dup', 'Licate', '+447700900123', 'London', 'UK')`, [ORG], /duplicate key/);
    });
  });

  it("never lets a booking be paid more than its total", async () => {
    await asUser(db, USERS.fiona.id, async (q) => {
      await q.fails(`insert into payments (organization_id, booking_id, amount, method, received_on) values ($1, $2, 2200.01, 'Card', '2026-11-20')`,
        [ORG, ids["FV-10481"]], /exceeds the booking balance/);
      const [p] = await q(`insert into payments (organization_id, booking_id, amount, method, received_on) values ($1, $2, 2200, 'Card', '2026-11-20') returning receipt_number`, [ORG, ids["FV-10481"]]);
      assert.equal(p.receipt_number, "RC-10481-2");
    });
  });

  it("never lets refunds exceed the money received", async () => {
    await asUser(db, USERS.fiona.id, async (q) => {
      const [r] = await q(`insert into refunds (organization_id, booking_id, amount, method, status, approved_by, approved_at, paid_on)
                           values ($1, $2, 250, 'Bank transfer', 'Paid', $3, now(), '2026-11-20') returning reference_number`, [ORG, ids["FV-10477"], USERS.fiona.id]);
      assert.equal(r.reference_number, "RF-10477-1");
      await q.fails(`insert into refunds (organization_id, booking_id, amount, method) values ($1, $2, 51, 'Card')`, [ORG, ids["FV-10477"]], /exceed the amount received/);
    });
  });

  it("freezes issued invoices", async () => {
    await asUser(db, USERS.fiona.id, async (q) => {
      const [inv] = await q("select id from invoices where number = 'INV-2026-0001'");
      await q.fails("update invoice_lines set unit_price = 1 where invoice_id = $1", [inv.id], /issued invoice|permission denied/);
      await q.fails("update invoices set subtotal = 1 where id = $1", [inv.id], /Issued invoices cannot be changed/);
    });
  });

  it("never leaves the agency without an active admin", async () => {
    await asUser(db, USERS.aisha.id, async (q) => {
      await q.fails("update organization_members set role = 'sales_manager' where user_id = $1", [USERS.aisha.id], /at least one active admin/);
    });
  });

  it("only lets invited people in — there is no public sign-up", async () => {
    await asOwner(db, async (q) => {
      await q(`insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'new.agent@flyvera.test', '{"full_name":"New Agent"}')`);
      const invited = await q(`select m.role from organization_members m join auth.users u on u.id = m.user_id where u.email = 'new.agent@flyvera.test'`);
      assert.deepEqual(invited, [{ role: "sales_agent" }]);
      await q(`insert into auth.users (id, email) values (gen_random_uuid(), 'stranger@example.test')`);
      const stranger = await q(`select p.id, (select count(*)::int from organization_members m where m.user_id = p.id) as memberships
                                from profiles p join auth.users u on u.id = p.id where u.email = 'stranger@example.test'`);
      assert.equal(stranger.length, 1, "profile is created");
      assert.equal(stranger[0].memberships, 0, "but no access to any agency");
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("4 · Agency isolation & logged-out access", () => {
  it("keeps each agency's data invisible to the other", async () => {
    await asUser(db, USERS.nora.id, async (q) => {
      assert.equal(await count(q, "select 1 from customers"), 1);
      assert.equal(await count(q, "select 1 from bookings"), 0);
      assert.equal(await count(q, "select 1 from customers where organization_id = $1", [ORG]), 0);
    });
    await asUser(db, USERS.aisha.id, async (q) => {
      assert.equal(await count(q, "select 1 from customers"), customers.length);
      assert.equal(await count(q, "select 1 from customers where id = $1", [ids.northwindCustomer]), 0);
    });
  });

  it("stops an admin from writing into another agency", async () => {
    await asUser(db, USERS.aisha.id, async (q) => {
      await q.fails(`insert into customers (organization_id, first_name, last_name, phone, city, country)
                     values ($1, 'Sneaky', 'Insert', '+1 555 010 9999', 'X', 'Y')`, [OTHER_ORG], /row-level security/);
      const changed = await q("update customers set city = 'Hacked' where organization_id = $1 returning id", [OTHER_ORG]);
      assert.equal(N(changed), 0);
    });
  });

  it("blocks logged-out visitors from every table and function", async () => {
    for (const table of ["customers", "leads", "bookings", "payments", "passengers", "customer_travel_documents", "audit_logs", "booking_financials"]) {
      await asAnon(db, (q) => q.fails(`select * from ${table} limit 1`, [], /permission denied/));
    }
    await asAnon(db, (q) => q.fails("select public.reveal_customer_travel_document($1)", [ids.docAmelia], /permission denied/));
  });

  it("gives disabled team members no access at all", async () => {
    await asUser(db, USERS.tom.id, async (q) => {
      for (const t of ["customers", "leads", "bookings", "quotations", "organizations"]) assert.equal(await count(q, `select 1 from ${t}`), 0, t);
    });
  });

  it("lets nobody create an agency through the app", async () => {
    await asUser(db, USERS.aisha.id, (q) =>
      q.fails("insert into organizations (name, slug) values ('New Agency', 'new-agency')", [], /row-level security/));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("5 · Role: Admin", () => {
  it("sees everything in the agency", async () => {
    await asUser(db, USERS.aisha.id, async (q) => {
      assert.equal(await count(q, "select 1 from customers"), customers.length);
      assert.equal(await count(q, "select 1 from leads"), leads.length);
      assert.equal(await count(q, "select 1 from bookings"), bookings.length);
      assert.equal(await count(q, "select 1 from payments"), paymentsOf(bookings));
      assert.equal(await count(q, "select 1 from passengers"), 15);
      assert.equal(await count(q, "select 1 from customer_travel_documents"), 6);
      assert.equal(await count(q, "select 1 from money_ledger"), 23);
    });
  });

  it("can delete records and read the audit log", async () => {
    await asUser(db, USERS.aisha.id, async (q) => {
      // A lead that already has a quotation is protected …
      await q.fails("delete from leads where id = $1", [ids["LD-2050"]], /foreign key/);
      // … one without quotations can be removed, and the deletion is logged.
      const [marco] = await q("select id from leads where code = 'LD-2058'");
      assert.equal(N(await q("delete from leads where id = $1 returning id", [marco.id])), 1);
      const log = await q("select action, table_name, actor_id from audit_logs where record_id = $1", [marco.id]);
      assert.deepEqual(log, [{ action: "DELETE", table_name: "leads", actor_id: USERS.aisha.id }]);
    });
  });
});

describe("6 · Role: Sales Manager (Maya — manages Team Atlas: Sara & Daniel)", () => {
  const team = ["Sara K.", "Daniel R."];
  it("sees customers and leads of her team (and unassigned), not other teams'", async () => {
    await asUser(db, USERS.maya.id, async (q) => {
      assert.equal(await count(q, "select 1 from customers"), customersOf(...team).length);
      assert.equal(await count(q, "select 1 from leads"), leadsOf(...team).length);
      assert.equal(await count(q, "select 1 from customers where code = $1", [ids.somePriyaCustomer]), 0, "Priya (Team Horizon) is hidden");
    });
  });

  it("can edit her team's customers but not other teams'", async () => {
    await asUser(db, USERS.maya.id, async (q) => {
      assert.equal(N(await q("update customers set notes = 'Checked by manager' where code = $1 returning id", [ids.someDanielCustomer])), 1);
      assert.equal(N(await q("update customers set notes = 'x' where code = $1 returning id", [ids.somePriyaCustomer])), 0);
    });
  });

  it("sees her team's bookings, quotations and their payments — but can't record payments", async () => {
    await asUser(db, USERS.maya.id, async (q) => {
      const visible = bookingsVisibleTo(...team);
      assert.equal(await count(q, "select 1 from bookings"), visible.length);
      assert.equal(await count(q, "select 1 from quotations"), quotesVisibleTo(...team).length);
      assert.equal(await count(q, "select 1 from payments"), paymentsOf(visible));
      await q.fails(`insert into payments (organization_id, booking_id, amount, method, received_on) values ($1, $2, 10, 'Card', '2026-11-20')`,
        [ORG, ids["FV-10481"]], /row-level security/);
    });
  });

  it("sees the team's WhatsApp chats (incl. unassigned) and team AI actions", async () => {
    await asUser(db, USERS.maya.id, async (q) => {
      assert.equal(await count(q, "select 1 from whatsapp_conversations"), 3);
      assert.equal(await count(q, "select 1 from ai_actions"), 2);
    });
  });
});

describe("7 · Role: Sales Agent (Sara)", () => {
  it("sees ONLY her assigned customers and leads", async () => {
    await asUser(db, USERS.sara.id, async (q) => {
      assert.equal(await count(q, "select 1 from customers"), customersOf("Sara K.").length);
      assert.equal(await count(q, "select 1 from leads"), leadsOf("Sara K.").length);
      assert.equal(await count(q, "select 1 from customers where code = $1", [ids.someDanielCustomer]), 0);
    });
  });

  it("can't take over or create customers for colleagues", async () => {
    await asUser(db, USERS.sara.id, async (q) => {
      await q.fails(`insert into customers (organization_id, first_name, last_name, phone, city, country, assigned_to)
                     values ($1, 'A', 'B', '+1 555 010 1234', 'X', 'Y', $2)`, [ORG, USERS.daniel.id], /row-level security/);
      const mine = await q(`insert into customers (organization_id, first_name, last_name, phone, city, country, assigned_to)
                            values ($1, 'A', 'B', '+1 555 010 1234', 'X', 'Y', $2) returning id`, [ORG, USERS.sara.id]);
      assert.equal(N(mine), 1);
      await q.fails("update customers set assigned_to = $2 where id = $1", [mine[0].id, USERS.daniel.id], /row-level security/);
      assert.equal(N(await q("update customers set city = 'X' where code = $1 returning id", [ids.someDanielCustomer])), 0);
    });
  });

  it("sees only bookings, quotations, payments and passengers of her customers", async () => {
    await asUser(db, USERS.sara.id, async (q) => {
      const visible = bookingsVisibleTo("Sara K.");
      assert.equal(await count(q, "select 1 from bookings"), visible.length);
      assert.equal(await count(q, "select 1 from booking_financials"), visible.length);
      assert.equal(await count(q, "select 1 from quotations"), quotesVisibleTo("Sara K.").length);
      assert.equal(await count(q, "select 1 from payments"), paymentsOf(visible));
      assert.equal(await count(q, "select 1 from payments where booking_id = $1", [ids["FV-10481"]]), 0, "Daniel's booking");
      assert.equal(await count(q, "select 1 from tasks where assigned_to <> $1 and created_by <> $1", [USERS.sara.id]), 0);
    });
  });

  it("can request a refund, but only Finance can approve or pay it", async () => {
    await asUser(db, USERS.sara.id, async (q) => {
      const ok = await q(`insert into refunds (organization_id, booking_id, amount, method, reason) values ($1, $2, 100, 'Card', 'Customer request') returning status`, [ORG, ids["FV-10483"]]);
      assert.deepEqual(ok, [{ status: "Requested" }]);
      await q.fails(`insert into refunds (organization_id, booking_id, amount, method, status, approved_at, paid_on) values ($1, $2, 100, 'Card', 'Paid', now(), '2026-11-20')`,
        [ORG, ids["FV-10483"]], /row-level security/);
      await q.fails(`insert into refunds (organization_id, booking_id, amount, method) values ($1, $2, 100, 'Card')`, [ORG, ids["FV-10481"]], /row-level security/);
      await q.fails(`insert into payments (organization_id, booking_id, amount, method, received_on) values ($1, $2, 10, 'Card', '2026-11-20')`,
        [ORG, ids["FV-10483"]], /row-level security/);
    });
  });

  it("sees only her own WhatsApp chats and AI actions, and no audit log", async () => {
    await asUser(db, USERS.sara.id, async (q) => {
      assert.deepEqual((await q("select contact_name from whatsapp_conversations")).map((r) => r.contact_name), ["Fatima Al-Sayed"]);
      assert.equal(await count(q, "select 1 from ai_actions"), 2);
      assert.equal(await count(q, "select 1 from audit_logs"), 0);
    });
    await asUser(db, USERS.daniel.id, async (q) => assert.equal(await count(q, "select 1 from ai_actions"), 0));
  });
});

describe("8 · Role: Ticketing Agent (Leo)", () => {
  it("manages all bookings, passengers, PNRs and tickets", async () => {
    await asUser(db, USERS.leo.id, async (q) => {
      assert.equal(await count(q, "select 1 from bookings"), bookings.length);
      assert.equal(await count(q, "select 1 from passengers"), 15);
      assert.equal(await count(q, "select 1 from pnr_records"), 6);
      assert.equal(await count(q, "select 1 from tickets"), 8);
      const [pax] = await q("select id from passengers where booking_id = $1 and is_lead_passenger", [ids["FV-10481"]]);
      const [pnr] = await q("select id from pnr_records where booking_id = $1", [ids["FV-10481"]]);
      // Since migration 16, tickets are recorded through issue_ticket() only.
      const [{ id: ticketId }] = await q("select issue_ticket($1, $2, $3, '1762104810009', 'EK', 800, 180, now()) as id", [ids["FV-10481"], pax.id, pnr.id]);
      const t = await q("select total from tickets where id = $1", [ticketId]);
      assert.equal(Number(t[0].total), 980);
      assert.equal(N(await q("update booking_services set supplier_ref = 'ADD-55191' where booking_id = $1 and service_type = 'Hotel' returning id", [ids["FV-10481"]])), 1);
    });
  });

  it("sees only customers who have bookings, and no leads or WhatsApp", async () => {
    await asUser(db, USERS.leo.id, async (q) => {
      assert.equal(await count(q, "select 1 from customers"), customersWithBookings.size);
      assert.equal(await count(q, "select 1 from customers where id = $1", [ids["CU-1022"]]), 0, "customer without bookings");
      assert.equal(await count(q, "select 1 from leads"), 0);
      assert.equal(await count(q, "select 1 from whatsapp_conversations"), 0);
    });
  });

  it("can read payments (to check before ticketing) but can't record money", async () => {
    await asUser(db, USERS.leo.id, async (q) => {
      assert.equal(await count(q, "select 1 from payments"), paymentsOf(bookings));
      await q.fails(`insert into payments (organization_id, booking_id, amount, method, received_on) values ($1, $2, 10, 'Card', '2026-11-20')`,
        [ORG, ids["FV-10481"]], /row-level security/);
      await q.fails(`insert into supplier_transactions (organization_id, booking_id, amount, occurred_on) values ($1, $2, 10, '2026-11-20')`,
        [ORG, ids["FV-10481"]], /row-level security/);
      assert.equal(N(await q("update quotations set title = 'x' returning id")), 0, "quotations are read-only for ticketing");
    });
  });
});

describe("9 · Role: Finance Manager (Fiona)", () => {
  it("manages payments, refunds, invoices and supplier payments", async () => {
    await asUser(db, USERS.fiona.id, async (q) => {
      assert.equal(await count(q, "select 1 from payments"), paymentsOf(bookings));
      assert.equal(await count(q, "select 1 from invoices"), 3);
      assert.equal(await count(q, "select 1 from money_ledger"), 23);
      const st = await q(`insert into supplier_transactions (organization_id, booking_id, amount, occurred_on, kind) values ($1, $2, 890, '2026-11-20', 'Payment') returning id`,
        [ORG, ids["FV-10481"]]);
      assert.equal(N(st), 1);
      const [ref] = await q(`insert into refunds (organization_id, booking_id, amount, method) values ($1, $2, 100, 'Card') returning id`, [ORG, ids["FV-10477"]]);
      const approved = await q("update refunds set status = 'Approved', approved_by = $2, approved_at = now() where id = $1 returning status", [ref.id, USERS.fiona.id]);
      assert.deepEqual(approved, [{ status: "Approved" }]);
    });
  });

  it("sees booked customers for billing but no leads, passengers or passports", async () => {
    await asUser(db, USERS.fiona.id, async (q) => {
      assert.equal(await count(q, "select 1 from customers"), customersWithBookings.size);
      assert.equal(await count(q, "select 1 from leads"), 0);
      assert.equal(await count(q, "select 1 from passengers"), 0);
      assert.equal(await count(q, "select 1 from customer_travel_documents"), 0);
      await q.fails("select public.reveal_customer_travel_document($1)", [ids.docAmelia], /do not have access/);
    });
  });

  it("can update bookings (refund decisions) but not create them", async () => {
    await asUser(db, USERS.fiona.id, async (q) => {
      assert.equal(N(await q("update bookings set refund_decision = 'Kept as fee' where id = $1 returning id", [ids["FV-10477"]])), 1);
      await q.fails(`insert into bookings (organization_id, customer_id, title, destination, depart_on, deposit_due_on, balance_due_on)
                     values ($1, $2, 'X', 'Y', '2027-01-01', '2026-12-01', '2026-12-10')`, [ORG, ids["CU-1001"]], /row-level security/);
    });
  });
});

describe("10 · Role: Support Agent (Sam)", () => {
  it("sees every customer profile, all leads (read-only) and all conversations", async () => {
    await asUser(db, USERS.sam.id, async (q) => {
      assert.equal(await count(q, "select 1 from customers"), customers.length);
      assert.equal(await count(q, "select 1 from leads"), leads.length);
      assert.equal(await count(q, "select 1 from whatsapp_conversations"), 3);
      assert.equal(await count(q, "select 1 from whatsapp_messages"), 6);
      assert.equal(N(await q("update leads set notes = 'x' returning id")), 0, "leads are read-only");
    });
  });

  it("can update customer details and reply on WhatsApp, but not re-assign customers", async () => {
    await asUser(db, USERS.sam.id, async (q) => {
      assert.equal(N(await q("update customers set city = 'Brighton' where id = $1 returning id", [ids["CU-1001"]])), 1);
      await q.fails("update customers set assigned_to = $2 where id = $1", [ids["CU-1001"], USERS.daniel.id], /cannot re-assign/);
      const [conv] = await q("select id from whatsapp_conversations where contact_name = 'Unknown contact'");
      const sent = await q(`insert into whatsapp_messages (organization_id, conversation_id, direction, body, status, sent_by)
                            values ($1, $2, 'Outbound', 'Yes! Which dates are you considering?', 'Queued', $3) returning id`, [ORG, conv.id, USERS.sam.id]);
      assert.equal(N(sent), 1);
    });
  });

  it("gets NO money, passport, passenger or ticket data", async () => {
    await asUser(db, USERS.sam.id, async (q) => {
      for (const t of ["payments", "refunds", "invoices", "invoice_lines", "supplier_transactions", "booking_services", "booking_financials",
        "customer_stats", "money_ledger", "quotations", "quotation_items", "quotation_totals", "customer_travel_documents", "passengers", "tickets", "suppliers"]) {
        assert.equal(await count(q, `select 1 from ${t}`), 0, `${t} should be hidden from support`);
      }
      await q.fails("select public.reveal_customer_travel_document($1)", [ids.docAmelia], /do not have access/);
      await q.fails("select public.reveal_passenger_document($1)", [ids.paxRahul], /do not have access/);
    });
  });

  it("can still see bookings, PNRs and flight times to answer customer questions", async () => {
    await asUser(db, USERS.sam.id, async (q) => {
      assert.equal(await count(q, "select 1 from bookings"), bookings.length);
      assert.equal(await count(q, "select 1 from pnr_records"), 6);
      assert.equal(await count(q, "select 1 from booking_segments"), 12);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("11 · Passport & passenger data protection", () => {
  it("stores passport numbers encrypted (the plain number is nowhere in the table)", async () => {
    const r = await db.query("select encode(document_number_encrypted, 'escape') as stored, number_last4 from customer_travel_documents where id = $1", [ids.docAmelia]);
    assert.ok(!r.rows[0].stored.includes("548213907"));
    assert.equal(r.rows[0].number_last4, "3907");
  });

  it("blocks direct reads of the encrypted column for EVERY role (even admin)", async () => {
    for (const u of [USERS.aisha, USERS.maya, USERS.sara, USERS.leo, USERS.fiona, USERS.sam]) {
      await asUser(db, u.id, (q) => q.fails("select document_number_encrypted from customer_travel_documents", [], /permission denied/));
      await asUser(db, u.id, (q) => q.fails("select document_number_encrypted from passengers", [], /permission denied/));
    }
    await asUser(db, USERS.aisha.id, (q) =>
      q.fails("update passengers set document_number_encrypted = '\\x00' where id = $1", [ids.paxRahul], /permission denied/));
  });

  it("reveals full numbers only to allowed roles — and logs every reveal", async () => {
    await asUser(db, USERS.aisha.id, async (q) => {
      const [r] = await q("select public.reveal_customer_travel_document($1) as n", [ids.docAmelia]);
      assert.equal(r.n, "548213907");
      const log = await q("select action, actor_id from audit_logs where action = 'REVEAL' and record_id = $1", [ids.docAmelia]);
      assert.deepEqual(log, [{ action: "REVEAL", actor_id: USERS.aisha.id }]);
    });
    await asUser(db, USERS.sara.id, async (q) => {
      assert.equal((await q("select public.reveal_customer_travel_document($1) as n", [ids.docAmelia]))[0].n, "548213907", "her own customer");
      await q.fails("select public.reveal_customer_travel_document($1)", [ids.docDaniels], /do not have access/);
    });
    await asUser(db, USERS.leo.id, async (q) => {
      assert.equal((await q("select public.reveal_passenger_document($1) as n", [ids.paxRahul]))[0].n, "Z7782210");
      await q.fails("select public.reveal_customer_travel_document($1)", [ids.docPriyas], /do not have access/);
    });
  });

  it("saves new passports encrypted through the protected function", async () => {
    await asUser(db, USERS.sara.id, async (q) => {
      const [{ id }] = await q("select public.save_customer_travel_document($1, 'ab 123 456 7', '2032-05-01', 'United Arab Emirates') as id", [ids["CU-1007"]]);
      const [doc] = await q("select number_last4, document_type from customer_travel_documents where id = $1", [id]);
      assert.deepEqual(doc, { number_last4: "4567", document_type: "Passport" });
      assert.equal((await q("select public.reveal_customer_travel_document($1) as n", [id]))[0].n, "AB1234567");
      await q.fails("select public.save_customer_travel_document($1, 'x', '2032-05-01', 'UAE')", [ids["CU-1007"]], /5–20 letters or digits/);
      await q.fails("select public.save_customer_travel_document($1, 'AB1234567', '2032-05-01', 'UAE')", [ids["CU-1005"]], /do not have access/);
    });
  });

  it("redacts dates of birth in the audit log and nobody can edit or delete the log", async () => {
    await asUser(db, USERS.aisha.id, async (q) => {
      await q("update customers set date_of_birth = '1984-06-13' where id = $1", [ids["CU-1001"]]);
      const [log] = await q("select changed_fields, new_data ->> 'date_of_birth' as dob from audit_logs where table_name = 'customers' and record_id = $1", [ids["CU-1001"]]);
      assert.deepEqual(log, { changed_fields: ["date_of_birth"], dob: "[redacted]" });
      await q.fails("delete from audit_logs", [], /permission denied/);
      await q.fails("update audit_logs set action = 'INSERT'", [], /permission denied/);
    });
    await asUser(db, USERS.maya.id, async (q) => assert.equal(await count(q, "select 1 from audit_logs"), 0, "managers can't read the audit log"));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("12 · Private file storage", () => {
  it("lets ticketing upload e-tickets for real bookings only", async () => {
    await asUser(db, USERS.leo.id, async (q) => {
      const ok = await q("insert into storage.objects (bucket_id, name) values ('ticket-documents', $1) returning id", [`${ORG}/${ids["FV-10481"]}/e-ticket.pdf`]);
      assert.equal(N(ok), 1);
      await q.fails("insert into storage.objects (bucket_id, name) values ('ticket-documents', $1)", [`${ORG}/${ids.northwindCustomer}/x.pdf`], /row-level security/);
      await q.fails("insert into storage.objects (bucket_id, name) values ('ticket-documents', $1)", [`${OTHER_ORG}/${ids["FV-10481"]}/x.pdf`], /row-level security/);
    });
    await asUser(db, USERS.sam.id, (q) =>
      q.fails("insert into storage.objects (bucket_id, name) values ('ticket-documents', $1)", [`${ORG}/${ids["FV-10481"]}/x.pdf`], /row-level security/));
  });

  it("keeps passport scans to people allowed to see that customer's documents", async () => {
    await asUser(db, USERS.sara.id, async (q) => {
      assert.equal(N(await q("insert into storage.objects (bucket_id, name) values ('travel-documents', $1) returning id", [`${ORG}/${ids["CU-1001"]}/passport.pdf`])), 1);
      await q.fails("insert into storage.objects (bucket_id, name) values ('travel-documents', $1)", [`${ORG}/${ids["CU-1005"]}/passport.pdf`], /row-level security/);
    });
  });

  it("hides one agency's files from another", async () => {
    await asOwner(db, async (q) => {
      await q("insert into storage.objects (bucket_id, name) values ('ticket-documents', $1)", [`${ORG}/${ids["FV-10481"]}/secret.pdf`]);
      await q("set local role authenticated");
      await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: USERS.nora.id })]);
      assert.equal(await count(q, "select 1 from storage.objects where name like '%secret.pdf'"), 0);
      await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: USERS.leo.id })]);
      assert.equal(await count(q, "select 1 from storage.objects where name like '%secret.pdf'"), 1);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("13 · Integrity hardening (migration 14)", () => {
  it("never lets anyone change who created a task or flight search", async () => {
    await asUser(db, USERS.sara.id, async (q) => {
      const [task] = await q("insert into tasks (organization_id, title) values ($1, 'Call back') returning id, created_by", [ORG]);
      assert.equal(task.created_by, USERS.sara.id);
      assert.equal(N(await q("update tasks set title = 'Call back today' where id = $1 returning id", [task.id])), 1);
      await q.fails("update tasks set created_by = $2 where id = $1", [task.id, USERS.maya.id], /created_by cannot be changed/);
      const [search] = await q("insert into flight_searches (organization_id, origin, destination, depart_on) values ($1, 'DXB', 'LHR', current_date + 30) returning id", [ORG]);
      await q.fails("update flight_searches set created_by = $2 where id = $1", [search.id, USERS.maya.id], /created_by cannot be changed/);
    });
  });

  it("records the real reviewer of an AI action, whatever the client sends", async () => {
    await asUser(db, USERS.sara.id, async (q) => {
      const [proposed] = await q(
        "insert into ai_actions (organization_id, action_kind, reviewed_by, reviewed_at) values ($1, 'Draft reply', $2, now()) returning id, reviewed_by, reviewed_at",
        [ORG, USERS.aisha.id]);
      assert.equal(proposed.reviewed_by, null);
      assert.equal(proposed.reviewed_at, null);

      const [approved] = await q("update ai_actions set status = 'Approved', reviewed_by = $2 where id = $1 returning reviewed_by, reviewed_at", [proposed.id, USERS.aisha.id]);
      assert.equal(approved.reviewed_by, USERS.sara.id);
      assert.ok(approved.reviewed_at);

      const [edited] = await q("update ai_actions set reviewed_by = $2 where id = $1 returning reviewed_by", [proposed.id, USERS.aisha.id]);
      assert.equal(edited.reviewed_by, USERS.sara.id);

      const [decided] = await q("insert into ai_actions (organization_id, action_kind, status, reviewed_by) values ($1, 'Summary', 'Rejected', $2) returning reviewed_by", [ORG, USERS.aisha.id]);
      assert.equal(decided.reviewed_by, USERS.sara.id);

      await q.fails("update ai_actions set requested_by = $2 where id = $1", [proposed.id, USERS.maya.id], /requested_by cannot be changed/);
    });
  });

  it("records the real verifier of a travel document", async () => {
    await asUser(db, USERS.aisha.id, async (q) => {
      const [doc] = await q(
        "update customer_travel_documents set verified_by = $2, verified_at = '2000-01-01' where id = $1 returning verified_by, verified_at",
        [ids.docAmelia, USERS.sara.id]);
      assert.equal(doc.verified_by, USERS.aisha.id);
      assert.ok(new Date(doc.verified_at).getFullYear() > 2000);
      const [backdated] = await q("update customer_travel_documents set verified_at = '2000-01-01' where id = $1 returning verified_at", [ids.docAmelia]);
      assert.ok(new Date(backdated.verified_at).getFullYear() > 2000);
      const [cleared] = await q("update customer_travel_documents set verified_by = null where id = $1 returning verified_by, verified_at", [ids.docAmelia]);
      assert.equal(cleared.verified_by, null);
      assert.equal(cleared.verified_at, null);
    });
  });

  it("hides archived customers, leads and quotations from everyone but admins", async () => {
    const cust = ids["CU-1001"]; // assigned to Sara
    await asUser(db, USERS.sara.id, async (q) => {
      await q.fails("update customers set deleted_at = now() where id = $1", [cust], /row-level security/);
      await q.fails("select archive_customer($1)", [ids["CU-1005"]], /cannot archive this customer/); // Daniel's
      await q("select archive_customer($1)", [cust]);
      assert.equal(await count(q, "select 1 from customers where id = $1", [cust]), 0);
      assert.equal(N(await q("update customers set notes = 'x' where id = $1 returning id", [cust])), 0);
      assert.equal(N(await q("update customers set notes = 'x' where code = 'CU-1001' returning id")), 0);
      assert.equal(await count(q, "select 1 from audit_logs"), 0); // still no audit access…
    });
    await asOwner(db, async (q) => {
      await q("set local role authenticated");
      await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: USERS.sara.id })]);
      await q("select archive_customer($1)", [cust]);
      await q("reset role");
      const [log] = await q("select actor_id, changed_fields from audit_logs where table_name = 'customers' and record_id = $1 order by id desc limit 1", [cust]);
      assert.equal(log.actor_id, USERS.sara.id); // …but the archive is logged under her name
      assert.deepEqual(log.changed_fields, ["deleted_at"]);
    });
    await asUser(db, USERS.aisha.id, async (q) => {
      await q("update customers set deleted_at = now() where id = $1", [cust]);
      assert.equal(await count(q, "select 1 from customers where id = $1", [cust]), 1);
      assert.equal(N(await q("update customers set deleted_at = null where id = $1 returning id", [cust])), 1);
    });
    await asUser(db, USERS.maya.id, async (q) => {
      const leadsBefore = await count(q, "select 1 from leads");
      await q("select archive_lead(id) from leads where code = 'LD-2050'");
      assert.equal(await count(q, "select 1 from leads"), leadsBefore - 1);
      const quotesBefore = await count(q, "select 1 from quotations");
      await q("select archive_quotation(id) from (select id from quotations limit 1) x");
      assert.equal(await count(q, "select 1 from quotations"), quotesBefore - 1);
    });
    await asUser(db, USERS.sam.id, (q) =>
      q.fails("select archive_lead(id) from leads where code = 'LD-2050'", [], /cannot archive this lead/));
  });

  it("filters quotation_totals by role like the other money views", async () => {
    await asUser(db, USERS.sam.id, async (q) => assert.equal(await count(q, "select 1 from quotation_totals"), 0));
    await asUser(db, USERS.aisha.id, async (q) => assert.equal(await count(q, "select 1 from quotation_totals"), quotations.length));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("14 · Booking creation & payment corrections (migration 15)", () => {
  const BOOK = "select create_booking_from_quotation($1, $2, current_date + 60, current_date + 67, current_date + 7, current_date + 30) as id";

  /** An accepted quotation for Sara's customer CU-1001, created inside the current (rolled-back) transaction. */
  async function acceptedQuote(q, withItems = true) {
    const [quote] = await q(
      `insert into quotations (organization_id, customer_id, recipient, title, destination, valid_until, status, prepared_by, sent_at, responded_at)
       values ($1, $2, '{"name":"Amelia Hart"}', 'Lisbon weekend', 'Lisbon', current_date + 14, 'Accepted', $3, now(), now()) returning id`,
      [ORG, ids["CU-1001"], USERS.sara.id]);
    if (withItems) {
      await q(
        `insert into quotation_items (organization_id, quotation_id, position, item_type, description, quantity, unit_price, cost)
         values ($1, $2, 0, 'Flight', 'Return flights', 2, 400, 600), ($1, $2, 1, 'Hotel', '3 nights', 1, 500, 380)`,
        [ORG, quote.id]);
    }
    return quote.id;
  }

  it("creates a booking with its services and first timeline entry in one step", async () => {
    await asUser(db, USERS.sara.id, async (q) => {
      const quoteId = await acceptedQuote(q);
      const [{ id }] = await q(BOOK, [quoteId, ids["CU-1001"]]);
      const [b] = await q("select code, status, quotation_id, agent_id from bookings where id = $1", [id]);
      assert.match(b.code, /^FV-\d+$/);
      assert.equal(b.status, "Pending");
      assert.equal(b.agent_id, USERS.sara.id);
      assert.equal(await count(q, "select 1 from booking_services where booking_id = $1", [id]), 2);
      const [f] = await q("select total, balance from booking_financials where booking_id = $1", [id]);
      assert.equal(Number(f.total), 1300);
      assert.equal(Number(f.balance), 1300);
      const [e] = await q("select body from booking_events where booking_id = $1", [id]);
      assert.match(e.body, /^Booking created from QT-\d+/);
      await q.fails(BOOK, [quoteId, ids["CU-1001"]], /bookings_quotation_uidx|duplicate key/); // one booking per quotation
    });
  });

  it("leaves nothing behind when a booking can't be completed", async () => {
    await asUser(db, USERS.sara.id, async (q) => {
      const empty = await acceptedQuote(q, false);
      await q.fails(BOOK, [empty, ids["CU-1001"]], /no items to book/);
      assert.equal(await count(q, "select 1 from bookings where quotation_id = $1", [empty]), 0);

      const [draft] = await q(
        `insert into quotations (organization_id, customer_id, recipient, title, destination, valid_until, prepared_by)
         values ($1, $2, '{"name":"Amelia Hart"}', 'Draft trip', 'Rome', current_date + 14, $3) returning id`,
        [ORG, ids["CU-1001"], USERS.sara.id]);
      await q.fails(BOOK, [draft.id, ids["CU-1001"]], /Only accepted quotations/);
      await q.fails(BOOK, [await acceptedQuote(q), ids["CU-1005"]], /different customer/);
    });
  });

  it("follows the booking permissions (finance can't create bookings)", async () => {
    await asOwner(db, async (q) => {
      const quoteId = await acceptedQuote(q);
      await q("set local role authenticated");
      await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: USERS.fiona.id })]);
      await q.fails(BOOK, [quoteId, ids["CU-1001"]], /row-level security/);
    });
  });

  it("lets finance correct a payment only with a reason, and logs before/after + reason", async () => {
    await asOwner(db, async (q) => {
      const [p] = await q(
        "select id, amount, received_on, method, reference, note, receipt_number, booking_id from payments where organization_id = $1 order by received_on desc limit 1",
        [ORG]);
      const newAmount = Number(p.amount) - 1;
      await q("set local role authenticated");
      await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: USERS.fiona.id })]);
      // Keeps the payment's reference and note, so only the listed fields change.
      const correct = "select correct_payment($1, $2, $3, $4, $6, $7, $5)";
      const keep = [p.reference, p.note];

      await q.fails(correct, [p.id, newAmount, p.received_on, p.method, "", ...keep], /reason/);
      await q.fails(correct, [p.id, p.amount, p.received_on, p.method, "No real change", ...keep], /Nothing was changed/);
      await q.fails(correct, [p.id, 99_999_999, p.received_on, p.method, "Typo in amount", ...keep], /exceeds the booking balance/);
      await q.fails("update payments set amount = 1 where id = $1", [p.id], /permission denied/);

      await q(correct, [p.id, newAmount, p.received_on, p.method, "Bank fee deducted", ...keep]);
      const [after] = await q("select amount, receipt_number from payments where id = $1", [p.id]);
      assert.equal(Number(after.amount), newAmount);
      assert.equal(after.receipt_number, p.receipt_number); // receipt number can't change
      const [event] = await q("select body from booking_events where booking_id = $1 order by created_at desc limit 1", [p.booking_id]);
      assert.ok(event.body.startsWith(`Payment ${p.receipt_number} corrected (amount ${Number(p.amount).toFixed(2)} → ${newAmount.toFixed(2)})`), event.body);
      assert.ok(event.body.endsWith("— reason: Bank fee deducted"), event.body);

      await q("reset role");
      const [log] = await q(
        "select actor_id, changed_fields, old_data->>'amount' old_amount, new_data->>'amount' new_amount, context->>'reason' reason from audit_logs where table_name = 'payments' and record_id = $1 order by id desc limit 1",
        [p.id]);
      assert.equal(log.actor_id, USERS.fiona.id);
      assert.deepEqual(log.changed_fields, ["amount"]);
      assert.equal(Number(log.old_amount), Number(p.amount));
      assert.equal(Number(log.new_amount), newAmount);
      assert.equal(log.reason, "Bank fee deducted");
    });
  });

  it("refuses payment corrections from anyone outside Finance and admins", async () => {
    const [p] = (await db.query("select id, amount, received_on, method from payments where organization_id = $1 limit 1", [ORG])).rows;
    for (const user of [USERS.sara, USERS.leo, USERS.sam, USERS.nora]) {
      await asUser(db, user.id, (q) =>
        q.fails("select correct_payment($1, $2, $3, $4, null, null, 'Trying to edit')", [p.id, Number(p.amount) - 1, p.received_on, p.method], /Only Finance or an admin/));
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("15 · Ticketing integrity (migration 16)", () => {
  const ISSUE = "select issue_ticket($1, $2, $3, $4, 'EK', 800, 180, now()) as id";
  const lookup = async (q, code) => {
    const [b] = await q("select id from bookings where code = $1 and organization_id = $2", [code, ORG]);
    const [pax] = await q("select id from passengers where booking_id = $1 order by is_lead_passenger desc limit 1", [b.id]);
    const [pnr] = await q("select id from pnr_records where booking_id = $1 limit 1", [b.id]);
    return { booking: b.id, pax: pax?.id, pnr: pnr?.id };
  };
  const asLeoViaOwner = async (q) => {
    await q("set local role authenticated");
    await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: USERS.leo.id })]);
  };

  it("records an issued ticket with an audit entry and a timeline line", async () => {
    await asOwner(db, async (q) => {
      const x = await lookup(q, "FV-10481");
      await asLeoViaOwner(q);
      const [{ id }] = await q(ISSUE, [x.booking, x.pax, x.pnr, "176 2104810 077"]); // spaces are tidied
      const [t] = await q("select ticket_number, status, issued_by from tickets where id = $1", [id]);
      assert.deepEqual(t, { ticket_number: "1762104810077", status: "Issued", issued_by: USERS.leo.id });
      const [e] = await q("select body from booking_events where booking_id = $1 order by created_at desc limit 1", [x.booking]);
      assert.match(e.body, /^Ticket 1762104810077 issued by EK for .+ \(USD 980\.00\)$/);
      await q("reset role");
      const [log] = await q("select action, actor_id from audit_logs where table_name = 'tickets' and record_id = $1", [id]);
      assert.deepEqual(log, { action: "INSERT", actor_id: USERS.leo.id });
    });
  });

  it("never records a ticket without the real issuance details", async () => {
    await asUser(db, USERS.leo.id, async (q) => {
      const ok = await lookup(q, "FV-10481");
      await q.fails(ISSUE, [ok.booking, ok.pax, ok.pnr, "12345"], /13-digit ticket number/);
      await q.fails(ISSUE, [ok.booking, ok.pax, null, "1762104810078"], /airline reservation \(PNR\)/);
      // A booking that isn't confirmed yet (Pending) can't have tickets.
      const [pending] = await q("select id from bookings where code = 'FV-10480' and organization_id = $1", [ORG]);
      const [pax] = await q(
        "insert into passengers (organization_id, booking_id, first_name, last_name) values ($1, $2, 'Test', 'Traveller') returning id",
        [ORG, pending.id]);
      const [pnr] = await q("insert into pnr_records (organization_id, booking_id, record_locator) values ($1, $2, 'PEND01') returning id", [ORG, pending.id]);
      await q.fails(ISSUE, [pending.id, pax.id, pnr.id, "1762104810079"], /confirmed booking/);
      await q("update pnr_records set status = 'Cancelled' where id = $1", [ok.pnr]);
      await q.fails(ISSUE, [ok.booking, ok.pax, ok.pnr, "1762104810080"], /active reservation/);
    });
  });

  it("keeps every ticket link inside its own booking", async () => {
    await asUser(db, USERS.leo.id, async (q) => {
      const a = await lookup(q, "FV-10481");
      const other = await lookup(q, "FV-10479");
      await q.fails(ISSUE, [a.booking, other.pax, a.pnr, "1762104810081"], /passenger isn't on this booking/);
      await q.fails(ISSUE, [a.booking, a.pax, other.pnr, "1762104810082"], /PNR isn't on this booking/);
      await q.fails(
        `insert into booking_segments (organization_id, booking_id, pnr_id, segment_no, marketing_carrier, flight_number, origin, destination, departs_at, arrives_at)
         values ($1, $2, $3, 99, 'EK', '1', 'DXB', 'LHR', now() + interval '10 days', now() + interval '10 days 7 hours')`,
        [ORG, a.booking, other.pnr], /PNR isn't on this booking/);
      const [otherTicket] = await q("select id from tickets where booking_id = $1 limit 1", [other.booking]);
      await q.fails(
        `insert into ticket_documents (organization_id, booking_id, ticket_id, document_kind, storage_path, file_name, mime_type, size_bytes)
         values ($1, $2, $3, 'E-ticket', $4, 'x.pdf', 'application/pdf', 100)`,
        [ORG, a.booking, otherTicket.id, `${ORG}/${a.booking}/x.pdf`], /ticket isn't on this booking/);
    });
  });

  it("only moves a ticket forward, with a reason that is logged", async () => {
    await asOwner(db, async (q) => {
      const [t] = await q("select id, booking_id, ticket_number from tickets where status = 'Issued' and organization_id = $1 limit 1", [ORG]);
      await asLeoViaOwner(q);
      const change = "select change_ticket_status($1, $2, $3)";
      await q.fails(change, [t.id, "Voided", ""], /reason/);
      await q.fails(change, [t.id, "Issued", "Trying to re-issue"], /voided, refunded or exchanged/);
      await q(change, [t.id, "Voided", "Wrong passenger name on ticket"]);
      const [after] = await q("select status, voided_at from tickets where id = $1", [t.id]);
      assert.equal(after.status, "Voided");
      assert.ok(after.voided_at);
      await q.fails(change, [t.id, "Refunded", "Changing my mind"], /voided ticket can't change status again/);
      const [e] = await q("select body from booking_events where booking_id = $1 order by created_at desc limit 1", [t.booking_id]);
      assert.equal(e.body, `Ticket ${t.ticket_number} voided — reason: Wrong passenger name on ticket`);
      await q("reset role");
      const [log] = await q(
        "select changed_fields, old_data->>'status' old_status, new_data->>'status' new_status, context->>'reason' reason from audit_logs where table_name = 'tickets' and record_id = $1 order by id desc limit 1",
        [t.id]);
      assert.deepEqual(log.changed_fields, ["status", "voided_at"]);
      assert.equal(log.old_status, "Issued");
      assert.equal(log.new_status, "Voided");
      assert.equal(log.reason, "Wrong passenger name on ticket");
    });
  });

  it("blocks direct edits and deletes of tickets, and other roles from ticketing", async () => {
    const [t] = (await db.query("select id, booking_id, passenger_id, pnr_id from tickets where status = 'Issued' and organization_id = $1 limit 1", [ORG])).rows;
    await asUser(db, USERS.leo.id, async (q) => {
      await q.fails("update tickets set base_fare = 1 where id = $1", [t.id], /permission denied/);
      await q.fails("delete from tickets where id = $1", [t.id], /permission denied/);
      await q.fails(
        "insert into tickets (organization_id, booking_id, passenger_id, pnr_id, ticket_number, issuing_airline, base_fare) values ($1, $2, $3, $4, '1762104810090', 'EK', 1)",
        [ORG, t.booking_id, t.passenger_id, t.pnr_id], /permission denied/);
    });
    await asUser(db, USERS.aisha.id, (q) => q.fails("delete from tickets where id = $1", [t.id], /permission denied/));
    for (const user of [USERS.sara, USERS.fiona, USERS.sam, USERS.nora]) {
      await asUser(db, user.id, async (q) => {
        await q.fails("select issue_ticket($1, $2, $3, '1762104810091', 'EK', 1, 0, now())", [t.booking_id, t.passenger_id, t.pnr_id], /Only Ticketing or an admin/);
        await q.fails("select change_ticket_status($1, 'Voided', 'Not allowed here')", [t.id], /Only Ticketing or an admin/);
      });
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("16 · Invoices (migration 17)", () => {
  /** A booking that isn't cancelled, has payments and has no invoice yet. */
  const UNINVOICED =
    "select b.id from bookings b where b.organization_id = $1 and b.status <> 'Cancelled' " +
    "and exists (select 1 from payments p where p.booking_id = b.id) " +
    "and not exists (select 1 from invoices i where i.booking_id = b.id) order by b.code limit 1";
  const bookingId = async (q) => (await q(UNINVOICED, [ORG]))[0].id;
  const asFiona = async (q) => {
    await q("set local role authenticated");
    await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: USERS.fiona.id })]);
  };

  it("creates an unnumbered draft that mirrors the booking, with an optional service fee", async () => {
    await asOwner(db, async (q) => {
      const b = await bookingId(q);
      await asFiona(q);
      const [before] = await q("select total from booking_financials where booking_id = $1", [b]);
      const [{ id }] = await q("select create_invoice($1, 50, current_date + 14, 'Thank you!') as id", [b]);
      const [inv] = await q("select number, status, subtotal, total, notes from invoices where id = $1", [id]);
      assert.equal(inv.number, null);
      assert.equal(inv.status, "Draft");
      assert.equal(inv.notes, "Thank you!");
      // The fee became a booking service, so booking and invoice totals match.
      const [after] = await q("select total from booking_financials where booking_id = $1", [b]);
      assert.equal(Number(after.total), Number(before.total) + 50);
      assert.equal(Number(inv.total), Number(after.total));
      const [fee] = await q("select item_type, unit_price from invoice_lines where invoice_id = $1 and item_type = 'Service fee'", [id]);
      assert.equal(Number(fee.unit_price), 50);
      await q.fails("select create_invoice($1, 0, null, null)", [b], /already has an invoice/);
    });
  });

  it("numbers an invoice only when it's issued, freezes it, snapshots the customer and links payments", async () => {
    await asOwner(db, async (q) => {
      const b = await bookingId(q);
      await asFiona(q);
      const [{ id }] = await q("select create_invoice($1, 0, null, null) as id", [b]);
      await q.fails("update invoices set status = 'Issued' where id = $1", [id], /Use Issue or Void/);
      await q.fails("update invoices set discount = 1 where id = $1", [id], /Draft amounts come from the booking/);
      await q.fails("insert into invoice_lines (organization_id, invoice_id, description, quantity, unit_price) values ($1, $2, 'x', 1, 1)", [ORG, id], /permission denied/);
      assert.equal(N(await q("update invoices set notes = 'Pay by bank transfer' where id = $1 returning id", [id])), 1);

      const [{ number }] = await q("select issue_invoice($1, current_date, current_date + 10) as number", [id]);
      // The seed's three invoices already used 0001–0003 for 2026; the year follows the issue date.
      assert.match(number, /^INV-\d{4}-\d{4}$/);
      const [inv] = await q("select status, number, bill_to, passengers, issued_by from invoices where id = $1", [id]);
      assert.equal(inv.status, "Issued");
      assert.equal(inv.issued_by, USERS.fiona.id);
      assert.ok(inv.bill_to.name && inv.bill_to.code);
      assert.ok(Array.isArray(inv.passengers) && inv.passengers.length > 0);
      const [{ linked, all }] = await q(
        "select count(*) filter (where invoice_id = $2)::int as linked, count(*)::int as all from payments where booking_id = $1", [b, id]);
      assert.equal(linked, all);
      await q.fails("update invoices set notes = 'changed' where id = $1", [id], /can't be changed/);
      await q.fails("select issue_invoice($1, current_date, current_date)", [id], /already been issued/);
      // (lines written in one transaction share a timestamp, so look for the line rather than "the newest")
      assert.equal(await count(q, "select 1 from booking_events where booking_id = $1 and body like $2", [b, `Invoice ${number} issued%`]), 1);
    });
  });

  it("voids only with a reason (logged), then allows a new invoice that takes over the payments", async () => {
    await asOwner(db, async (q) => {
      const b = await bookingId(q);
      await asFiona(q);
      const [{ id }] = await q("select create_invoice($1, 0, null, null) as id", [b]);
      await q("select issue_invoice($1, current_date, current_date + 10)", [id]);
      await q.fails("select void_invoice($1, '')", [id], /reason/);
      await q("select void_invoice($1, 'Wrong billing address')", [id]);
      await q.fails("select void_invoice($1, 'Again please')", [id], /already void/);
      await q.fails("update invoices set status = 'Issued' where id = $1", [id], /Use Issue or Void|can't be changed/);

      const [{ id: second }] = await q("select create_invoice($1, 0, null, null) as id", [b]);
      await q("select issue_invoice($1, current_date, current_date + 10)", [second]);
      const [{ moved }] = await q("select count(*)::int as moved from payments where booking_id = $1 and invoice_id = $2", [b, second]);
      assert.ok(moved > 0);

      await q("reset role");
      const [log] = await q(
        "select old_data->>'status' old_status, new_data->>'status' new_status, context->>'reason' reason, actor_id from audit_logs where table_name = 'invoices' and record_id = $1 order by id desc limit 1",
        [id]);
      assert.deepEqual(log, { old_status: "Issued", new_status: "Void", reason: "Wrong billing address", actor_id: USERS.fiona.id });
      assert.ok(await count(q, "select 1 from audit_logs where table_name = 'invoice_lines' and actor_id = $1", [USERS.fiona.id]) > 0);
    });
  });

  it("keeps invoices to Finance and admins (others can read where they see the money)", async () => {
    const [b] = (await db.query(UNINVOICED, [ORG])).rows;
    const [inv] = (await db.query("select id from invoices where number = 'INV-2026-0002'")).rows;
    for (const user of [USERS.sara, USERS.leo, USERS.sam, USERS.nora]) {
      await asUser(db, user.id, async (q) => {
        await q.fails("select create_invoice($1, 0, null, null)", [b.id], /Only Finance or an admin/);
        await q.fails("select issue_invoice($1, current_date, current_date)", [inv.id], /Only Finance or an admin/);
        await q.fails("select void_invoice($1, 'Not allowed here')", [inv.id], /Only Finance or an admin/);
      });
    }
    await asUser(db, USERS.aisha.id, async (q) => {
      const [{ id }] = await q("select create_invoice($1, 0, null, null) as id", [b.id]);
      assert.ok(id);
    });
    await asUser(db, USERS.leo.id, async (q) => assert.equal(await count(q, "select 1 from invoices"), 3));
    await asUser(db, USERS.sam.id, async (q) => assert.equal(await count(q, "select 1 from invoices"), 0));
  });

  it("refuses cancelled bookings and past due dates", async () => {
    await asUser(db, USERS.fiona.id, async (q) => {
      const [cancelled] = await q("select id from bookings where status = 'Cancelled' and organization_id = $1 limit 1", [ORG]);
      await q.fails("select create_invoice($1, 0, null, null)", [cancelled.id], /Cancelled bookings can't be invoiced/);
      const [b] = await q(UNINVOICED, [ORG]);
      await q.fails("select create_invoice($1, 0, current_date - 1, null)", [b.id], /due date can't be in the past/);
      await q.fails("select create_invoice($1, -5, null, null)", [b.id], /service fee between/);
    });
  });
});
