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
import { readFileSync } from "node:fs";
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
  it("applies all 23 migrations in order on an empty database", () => {
    const files = migrationFiles();
    assert.equal(files.length, 23);
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
      // Since migration 18 refunds are written through the refund functions only.
      const [{ id }] = await q("select record_paid_refund($1, 250, 'Bank transfer', current_date, 'Cancellation', 'Refund after cancellation', null) as id", [ids["FV-10477"]]);
      const [r] = await q("select reference_number from refunds where id = $1", [id]);
      assert.equal(r.reference_number, "RF-10477-1");
      await q.fails("select request_refund($1, 51, 'Card', 'Other', 'One more refund', null)", [ids["FV-10477"]], /exceed the amount received/);
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
    // Since migration 19 roles change through change_member_role() (never your own); the trigger still guards every path.
    await asUser(db, USERS.aisha.id, (q) =>
      q.fails("select change_member_role($1, $2, 'sales_manager', 'Stepping back from admin')", [ORG, USERS.aisha.id], /own role/));
    await asOwner(db, (q) =>
      q.fails("update organization_members set role = 'sales_manager' where user_id = $1", [USERS.aisha.id], /at least one active admin/));
  });

  it("only lets invited people in — there is no public sign-up", async () => {
    await asOwner(db, async (q) => {
      // Access is granted once the login is confirmed (an invited person accepting — migration 19).
      await q(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values (gen_random_uuid(), 'new.agent@flyvera.test', now(), '{"full_name":"New Agent"}')`);
      const invited = await q(`select m.role from organization_members m join auth.users u on u.id = m.user_id where u.email = 'new.agent@flyvera.test'`);
      assert.deepEqual(invited, [{ role: "sales_agent" }]);
      await q(`insert into auth.users (id, email, email_confirmed_at) values (gen_random_uuid(), 'stranger@example.test', now())`);
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
      // Requests go through request_refund() (migration 18) and only on cancelled bookings.
      await q.fails("select request_refund($1, 100, 'Card', 'Other', 'Customer request', null)", [ids["FV-10483"]], /only be requested on cancelled bookings/);
      await q.fails("select approve_refund(gen_random_uuid(), 1, null)", [], /Only Finance or an admin/);
      await q.fails(`insert into refunds (organization_id, booking_id, amount, method, status, approved_at, paid_on) values ($1, $2, 100, 'Card', 'Paid', now(), '2026-11-20')`,
        [ORG, ids["FV-10483"]], /permission denied|row-level security/);
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
      const [ref] = await q("select request_refund($1, 100, 'Card', 'Cancellation', 'Deposit back to the customer', null) as id", [ids["FV-10477"]]);
      assert.equal((await q("select status from refunds where id = $1", [ref.id]))[0].status, "Requested");
      await q.fails("select approve_refund($1, 100, null)", [ref.id], /someone else in Finance/); // separation of duties
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

  /**
   * An accepted quotation for Sara's customer CU-1001, created inside the current (rolled-back) transaction
   * the way the app does it: a Draft, its items, then accepted (answered quotations are final, migration 22).
   */
  async function acceptedQuote(q, withItems = true) {
    const [quote] = await q(
      `insert into quotations (organization_id, customer_id, recipient, title, destination, valid_until, status, prepared_by)
       values ($1, $2, '{"name":"Amelia Hart"}', 'Lisbon weekend', 'Lisbon', current_date + 14, 'Draft', $3) returning id`,
      [ORG, ids["CU-1001"], USERS.sara.id]);
    if (withItems) {
      await q(
        `insert into quotation_items (organization_id, quotation_id, position, item_type, description, quantity, unit_price, cost)
         values ($1, $2, 0, 'Flight', 'Return flights', 2, 400, 600), ($1, $2, 1, 'Hotel', '3 nights', 1, 500, 380)`,
        [ORG, quote.id]);
    }
    await q("update quotations set status = 'Accepted', sent_at = now(), responded_at = now() where id = $1", [quote.id]);
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

// ═════════════════════════════════════════════════════════════════════════════
describe("17 · Refund requests (migration 18)", () => {
  // FV-10477: cancelled, $300 received, Priya's booking (sales).
  const REQUEST = "select request_refund($1, $2, 'Card', 'Cancellation', $3, null) as id";
  const switchTo = async (q, user) => {
    await q("set local role authenticated");
    await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user.id })]);
  };

  it("lets sales request a refund on their cancelled booking, and no one else's", async () => {
    await asUser(db, USERS.priya.id, async (q) => {
      const [{ id }] = await q(REQUEST, [ids["FV-10477"], 120, "Customer cancelled, deposit refundable"]);
      const [r] = await q("select status, amount, requested_amount, reason_category, requested_by from refunds where id = $1", [id]);
      assert.deepEqual(
        { ...r, amount: Number(r.amount), requested_amount: Number(r.requested_amount) },
        { status: "Requested", amount: 120, requested_amount: 120, reason_category: "Cancellation", requested_by: USERS.priya.id },
      );
      assert.equal(await count(q, "select 1 from booking_events where booking_id = $1 and body like 'Refund RF-10477-% requested%'", [ids["FV-10477"]]), 1);
      await q.fails(REQUEST, [ids["FV-10477"], 500, "Asking for more than was paid"], /exceed the amount received/);
    });
    await asUser(db, USERS.sara.id, (q) => q.fails(REQUEST, [ids["FV-10477"], 10, "Not my booking"], /can't request refunds on this booking/));
    await asUser(db, USERS.sam.id, (q) => q.fails(REQUEST, [ids["FV-10477"], 10, "Support can't ask"], /can't request refunds on this booking/));
    await asUser(db, USERS.leo.id, (q) => q.fails(REQUEST, [ids["FV-10481"], 10, "Active booking refund"], /only be requested on cancelled bookings/));
  });

  it("approves (less, with a note), then pays — each step logged with who and why", async () => {
    await asOwner(db, async (q) => {
      await switchTo(q, USERS.priya);
      const [{ id }] = await q(REQUEST, [ids["FV-10477"], 120, "Customer cancelled, deposit refundable"]);
      await switchTo(q, USERS.fiona);
      await q.fails("select approve_refund($1, 150, null)", [id], /requested amount or less/);
      await q.fails("select approve_refund($1, 100, null)", [id], /Explain why less than requested/);
      await q("select approve_refund($1, 100, 'Airline keeps a $20 penalty')", [id]);
      await q.fails("select pay_refund($1, current_date + 1, 'Card', null)", [id], /between the booking date and today/);
      await q("select pay_refund($1, current_date, 'Bank transfer', 'TRX-5531')", [id]);
      const [r] = await q("select status, amount, approved_by, paid_on, payment_reference, decision_note from refunds where id = $1", [id]);
      assert.equal(r.status, "Paid");
      assert.equal(Number(r.amount), 100);
      assert.equal(r.approved_by, USERS.fiona.id);
      assert.equal(r.payment_reference, "TRX-5531");
      assert.equal(r.decision_note, "Airline keeps a $20 penalty");
      const [b] = await q("select refund_decision from bookings where id = $1", [ids["FV-10477"]]);
      assert.equal(b.refund_decision, "Refunded");
      await q("reset role");
      const [log] = await q(
        "select old_data->>'amount' old_amount, new_data->>'amount' new_amount, context->>'reason' reason from audit_logs where table_name = 'refunds' and record_id = $1 and new_data->>'status' = 'Approved'",
        [id]);
      assert.equal(Number(log.old_amount), 120);
      assert.equal(Number(log.new_amount), 100);
      assert.equal(log.reason, "Airline keeps a $20 penalty");
    });
  });

  it("separates duties: a finance requester can't approve or pay their own refund (admins can)", async () => {
    await asUser(db, USERS.fiona.id, async (q) => {
      const [{ id }] = await q(REQUEST, [ids["FV-10477"], 50, "Duplicate card charge"]);
      await q.fails("select approve_refund($1, 50, null)", [id], /someone else in Finance/);
    });
    await asUser(db, USERS.aisha.id, async (q) => {
      const [{ id }] = await q(REQUEST, [ids["FV-10477"], 50, "Small agency: admin does it all"]);
      await q("select approve_refund($1, 50, null)", [id]);
      await q("select pay_refund($1, current_date, 'Card', null)", [id]);
      assert.equal((await q("select status from refunds where id = $1", [id]))[0].status, "Paid");
    });
  });

  it("rejects with a reason, and lets only the requester withdraw a pending request", async () => {
    await asOwner(db, async (q) => {
      await switchTo(q, USERS.priya);
      const [{ id: a }] = await q(REQUEST, [ids["FV-10477"], 60, "First request for the deposit"]);
      const [{ id: b }] = await q(REQUEST, [ids["FV-10477"], 40, "Second request for the rest"]);
      await switchTo(q, USERS.fiona);
      await q.fails("select reject_refund($1, '')", [a], /reason/);
      await q("select reject_refund($1, 'Deposit was non-refundable')", [a]);
      await q.fails("select withdraw_refund($1)", [b], /Only the person who requested/);
      await switchTo(q, USERS.priya);
      await q("select withdraw_refund($1)", [b]);
      await q.fails("select withdraw_refund($1)", [b], /Only pending requests/);
      const rows = await q("select status, rejected_by, withdrawn_by, decision_note from refunds where id in ($1, $2) order by requested_amount desc", [a, b]);
      assert.deepEqual(rows, [
        { status: "Rejected", rejected_by: USERS.fiona.id, withdrawn_by: null, decision_note: "Deposit was non-refundable" },
        { status: "Rejected", rejected_by: null, withdrawn_by: USERS.priya.id, decision_note: "Withdrawn by the requester" },
      ]);
      // Rejected / withdrawn requests no longer hold money back: a new request for the full amount fits.
      assert.ok((await q(REQUEST, [ids["FV-10477"], 300, "Full refund after review"]))[0].id);
    });
  });

  it("records a refund finance already sent in one step, clearly marked, and blocks direct writes", async () => {
    await asUser(db, USERS.fiona.id, async (q) => {
      const [{ id }] = await q("select record_paid_refund($1, 75, 'Card', current_date, 'Airline refund', 'Airline refunded the taxes', 'CARD-77') as id", [ids["FV-10477"]]);
      const [r] = await q("select status, recorded_directly, requested_by, approved_by from refunds where id = $1", [id]);
      assert.deepEqual(r, { status: "Paid", recorded_directly: true, requested_by: USERS.fiona.id, approved_by: USERS.fiona.id });
      assert.equal(await count(q, "select 1 from booking_events where booking_id = $1 and body like '%recorded directly, no separate approval%'", [ids["FV-10477"]]), 1);
      await q.fails("insert into refunds (organization_id, booking_id, amount, method) values ($1, $2, 5, 'Card')", [ORG, ids["FV-10477"]], /permission denied/);
      await q.fails("update refunds set amount = 1 where id = $1", [id], /permission denied/);
    });
    for (const user of [USERS.priya, USERS.leo, USERS.sam]) {
      await asUser(db, user.id, (q) =>
        q.fails("select record_paid_refund($1, 5, 'Card', current_date, 'Other', 'Trying to pay out', null)", [ids["FV-10477"]], /Only Finance or an admin/));
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("18 · Team & access (migration 19)", () => {
  const TEAM_HORIZON = "c0000000-0000-4000-8000-000000000002";
  const TEAM_ATLAS = "c0000000-0000-4000-8000-000000000001";
  const INVITE = "select invite_member($1, $2, $3, $4, $5) as r";
  const switchTo = async (q, user) => {
    await q("set local role authenticated");
    await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user.id })]);
  };
  const login = (q, email, confirmed) =>
    q(`insert into auth.users (id, email, email_confirmed_at) values (gen_random_uuid(), $1, ${confirmed ? "now()" : "null"}) returning id`, [email]).then((r) => r[0].id);
  const membership = (q, userId) =>
    q("select m.role, (select array_agg(t.team_id) from team_members t where t.user_id = m.user_id) as teams from organization_members m where m.user_id = $1", [userId]);

  it("lets only admins invite, with valid details, and only once", async () => {
    await asUser(db, USERS.aisha.id, async (q) => {
      const [{ r }] = await q(INVITE, [ORG, "Lina.Park@Flyvera.test ", "Lina Park", "sales_agent", TEAM_HORIZON]);
      assert.equal(r.granted, false);
      const [inv] = await q("select email, full_name, role, team_id, invited_by from organization_invitations where id = $1", [r.id]);
      assert.deepEqual(inv, { email: "lina.park@flyvera.test", full_name: "Lina Park", role: "sales_agent", team_id: TEAM_HORIZON, invited_by: USERS.aisha.id });
      await q.fails(INVITE, [ORG, "lina.park@flyvera.test", "Lina Park", "sales_agent", null], /already been invited/);
      await q.fails(INVITE, [ORG, USERS.sara.email, "Sara Kim", "sales_agent", null], /already in the team\./);
      await q.fails(INVITE, [ORG, USERS.tom.email, "Tom Former", "sales_agent", null], /disabled — re-enable/);
      await q.fails(INVITE, [ORG, "not-an-email", "Someone", "sales_agent", null], /valid email/);
      await q.fails(INVITE, [ORG, "x@flyvera.test", "X", "sales_agent", null], /full name/);
      await q.fails("insert into organization_invitations (organization_id, email, role) values ($1, 'direct@flyvera.test', 'admin')", [ORG], /permission denied/);
    });
    await asUser(db, USERS.maya.id, (q) => q.fails(INVITE, [ORG, "a@flyvera.test", "Al Bee", "sales_agent", null], /Only an admin/));
    await asUser(db, USERS.nora.id, (q) => q.fails(INVITE, [ORG, "b@flyvera.test", "Bea Cee", "admin", null], /Only an admin/));
  });

  it("grants access only when the invitation is accepted, with the invited role and team", async () => {
    await asOwner(db, async (q) => {
      await switchTo(q, USERS.aisha);
      await q(INVITE, [ORG, "lina.park@flyvera.test", "Lina Park", "ticketing_agent", TEAM_HORIZON]);
      await q("reset role");
      // Supabase creates the login when it sends the email — not yet confirmed: no access.
      const lina = await login(q, "lina.park@flyvera.test", false);
      assert.deepEqual(await membership(q, lina), []);
      assert.equal((await q("select full_name from profiles where id = $1", [lina]))[0].full_name, "Lina Park");
      // Accepting the invitation confirms the email → access.
      await q("update auth.users set email_confirmed_at = now() where id = $1", [lina]);
      assert.deepEqual(await membership(q, lina), [{ role: "ticketing_agent", teams: [TEAM_HORIZON] }]);
      assert.equal(await count(q, "select 1 from organization_invitations where email = 'lina.park@flyvera.test' and accepted_at is not null"), 1);
    });
  });

  it("never grants a revoked or expired invitation; a revoked one can be replaced", async () => {
    await asOwner(db, async (q) => {
      await switchTo(q, USERS.aisha);
      const [{ r }] = await q(INVITE, [ORG, "omar@flyvera.test", "Omar Haddad", "sales_agent", null]);
      await q("reset role");
      const omar = await login(q, "omar@flyvera.test", false);
      await switchTo(q, USERS.aisha);
      // Revoking returns the unconfirmed login so the app can remove it (the email link stops working).
      assert.equal((await q("select revoke_invitation($1) as login", [r.id]))[0].login, omar);
      await q.fails("select revoke_invitation($1)", [r.id], /already revoked/);
      await q("reset role");
      await q("update auth.users set email_confirmed_at = now() where id = $1", [omar]);
      assert.deepEqual(await membership(q, omar), [], "revoked: no access");
      // A new invitation for someone who already has a confirmed login grants access at once.
      await switchTo(q, USERS.aisha);
      const [{ r: again }] = await q(INVITE, [ORG, "omar@flyvera.test", "Omar Haddad", "sales_agent", null]);
      assert.equal(again.granted, true);
      await q("reset role");
      assert.deepEqual(await membership(q, omar), [{ role: "sales_agent", teams: null }]);
      // Expired invitations grant nothing.
      await q("insert into organization_invitations (organization_id, email, role, expires_at) values ($1, 'late@flyvera.test', 'sales_agent', now() - interval '1 day')", [ORG]);
      const late = await login(q, "late@flyvera.test", true);
      assert.deepEqual(await membership(q, late), []);
    });
  });

  it("changes roles only with a reason, never your own, and logs the reason", async () => {
    await asOwner(db, async (q) => {
      await switchTo(q, USERS.aisha);
      const CHANGE = "select change_member_role($1, $2, $3, $4)";
      await q.fails(CHANGE, [ORG, USERS.daniel.id, "sales_manager", ""], /reason/);
      await q.fails(CHANGE, [ORG, USERS.daniel.id, "sales_agent", "No change at all"], /different role/);
      await q.fails(CHANGE, [ORG, USERS.aisha.id, "sales_manager", "Stepping back"], /own role/);
      await q(CHANGE, [ORG, USERS.daniel.id, "sales_manager", "Promoted to lead Team Horizon"]);
      assert.equal((await membership(q, USERS.daniel.id))[0].role, "sales_manager");
      await q.fails("update organization_members set role = 'admin' where user_id = $1", [USERS.daniel.id], /permission denied/);
      await q.fails("delete from organization_members where user_id = $1", [USERS.daniel.id], /permission denied/);
      await q("reset role");
      const [log] = await q(
        "select old_data->>'role' old_role, new_data->>'role' new_role, context->>'reason' reason, actor_id from audit_logs where table_name = 'organization_members' and new_data->>'user_id' = $1 and action = 'UPDATE'",
        [USERS.daniel.id]);
      assert.deepEqual(log, { old_role: "sales_agent", new_role: "sales_manager", reason: "Promoted to lead Team Horizon", actor_id: USERS.aisha.id });
    });
    await asUser(db, USERS.maya.id, (q) =>
      q.fails("select change_member_role($1, $2, 'admin', 'Make me admin please')", [ORG, USERS.sara.id], /Only an admin/));
  });

  it("disables someone only with a reason, handing their open work to an active colleague", async () => {
    await asOwner(db, async (q) => {
      const closedBefore = await count(q, "select 1 from bookings where agent_id = $1 and status in ('Completed', 'Cancelled')", [USERS.daniel.id]);
      const customersOfSara = await count(q, "select 1 from customers where assigned_to = $1", [USERS.sara.id]);
      await switchTo(q, USERS.aisha);
      const SET = "select set_member_status($1, $2, $3, $4, $5) as moved";
      const [{ open_work: work }] = await q("select member_open_work($1, $2) as open_work", [ORG, USERS.daniel.id]);
      assert.ok(work.customers > 0, "Daniel has customers to hand over");
      await q.fails(SET, [ORG, USERS.daniel.id, "disabled", "", USERS.sara.id], /reason/);
      await q.fails(SET, [ORG, USERS.daniel.id, "disabled", "Left the company", null], /choose a colleague/);
      for (const to of [USERS.sam.id, USERS.tom.id, USERS.daniel.id, USERS.nora.id]) {
        await q.fails(SET, [ORG, USERS.daniel.id, "disabled", "Left the company", to], /active admin or sales colleague/);
      }
      await q.fails(SET, [ORG, USERS.aisha.id, "disabled", "Taking a break", USERS.sara.id], /yourself/);
      const [{ moved }] = await q(SET, [ORG, USERS.daniel.id, "disabled", "Left the company", USERS.sara.id]);
      assert.deepEqual(moved, work);
      assert.deepEqual(Object.values((await q("select member_open_work($1, $2) as w", [ORG, USERS.daniel.id]))[0].w), [0, 0, 0, 0, 0, 0]);
      await q("reset role");
      assert.equal(await count(q, "select 1 from customers where assigned_to = $1", [USERS.sara.id]), customersOfSara + work.customers);
      assert.equal(await count(q, "select 1 from bookings where agent_id = $1 and status in ('Completed', 'Cancelled')", [USERS.daniel.id]), closedBefore,
        "finished bookings keep their original agent");
      assert.ok(await count(q, "select 1 from audit_logs where table_name = 'customers' and context->>'reason' like 'Reassigned on disabling a team member: Left the company'") >= work.customers);
      // Disabled: no access at all.
      await switchTo(q, USERS.daniel);
      assert.equal(await count(q, "select 1 from customers"), 0);
      assert.equal(await count(q, "select 1 from organizations"), 0);
    });
  });

  it("re-enables a disabled member, who gets access back", async () => {
    await asOwner(db, async (q) => {
      await switchTo(q, USERS.aisha);
      await q("select set_member_status($1, $2, 'active', 'Back for the summer season', null)", [ORG, USERS.tom.id]);
      await switchTo(q, USERS.tom);
      assert.equal(await count(q, "select 1 from organizations"), 1);
    });
  });

  it("changes what a sales manager sees when an agent moves between teams", async () => {
    assert.ok(customersOf("Priya N.").length > 0);
    await asOwner(db, async (q) => {
      await switchTo(q, USERS.maya);
      assert.equal(await count(q, "select 1 from customers where assigned_to = $1", [USERS.priya.id]), 0);
      await q.fails("insert into team_members (team_id, organization_id, user_id) values ($1, $2, $3)", [TEAM_ATLAS, ORG, USERS.priya.id], /row-level security/);
      await switchTo(q, USERS.aisha);
      await q("insert into team_members (team_id, organization_id, user_id) values ($1, $2, $3)", [TEAM_ATLAS, ORG, USERS.priya.id]);
      await switchTo(q, USERS.maya);
      assert.equal(await count(q, "select 1 from customers where assigned_to = $1", [USERS.priya.id]), customersOf("Priya N.").length);
    });
  });

  it("keeps the team directory (emails, last sign-in) to admins", async () => {
    await asUser(db, USERS.aisha.id, async (q) => {
      const rows = await q("select user_id, email, role, status from team_directory($1)", [ORG]);
      assert.equal(rows.length, Object.values(USERS).filter((u) => !u.org).length);
      assert.deepEqual(rows.find((r) => r.user_id === USERS.tom.id), { user_id: USERS.tom.id, email: USERS.tom.email, role: "sales_agent", status: "disabled" });
    });
    await asUser(db, USERS.maya.id, (q) => q.fails("select * from team_directory($1)", [ORG], /Only an admin/));
    await asUser(db, USERS.maya.id, (q) => q.fails("select member_open_work($1, $2)", [ORG, USERS.sara.id], /Only an admin/));
    await asUser(db, USERS.nora.id, (q) => q.fails("select * from team_directory($1)", [ORG], /Only an admin/));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("19 · Dashboard data sources", () => {
  // The dashboard reads flight segments, booking timeline lines and lead activity directly;
  // it relies on Row Level Security to give each role only its own share.
  const SOURCES = {
    segments: "select 1 from booking_segments",
    events: "select 1 from booking_events",
    leadActivity: "select 1 from lead_activities",
  };
  const countAll = async (userId) => {
    const out = {};
    await asUser(db, userId, async (q) => {
      for (const [k, sql] of Object.entries(SOURCES)) out[k] = await count(q, sql);
      out.payments = await count(q, "select 1 from payments");
    });
    return out;
  };

  it("shows each role only the departures, timeline lines and lead activity it may see", async () => {
    let all, sara;
    await asOwner(db, async (q) => {
      all = { segments: await count(q, SOURCES.segments), events: await count(q, SOURCES.events), leadActivity: await count(q, SOURCES.leadActivity) };
      all.eventsWithoutMoney = await count(q, "select 1 from booking_events where not mentions_money");
      const visible = bookingsVisibleTo("Sara K.").map((b) => ids[b.id] ?? null);
      const codes = bookingsVisibleTo("Sara K.").map((b) => b.id);
      sara = {
        segments: await count(q, "select 1 from booking_segments s join bookings b on b.id = s.booking_id where b.code = any($1)", [codes]),
        events: await count(q, "select 1 from booking_events e join bookings b on b.id = e.booking_id where b.code = any($1)", [codes]),
        leadActivity: await count(q, "select 1 from lead_activities a join leads l on l.id = a.lead_id where l.assigned_to = $1", [USERS.sara.id]),
      };
      assert.ok(visible.length > 0);
    });
    assert.ok(all.segments > 0 && all.events > 0 && all.leadActivity > 0, "the seed has data for every source");
    assert.ok(sara.events < all.events, "the check is meaningful: Sara can't see every booking");

    const saraSees = await countAll(USERS.sara.id);
    assert.deepEqual({ segments: saraSees.segments, events: saraSees.events, leadActivity: saraSees.leadActivity }, sara, "sales agent: only her customers' bookings and her leads");

    const samSees = await countAll(USERS.sam.id);
    assert.deepEqual(
      { segments: samSees.segments, events: samSees.events, leadActivity: samSees.leadActivity },
      { segments: all.segments, events: all.eventsWithoutMoney, leadActivity: all.leadActivity },
      "support: flight times, timeline lines without amounts (migration 21), and leads",
    );
    assert.equal(samSees.payments, 0, "support: no payment amounts");

    const leoSees = await countAll(USERS.leo.id);
    assert.equal(leoSees.segments, all.segments, "ticketing: every departure");
    assert.equal(leoSees.leadActivity, 0, "ticketing: no lead activity");

    const noraSees = await countAll(USERS.nora.id);
    assert.deepEqual({ segments: noraSees.segments, events: noraSees.events, leadActivity: noraSees.leadActivity }, { segments: 0, events: 0, leadActivity: 0 }, "another agency: nothing");
    assert.ok(all.eventsWithoutMoney < all.events, "the seed has timeline lines with amounts");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("20 · Agency settings (migration 20)", () => {
  const switchTo = async (q, user) => {
    await q("set local role authenticated");
    await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user.id })]);
  };
  const PROFILE = {
    legal_name: "Flyvera Travel & Tourism LLC",
    address: "Office 1203, Bay Square 4",
    city: "Dubai",
    country: "United Arab Emirates",
    phone: "+971 4 555 0100",
    email: "Accounts@Flyvera.test",
    website: "flyvera.test",
    tax_number: "100123456700003",
    iata_number: "96012345",
    bank_name: "Emirates NBD",
    account_name: "Flyvera Travel & Tourism LLC",
    iban: "AE07 0331 2345 6789 0123 456",
    swift: "ebiladax",
    payment_note: "Please quote the invoice number.",
  };
  const DEFAULTS = {
    quote_validity_days: 10,
    default_tax_rate: 5,
    low_margin_percent: 12,
    deposit_days: 5,
    balance_days_before_departure: 45,
    supplier_days_before_departure: 21,
    quote_terms: ["Prices valid for 10 days.", "  "],
    invoice_terms: ["Payment due by the date shown."],
  };
  const SAVE = "select update_agency_settings($1, $2, $3, $4)";

  it("lets an admin save the profile and defaults, keeping other settings", async () => {
    await asOwner(db, async (q) => {
      await q(`update organizations set settings = settings || '{"custom_flag": true}'::jsonb where id = $1`, [ORG]);
      await switchTo(q, USERS.aisha);
      await q(SAVE, [ORG, "FLYVERA TRAVEL", PROFILE, DEFAULTS]);
      const [{ name, settings: s }] = await q("select name, settings from organizations where id = $1", [ORG]);
      assert.equal(name, "FLYVERA TRAVEL");
      assert.equal(s.custom_flag, true, "unrelated keys are kept");
      assert.equal(s.quote_validity_days, 10);
      assert.equal(Number(s.default_tax_rate), 5);
      assert.deepEqual(s.quote_terms, ["Prices valid for 10 days."], "blank lines are dropped");
      assert.equal(s.profile.email, "accounts@flyvera.test");
      assert.equal(s.profile.iban, "AE070331234567890123456");
      assert.equal(s.profile.swift, "EBILADAX");
      // Clearing a field removes it from the printed details.
      await q(SAVE, [ORG, "FLYVERA TRAVEL", { ...PROFILE, website: "" }, DEFAULTS]);
      const [{ settings: after }] = await q("select settings from organizations where id = $1", [ORG]);
      assert.equal(after.profile.website, undefined);
      await q("reset role");
      const [log] = await q(
        "select actor_id, context->>'reason' as reason from audit_logs where table_name = 'organizations' and record_id = $1 order by id desc limit 1",
        [ORG]);
      assert.deepEqual(log, { actor_id: USERS.aisha.id, reason: "Agency settings updated" });
    });
  });

  it("rejects values outside the allowed ranges, with a clear message", async () => {
    const withoutMargin = { ...DEFAULTS };
    delete withoutMargin.low_margin_percent;
    await asUser(db, USERS.aisha.id, async (q) => {
      const bad = [
        [{ ...DEFAULTS, default_tax_rate: 60 }, PROFILE, /Default tax must be from 0 to 50/],
        [{ ...DEFAULTS, quote_validity_days: 0 }, PROFILE, /Quotation validity must be a whole number from 1 to 90/],
        [{ ...DEFAULTS, deposit_days: 2.5 }, PROFILE, /Deposit due must be a whole number/],
        [{ ...DEFAULTS, quote_terms: Array(11).fill("Line") }, PROFILE, /at most 10 lines/],
        [{ ...DEFAULTS, invoice_terms: ["x".repeat(301)] }, PROFILE, /at most 300 characters/],
        [{ ...DEFAULTS, surprise: 1 }, PROFILE, /Unknown setting: surprise/],
        [withoutMargin, PROFILE, /Low-margin alert must be a whole number/],
        [DEFAULTS, { ...PROFILE, email: "not-an-email" }, /valid email/],
        [DEFAULTS, { ...PROFILE, swift: "ABC" }, /SWIFT/],
        [DEFAULTS, { ...PROFILE, iban: "12345" }, /valid IBAN/],
        [DEFAULTS, { ...PROFILE, logo: "x" }, /Unknown profile field: logo/],
      ];
      for (const [defaults, profile, message] of bad) await q.fails(SAVE, [ORG, "FLYVERA TRAVEL", profile, defaults], message);
      await q.fails(SAVE, [ORG, "F", PROFILE, DEFAULTS], /agency name/);
    });
  });

  it("keeps settings to admins, and blocks direct edits of the agency row", async () => {
    for (const user of [USERS.maya, USERS.fiona, USERS.sam, USERS.nora]) {
      await asUser(db, user.id, (q) => q.fails(SAVE, [ORG, "Hijacked", PROFILE, DEFAULTS], /Only an admin/));
    }
    await asUser(db, USERS.aisha.id, async (q) => {
      await q.fails("update organizations set name = 'Direct' where id = $1", [ORG], /permission denied/);
      await q.fails("update organizations set base_currency = 'EUR' where id = $1", [ORG], /permission denied/);
    });
    await asUser(db, USERS.sara.id, async (q) => {
      assert.equal((await q("select name from organizations where id = $1", [ORG]))[0].name, "FLYVERA TRAVEL", "members still read their agency");
    });
  });

  it("freezes the agency details on an invoice when it's issued", async () => {
    await asOwner(db, async (q) => {
      const [{ id: b }] = await q(
        "select b.id from bookings b where b.organization_id = $1 and b.status <> 'Cancelled' and not exists (select 1 from invoices i where i.booking_id = b.id) order by b.code limit 1",
        [ORG]);
      await switchTo(q, USERS.aisha);
      await q(SAVE, [ORG, "FLYVERA TRAVEL", PROFILE, DEFAULTS]);
      await switchTo(q, USERS.fiona);
      const [{ id }] = await q("select create_invoice($1, 0, current_date + 14, null) as id", [b]);
      assert.equal((await q("select issuer from invoices where id = $1", [id]))[0].issuer, null, "drafts have no copy yet");
      await q("select issue_invoice($1, current_date, current_date + 14)", [id]);
      const [{ issuer }] = await q("select issuer from invoices where id = $1", [id]);
      assert.equal(issuer.name, "FLYVERA TRAVEL");
      assert.equal(issuer.tax_number, "100123456700003");
      assert.equal(issuer.iban, "AE070331234567890123456");
      assert.deepEqual(issuer.terms, ["Payment due by the date shown."], "invoice terms, not quotation terms");
      // A later change of address doesn't alter the issued invoice.
      await switchTo(q, USERS.aisha);
      await q(SAVE, [ORG, "FLYVERA TRAVEL", { ...PROFILE, address: "New office, Tower 9" }, DEFAULTS]);
      assert.equal((await q("select issuer->>'address' as a from invoices where id = $1", [id]))[0].a, "Office 1203, Bay Square 4");
      await switchTo(q, USERS.fiona);
      await q.fails("update invoices set issuer = '{}'::jsonb where id = $1", [id], /can't be changed/);
    });
  });

  it("gives invoices issued before migration 20 a copy of the agency's details", async () => {
    // The test database loads the seed AFTER the migrations, so its issued invoices have no copy yet —
    // like invoices issued on staging before migration 20. Run the migration's own backfill statement.
    const sql = readFileSync(new URL("../migrations/20261120002000_agency_settings.sql", import.meta.url), "utf8");
    const backfill = sql.match(/^update public.invoices set issuer = .*;$/m)?.[0];
    assert.ok(backfill, "the migration contains the backfill");
    await asOwner(db, async (q) => {
      assert.ok((await count(q, "select 1 from invoices where status <> 'Draft' and issuer is null")) > 0);
      await q(backfill);
      const rows = await q("select status, issuer from invoices where organization_id = $1", [ORG]);
      const issued = rows.filter((r) => r.status !== "Draft");
      assert.ok(issued.length > 0, "the seed has issued invoices");
      for (const r of issued) {
        assert.equal(r.issuer.name, "FLYVERA TRAVEL");
        assert.equal(r.issuer.terms.length, 4, "the seed's quotation terms");
      }
      assert.ok(rows.filter((r) => r.status === "Draft").every((r) => r.issuer === null));
    });
  });

  it("lets people edit only their own profile", async () => {
    await asUser(db, USERS.sara.id, async (q) => {
      const mine = await q("update profiles set display_name = 'Sara K.', phone = '+971501112233' where id = $1 returning id", [USERS.sara.id]);
      assert.equal(mine.length, 1);
      const theirs = await q("update profiles set display_name = 'Hacked' where id = $1 returning id", [USERS.daniel.id]);
      assert.equal(theirs.length, 0, "someone else's profile isn't updated");
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("21 · Gap fills (migration 21)", () => {
  const switchTo = async (q, user) => {
    await q("set local role authenticated");
    await q("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user.id })]);
  };
  const leadId = async (q, code) => (await q("select id from leads where code = $1 and organization_id = $2", [code, ORG]))[0].id;

  it("won't archive a customer with active bookings or a quotation that became a booking", async () => {
    await asOwner(db, async (q) => {
      const [busy] = await q(
        "select c.id, c.assigned_to from customers c where c.organization_id = $1 and exists (select 1 from bookings b where b.customer_id = c.id and b.status not in ('Completed', 'Cancelled')) order by c.code limit 1",
        [ORG]);
      const [booked] = await q("select q.id from quotations q join bookings b on b.quotation_id = q.id where q.organization_id = $1 limit 1", [ORG]);
      await switchTo(q, USERS.aisha);
      await q.fails("select archive_customer($1)", [busy.id], /has active bookings \(FV-/);
      await q.fails("select archive_quotation($1)", [booked.id], /became booking FV-/);
    });
  });

  it("archives other records for whoever may edit them; only admins see and restore them", async () => {
    await asOwner(db, async (q) => {
      const [free] = await q(
        "select c.id from customers c where c.organization_id = $1 and c.assigned_to = $2 and not exists (select 1 from bookings b where b.customer_id = c.id and b.status not in ('Completed', 'Cancelled')) order by c.code limit 1",
        [ORG, USERS.sara.id]);
      assert.ok(free, "Sara has a customer without active bookings");
      await switchTo(q, USERS.leo);
      await q.fails("select archive_customer($1)", [free.id], /cannot archive this customer/);
      await switchTo(q, USERS.sara);
      await q("select archive_customer($1)", [free.id]);
      assert.equal(await count(q, "select 1 from customers where id = $1", [free.id]), 0, "archived: gone from Sara's list");
      await q("update customers set deleted_at = null where id = $1", [free.id]);
      await switchTo(q, USERS.aisha);
      assert.equal(await count(q, "select 1 from customers where id = $1 and deleted_at is not null", [free.id]), 1, "a non-admin can't restore");
      await q("update customers set deleted_at = null where id = $1", [free.id]);
      await switchTo(q, USERS.sara);
      assert.equal(await count(q, "select 1 from customers where id = $1", [free.id]), 1, "restored by the admin");
    });
  });

  it("records every lead stage change automatically", async () => {
    await asUser(db, USERS.sara.id, async (q) => {
      const id = await leadId(q, "LD-2061");
      await q("update leads set stage = 'Contacted', notes = 'Called back' where id = $1", [id]);
      await q("update leads set notes = 'Only a note' where id = $1", [id]);
      await q("update leads set stage = 'Lost', lost_reason = 'Chose another agency' where id = $1", [id]);
      const rows = await q(
        "select from_stage, to_stage, body, created_by from lead_activities where lead_id = $1 and activity_type = 'Stage change'",
        [id]);
      // Both changes happen in one transaction (same timestamp), so put them in stage order here.
      rows.sort((a, b) => (a.from_stage === "New" ? -1 : b.from_stage === "New" ? 1 : 0));
      assert.deepEqual(rows.map((r) => [r.from_stage, r.to_stage, r.body]), [["New", "Contacted", null], ["Contacted", "Lost", "Chose another agency"]]);
      assert.ok(rows.every((r) => r.created_by === USERS.sara.id));
    });
  });

  it("lets people log activity on leads they can see; entries can't be changed", async () => {
    await asUser(db, USERS.sara.id, async (q) => {
      const mine = await leadId(q, "LD-2061");
      const [{ id }] = await q("insert into lead_activities (organization_id, lead_id, activity_type, body) values ($1, $2, 'Call', 'Discussed villas') returning id", [ORG, mine]);
      await q.fails("update lead_activities set body = 'Changed' where id = $1", [id], /permission denied/);
      await q.fails("delete from lead_activities where id = $1", [id], /permission denied/);
    });
    await asOwner(db, async (q) => {
      const daniels = await leadId(q, "LD-2060");
      await switchTo(q, USERS.sara);
      await q.fails("insert into lead_activities (organization_id, lead_id, activity_type, body) values ($1, $2, 'Call', 'Not my lead')", [ORG, daniels], /row-level security/);
    });
  });

  it("keeps timeline lines that mention money from roles that can't see money", async () => {
    const samples = {
      "Payment of $500 recorded": true,
      "Refund RF-10477-1 of USD 120.00 requested (Cancellation)": true,
      "Invoice INV-2026-0001 issued (USD 1250.00, due 2026-12-01)": true,
      "Booking confirmed": false,
      "Ticket 157-2345678901 issued for Amelia Clarke": false,
      "FV-10481 moved to Ticketed": false,
    };
    await asOwner(db, async (q) => {
      const b = ids["FV-10481"];
      const inserted = [];
      for (const body of Object.keys(samples)) {
        inserted.push((await q("insert into booking_events (organization_id, booking_id, body) values ($1, $2, $3) returning id", [ORG, b, body]))[0].id);
      }
      const rows = await q("select body, mentions_money from booking_events where id = any($1)", [inserted]);
      assert.deepEqual(Object.fromEntries(rows.map((r) => [r.body, r.mentions_money])), samples, "same rule as the app");
      const seen = async (user) => {
        await switchTo(q, user);
        const n = await count(q, "select 1 from booking_events where id = any($1)", [inserted]);
        await q("reset role");
        return n;
      };
      assert.equal(await seen(USERS.sam), 3, "support: only the lines without money");
      assert.equal(await seen(USERS.fiona), 6, "finance: everything");
      assert.equal(await seen(USERS.leo), 6, "ticketing: everything");
    });
  });

  it("lets ticketing and finance manage suppliers; sales read them; support doesn't see them", async () => {
    await asUser(db, USERS.leo.id, async (q) => {
      const [{ id }] = await q("insert into suppliers (organization_id, name, supplier_type, payment_terms_days) values ($1, 'Test Hotels Ltd', 'Hotel', 30) returning id", [ORG]);
      await q("update suppliers set active = false where id = $1", [id]);
      assert.equal((await q("delete from suppliers where id = $1 returning id", [id])).length, 0, "only admins delete");
    });
    await asUser(db, USERS.sara.id, async (q) => {
      assert.ok((await count(q, "select 1 from suppliers")) > 0);
      await q.fails("insert into suppliers (organization_id, name, supplier_type) values ($1, 'Sales Supplier', 'Other')", [ORG], /row-level security/);
    });
    await asUser(db, USERS.sam.id, async (q) => assert.equal(await count(q, "select 1 from suppliers"), 0));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// The exact guarded updates the Quotations server actions send (src/lib/actions/quotations.ts).
describe("22 · Quotation status & edit guards (app workflow)", () => {
  const STATUS = "update quotations set status = $2, responded_at = now() where id = $1 and status = $3 returning id";
  const quoteId = async (q, code) => (await q("select id from quotations where code = $1", [code]))[0].id;

  it("a status change checked against the current status applies once; a stale one changes nothing", async () => {
    await asUser(db, USERS.sara.id, async (q) => {
      const id = await quoteId(q, "QT-3003"); // Sara's, Sent
      assert.equal(N(await q(STATUS, [id, "Declined", "Draft"])), 0, "stale: it isn't Draft");
      assert.equal((await q("select status from quotations where id = $1", [id]))[0].status, "Sent", "unchanged");
      assert.equal(N(await q(STATUS, [id, "Accepted", "Sent"])), 1, "current: applies");
      assert.equal(N(await q(STATUS, [id, "Declined", "Sent"])), 0, "a second answer can't overwrite the first");
      assert.equal((await q("select status from quotations where id = $1", [id]))[0].status, "Accepted");
    });
  });

  it("an edit limited to Draft/Sent quotations doesn't touch an accepted one", async () => {
    await asUser(db, USERS.sara.id, async (q) => {
      const id = await quoteId(q, "QT-3001"); // Sara's, Accepted
      assert.equal(N(await q("update quotations set title = 'Changed' where id = $1 and status in ('Draft', 'Sent') returning id", [id])), 0);
      assert.equal((await q("select title from quotations where id = $1", [id]))[0].title === "Changed", false);
    });
  });

  it("a role that can read but not change quotations gets no row back and no error (never a success)", async () => {
    await asUser(db, USERS.fiona.id, async (q) => {
      const id = await quoteId(q, "QT-3002"); // Sent, readable by finance
      assert.equal(N(await q(STATUS, [id, "Accepted", "Sent"])), 0, "no error, but nothing changed: the app must not report success");
      assert.equal((await q("select status from quotations where id = $1", [id]))[0].status, "Sent");
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("23 · Answered quotations are final (migration 22)", () => {
  const LOCKED = /was (accepted|declined), so it can't be changed/;
  const LOCKED_ITEMS = /was (accepted|declined), so its items can't be changed/;
  const idOf = async (q, code) => (await q("select id from quotations where code = $1", [code]))[0].id;
  const row = async (q, code) =>
    (await q("select status, title, prepared_by, sent_at, responded_at, deleted_at from quotations where code = $1", [code]))[0];

  it("a sales agent can't edit, reassign, re-open or re-answer her accepted or declined quotation", async () => {
    await asUser(db, USERS.sara.id, async (q) => {
      const accepted = await idOf(q, "QT-3001"); // Sara's, Accepted
      const declined = await idOf(q, "QT-3006"); // Sara's, Declined
      const before = await row(q, "QT-3001");
      await q.fails("update quotations set title = 'Changed' where id = $1", [accepted], LOCKED);
      await q.fails("update quotations set status = 'Draft' where id = $1", [accepted], LOCKED);
      await q.fails("update quotations set status = 'Sent', responded_at = null where id = $1", [accepted], LOCKED);
      await q.fails("update quotations set status = 'Declined' where id = $1", [accepted], LOCKED);
      await q.fails("update quotations set prepared_by = $2 where id = $1", [accepted, USERS.daniel.id], LOCKED);
      await q.fails("update quotations set discount = 0, notes = 'x' where id = $1", [accepted], LOCKED);
      await q.fails("update quotations set status = 'Accepted' where id = $1", [declined], LOCKED);
      assert.deepEqual(await row(q, "QT-3001"), before, "nothing changed");
    });
  });

  it("their items can't be added, changed, removed or moved", async () => {
    await asUser(db, USERS.sara.id, async (q) => {
      const accepted = await idOf(q, "QT-3001");
      const declined = await idOf(q, "QT-3006");
      const items = await q("select id, unit_price from quotation_items where quotation_id = $1 order by position", [accepted]);
      assert.ok(items.length > 0);
      await q.fails("update quotation_items set unit_price = 1 where quotation_id = $1", [accepted], LOCKED_ITEMS);
      await q.fails("delete from quotation_items where quotation_id = $1", [accepted], LOCKED_ITEMS);
      await q.fails(
        `insert into quotation_items (organization_id, quotation_id, position, item_type, description, quantity, unit_price, cost)
         values ($1, $2, 9, 'Other', 'Extra', 1, 10, 0)`,
        [ORG, declined],
        LOCKED_ITEMS,
      );
      // Moving an item out of, or into, an answered quotation is blocked too.
      const draft = await idOf(q, "QT-3005");
      const [draftItem] = await q("select id from quotation_items where quotation_id = $1 limit 1", [draft]);
      await q.fails("update quotation_items set quotation_id = $2 where id = $1", [items[0].id, draft], LOCKED_ITEMS);
      await q.fails("update quotation_items set quotation_id = $2 where id = $1", [draftItem.id, accepted], LOCKED_ITEMS);
      assert.deepEqual(await q("select id, unit_price from quotation_items where quotation_id = $1 order by position", [accepted]), items);
    });
  });

  it("admins can't edit them either (no override), but can still archive, restore and delete them", async () => {
    await asUser(db, USERS.aisha.id, async (q) => {
      const accepted = await idOf(q, "QT-3001");
      const declined = await idOf(q, "QT-3006"); // not booked, so it may be archived
      await q.fails("update quotations set title = 'Changed by admin' where id = $1", [accepted], LOCKED);
      await q.fails("update quotation_items set cost = 0 where quotation_id = $1", [declined], LOCKED_ITEMS);

      const audits = () => count(q, "select 1 from audit_logs where table_name = 'quotations' and record_id = $1", [declined]);
      const auditBefore = await audits();
      await q("select archive_quotation($1)", [declined]);
      assert.notEqual((await row(q, "QT-3006")).deleted_at, null, "archived");
      assert.equal(N(await q("update quotations set deleted_at = null where id = $1 returning id", [declined])), 1, "restored");
      assert.equal((await row(q, "QT-3006")).deleted_at, null);
      assert.equal(await audits(), auditBefore + 2, "archive and restore are audited as before");

      // Deleting a whole answered quotation (admin-only policy) still removes its items with it.
      const [qt] = await q(
        `insert into quotations (organization_id, customer_id, recipient, title, destination, valid_until, status, prepared_by)
         values ($1, $2, '{"name":"Test"}', 'Oslo', 'Oslo', current_date + 14, 'Draft', $3) returning id`,
        [ORG, ids["CU-1001"], USERS.sara.id],
      );
      await q(
        `insert into quotation_items (organization_id, quotation_id, position, item_type, description, quantity, unit_price, cost)
         values ($1, $2, 0, 'Hotel', '2 nights', 1, 300, 200)`,
        [ORG, qt.id],
      );
      await q("update quotations set status = 'Declined', sent_at = now(), responded_at = now() where id = $1", [qt.id]);
      assert.equal(N(await q("delete from quotations where id = $1 returning id", [qt.id])), 1);
      assert.equal(await count(q, "select 1 from quotation_items where quotation_id = $1", [qt.id]), 0);
    });
  });

  it("a blocked change leaves no trace: the record and its audit history are unchanged", async () => {
    await asUser(db, USERS.aisha.id, async (q) => {
      const accepted = await idOf(q, "QT-3001");
      const audits = () => count(q, "select 1 from audit_logs where table_name = 'quotations' and record_id = $1", [accepted]);
      const before = { row: await row(q, "QT-3001"), audits: await audits() };
      await q.fails("update quotations set status = 'Draft' where id = $1", [accepted], LOCKED);
      assert.deepEqual({ row: await row(q, "QT-3001"), audits: await audits() }, before);
    });
  });

  it("Draft and Sent quotations work exactly as before: edit, items, Draft → Sent → Accepted / Declined", async () => {
    await asUser(db, USERS.sara.id, async (q) => {
      const draft = await idOf(q, "QT-3005"); // Draft
      const sent = await idOf(q, "QT-3003"); // Sent
      assert.equal(N(await q("update quotations set title = 'Edited draft' where id = $1 returning id", [draft])), 1);
      const [item] = await q(
        `insert into quotation_items (organization_id, quotation_id, position, item_type, description, quantity, unit_price, cost)
         values ($1, $2, 9, 'Other', 'Extra', 1, 10, 0) returning id`,
        [ORG, draft],
      );
      assert.equal(N(await q("update quotation_items set unit_price = 12 where id = $1 returning id", [item.id])), 1);
      assert.equal(N(await q("delete from quotation_items where id = $1 returning id", [item.id])), 1);

      assert.equal(N(await q("update quotations set title = 'Edited while sent' where id = $1 returning id", [sent])), 1);
      assert.equal(N(await q("update quotations set status = 'Sent', sent_at = now() where id = $1 returning id", [draft])), 1, "Draft → Sent");
      assert.equal(N(await q("update quotations set status = 'Declined', responded_at = now() where id = $1 returning id", [draft])), 1, "Sent → Declined");
      assert.equal(N(await q("update quotations set status = 'Accepted', responded_at = now() where id = $1 returning id", [sent])), 1, "Sent → Accepted");
      // …and once answered, they're final.
      await q.fails("update quotations set title = 'Too late' where id = $1", [sent], LOCKED);
      await q.fails("update quotations set status = 'Sent' where id = $1", [draft], LOCKED);
    });
  });

  it("a Draft can still be answered directly (the app records it as sent at the same time)", async () => {
    await asUser(db, USERS.sara.id, async (q) => {
      const draft = await idOf(q, "QT-3005");
      assert.equal(N(await q("update quotations set status = 'Accepted', sent_at = now(), responded_at = now() where id = $1 returning id", [draft])), 1);
    });
  });

  it("bookings are still created from an accepted quotation (it is only read)", async () => {
    await asUser(db, USERS.sara.id, async (q) => {
      const [qt] = await q(
        `insert into quotations (organization_id, customer_id, recipient, title, destination, valid_until, status, prepared_by)
         values ($1, $2, '{"name":"Amelia Hart"}', 'Porto', 'Porto', current_date + 14, 'Draft', $3) returning id`,
        [ORG, ids["CU-1001"], USERS.sara.id],
      );
      await q(
        `insert into quotation_items (organization_id, quotation_id, position, item_type, description, quantity, unit_price, cost)
         values ($1, $2, 0, 'Flight', 'Flights', 2, 250, 180)`,
        [ORG, qt.id],
      );
      await q("update quotations set status = 'Accepted', sent_at = now(), responded_at = now() where id = $1", [qt.id]);
      const [{ id }] = await q(
        "select create_booking_from_quotation($1, $2, current_date + 60, current_date + 67, current_date + 7, current_date + 30) as id",
        [qt.id, ids["CU-1001"]],
      );
      assert.ok(id);
      assert.equal((await q("select status from quotations where id = $1", [qt.id]))[0].status, "Accepted", "the quotation is untouched");
    });
  });

  it("the service role / SQL editor (no signed-in user) can still correct one, for support", async () => {
    await asOwner(db, async (q) => {
      const [qt] = await q("select id from quotations where code = 'QT-3001' and organization_id = $1", [ORG]);
      assert.equal(N(await q("update quotations set notes = 'Support correction' where id = $1 returning id", [qt.id])), 1);
      assert.ok(N(await q("update quotation_items set cost = cost where quotation_id = $1 returning id", [qt.id])) > 0);
    });
  });

  it("roles that couldn't change quotations still can't (RLS unchanged)", async () => {
    await asUser(db, USERS.leo.id, async (q) => assert.equal(N(await q("update quotations set title = 'x' where code = 'QT-3002' returning id")), 0));
    await asUser(db, USERS.fiona.id, async (q) => assert.equal(N(await q("update quotations set title = 'x' where code = 'QT-3002' returning id")), 0));
    await asUser(db, USERS.sam.id, async (q) => assert.equal(await count(q, "select 1 from quotations"), 0));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("24 · Manual PNR verification (migration 23)", () => {
  /** An Active PNR from the seed, with its booking. */
  const somePnr = async (q) =>
    (await q("select id, booking_id, record_locator, status from pnr_records where status = 'Active' order by record_locator limit 1"))[0];
  const verification = async (q, id) =>
    (await q("select verification_status, verified_at, verified_by, verification_notes, status from pnr_records where id = $1", [id]))[0];

  it("every PNR starts as Pending, and a new one can't be created already verified", async () => {
    await asUser(db, USERS.leo.id, async (q) => {
      assert.equal(await count(q, "select 1 from pnr_records where verification_status <> 'Pending'"), 0);
      const pnr = await somePnr(q);
      const [created] = await q(
        `insert into pnr_records (organization_id, booking_id, record_locator, provider, airline, verification_status, verified_at, verified_by, verification_notes)
         values ($1, $2, 'NEWPNR', 'Manual', 'EK', 'Verified', now(), $3, 'sent by the browser') returning id`,
        [ORG, pnr.booking_id, USERS.leo.id],
      );
      const v = await verification(q, created.id);
      assert.deepEqual([v.verification_status, v.verified_at, v.verified_by, v.verification_notes], ["Pending", null, null, null]);
    });
  });

  it("a ticketing agent records Verified: stamped with who and when, on the timeline, audited", async () => {
    await asUser(db, USERS.leo.id, async (q) => {
      const pnr = await somePnr(q);
      const events = () => count(q, "select 1 from booking_events where booking_id = $1", [pnr.booking_id]);
      const eventsBefore = await events();
      await q("select verify_pnr($1, 'Verified', 'Checked on the Emirates website')", [pnr.id]);
      const v = await verification(q, pnr.id);
      assert.equal(v.verification_status, "Verified");
      assert.equal(v.verified_by, USERS.leo.id, "stamped with the signed-in user, not a value from the browser");
      assert.ok(v.verified_at);
      assert.equal(v.verification_notes, "Checked on the Emirates website");
      assert.equal(v.status, pnr.status, "the PNR's own status is untouched");
      assert.equal(await events(), eventsBefore + 1);
      const [e] = await q("select body from booking_events where booking_id = $1 order by created_at desc limit 1", [pnr.booking_id]);
      assert.equal(e.body, `PNR ${pnr.record_locator} verified — Checked on the Emirates website`);
    });
    await asUser(db, USERS.aisha.id, async (q) => {
      const pnr = await somePnr(q);
      const audits = () => count(q, "select 1 from audit_logs where table_name = 'pnr_records' and record_id = $1", [pnr.id]);
      const before = await audits();
      await q("select verify_pnr($1, 'Verified', null)", [pnr.id]);
      assert.equal(await audits(), before + 1, "admins may verify too, and the change is audited");
    });
  });

  it("Not verified needs a reason; Pending can't be chosen; notes are limited to 500 characters", async () => {
    await asUser(db, USERS.leo.id, async (q) => {
      const pnr = await somePnr(q);
      await q.fails("select verify_pnr($1, 'Not verified', null)", [pnr.id], /Say why the PNR could not be verified/);
      await q.fails("select verify_pnr($1, 'Not verified', '  ')", [pnr.id], /Say why/);
      await q.fails("select verify_pnr($1, 'Pending', 'x')", [pnr.id], /Choose Verified or Not verified/);
      await q.fails("select verify_pnr($1, 'Verified', $2)", [pnr.id, "x".repeat(501)], /at most 500/);
      await q("select verify_pnr($1, 'Not verified', 'Airline has no record of this locator')", [pnr.id]);
      const v = await verification(q, pnr.id);
      assert.equal(v.verification_status, "Not verified");
      assert.equal(v.verification_notes, "Airline has no record of this locator");
      // A later check can change the result (each one stamped and on the timeline).
      await q("select verify_pnr($1, 'Verified', 'Re-checked by phone')", [pnr.id]);
      assert.equal((await verification(q, pnr.id)).verification_status, "Verified");
    });
  });

  it("the verification can't be set or faked by editing the PNR directly", async () => {
    await asUser(db, USERS.leo.id, async (q) => {
      const pnr = await somePnr(q);
      await q(
        "update pnr_records set verification_status = 'Verified', verified_at = now(), verified_by = $2, verification_notes = 'fake' where id = $1",
        [pnr.id, USERS.aisha.id],
      );
      const v = await verification(q, pnr.id);
      assert.deepEqual([v.verification_status, v.verified_at, v.verified_by, v.verification_notes], ["Pending", null, null, null]);

      await q("select verify_pnr($1, 'Verified', 'ok')", [pnr.id]);
      await q("update pnr_records set verification_status = 'Not verified', verification_notes = 'changed' where id = $1", [pnr.id]);
      const after = await verification(q, pnr.id);
      assert.equal(after.verification_status, "Verified");
      assert.equal(after.verification_notes, "ok");
    });
  });

  it("changing the PNR's identity resets it to Pending; other edits keep the result", async () => {
    await asUser(db, USERS.leo.id, async (q) => {
      const pnr = await somePnr(q);
      await q("select verify_pnr($1, 'Verified', 'ok')", [pnr.id]);
      await q("update pnr_records set ticketing_deadline = now() + interval '3 days' where id = $1", [pnr.id]);
      assert.equal((await verification(q, pnr.id)).verification_status, "Verified", "deadline change keeps it");
      await q("update pnr_records set status = 'Ticketed' where id = $1", [pnr.id]);
      assert.equal((await verification(q, pnr.id)).verification_status, "Verified", "reservation status is separate");

      for (const change of ["record_locator = 'ZZZ999'", "airline_locator = 'AIR123'", "airline = 'QR'", "provider = case when provider = 'Sabre' then 'Travelport'::pnr_provider else 'Sabre'::pnr_provider end"]) {
        await q("select verify_pnr($1, 'Verified', 'ok')", [pnr.id]);
        await q(`update pnr_records set ${change} where id = $1`, [pnr.id]);
        const v = await verification(q, pnr.id);
        assert.deepEqual([v.verification_status, v.verified_at, v.verified_by, v.verification_notes], ["Pending", null, null, null], change);
      }
    });
  });

  it("only admins and ticketing agents may verify (the same people who manage PNRs)", async () => {
    for (const user of [USERS.sara, USERS.maya, USERS.fiona, USERS.sam]) {
      await asUser(db, user.id, async (q) => {
        const [pnr] = await q("select id from pnr_records limit 1");
        const id = pnr?.id ?? "00000000-0000-0000-0000-000000000000";
        await q.fails("select verify_pnr($1, 'Verified', 'x')", [id], /You cannot verify this PNR/);
      });
    }
    await asAnon(db, async (q) => {
      await q.fails("select verify_pnr('00000000-0000-0000-0000-000000000000', 'Verified', 'x')", [], /permission denied|cannot verify/);
    });
  });

  it("an admin of another agency can't verify this agency's PNR", async () => {
    let pnrId;
    await asUser(db, USERS.leo.id, async (q) => (pnrId = (await somePnr(q)).id));
    await asUser(db, USERS.nora.id, async (q) => {
      await q.fails("select verify_pnr($1, 'Verified', 'x')", [pnrId], /You cannot verify this PNR/);
    });
  });

  it("tickets don't depend on it: a ticket can still be issued on a Pending PNR, and issuing doesn't change verification", async () => {
    await asUser(db, USERS.leo.id, async (q) => {
      const [t] = await q(
        `select b.id booking_id, p.id pnr_id, x.id passenger_id from bookings b
         join pnr_records p on p.booking_id = b.id and p.status = 'Active'
         join passengers x on x.booking_id = b.id
         where b.status in ('Confirmed', 'Ticketed')
           and not exists (select 1 from tickets k where k.passenger_id = x.id and k.status = 'Issued')
         limit 1`,
      );
      assert.ok(t, "a confirmed booking with an active PNR and an unticketed passenger exists in the seed");
      assert.equal((await verification(q, t.pnr_id)).verification_status, "Pending");
      await q("select issue_ticket($1, $2, $3, '1761234567890', 'EK', 500, 80, now())", [t.booking_id, t.passenger_id, t.pnr_id]);
      assert.equal((await verification(q, t.pnr_id)).verification_status, "Pending");
    });
  });

  it("the database keeps results consistent, even for the service role", async () => {
    await asOwner(db, async (q) => {
      const [pnr] = await q("select id from pnr_records where organization_id = $1 limit 1", [ORG]);
      await q.fails("update pnr_records set verification_status = 'Verified' where id = $1", [pnr.id], /verified_at_matches_status/);
      await q.fails("update pnr_records set verification_status = 'Not verified', verified_at = now() where id = $1", [pnr.id], /not_verified_needs_notes/);
      assert.equal(N(await q("update pnr_records set verification_status = 'Verified', verified_at = now() where id = $1 returning id", [pnr.id])), 1,
        "the service role (imports, support) is not limited to verify_pnr()");
    });
  });
});
