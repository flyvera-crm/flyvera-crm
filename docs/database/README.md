# FLYVERA CRM — Database (Supabase / PostgreSQL)

Status: **the app runs on Supabase.** Every module (customers, leads, quotations, bookings, payments, tickets,
invoices, refunds, team, dashboard, settings, suppliers) reads and writes the database through Row Level Security.
Migrations 01–21 are applied to the **staging** project only; production has not been set up yet — see
[`docs/GO-LIVE.md`](../GO-LIVE.md). No credentials exist in this repository.

## Contents
- `supabase/migrations/` — 21 ordered migrations (the only source of truth for the schema)
- `supabase/seed.sql` — **development data only** (generated; never load into production)
- `supabase/scripts/build-seed.mjs` — builds `seed.sql` from the app's demo data (`npm run db:seed:build`)
- `supabase/tests/` — PGlite test suite (`npm run db:test`) + a **test-only** Supabase stand-in (`supabase-shim.sql`)
- `tests/unit/` — unit tests for the app's business rules (`npm run test:unit`)
- `supabase/config.toml` — local Supabase CLI settings (no secrets)

## Migrations
| # | File | Contents |
|---|------|----------|
| 01 | extensions_and_schemas | pgcrypto, `private` schema (never exposed through the API) |
| 02 | enums | roles + every status list, using the exact labels the screens show |
| 03 | tenancy | organizations, profiles, members + role, teams, invitations, readable codes, invite-only sign-up, last-admin guard |
| 04 | crm | customers, customer_travel_documents (encrypted), leads, lead_activities, tasks |
| 05 | sales | flight_searches, flight_offers, quotations, quotation_items |
| 06 | operations | suppliers, bookings, booking_services, booking_events, passengers, pnr_records, booking_segments, tickets, ticket_documents |
| 07 | finance | invoices, invoice_lines, payments, payment_transactions, refunds, supplier_transactions + money guards |
| 08 | messaging_ai | whatsapp_conversations, whatsapp_messages, ai_actions |
| 09 | audit | append-only audit_logs + change triggers (sensitive values redacted) |
| 10 | rls_policies | access helpers, grants, ~90 RLS policies |
| 11 | sensitive_data | passport encryption, reveal/save functions (audited) |
| 12 | views | booking_financials, quotation_totals, customer_stats, money_ledger |
| 13 | storage | private buckets `ticket-documents`, `travel-documents` + policies |
| 14 | integrity_hardening | locked creator/requester columns, reviewer & verifier stamped by the database, archived records hidden from non-admins + archive functions, role filter on `quotation_totals` |
| 15 | bookings_and_payment_corrections | `create_booking_from_quotation()` (atomic); `correct_payment()` — Finance corrects a payment only with a reason (before/after + reason in the audit log); direct payment edits revoked |
| 16 | ticketing_integrity | `issue_ticket()` only with real issuance details on confirmed bookings with an active PNR; `change_ticket_status()` with a reason; links kept inside one booking; direct ticket writes revoked |
| 17 | invoices | drafts unnumbered until `issue_invoice()`; one active invoice per booking; issued invoices frozen; `create_invoice()`, `refresh_invoice_draft()`, `void_invoice()` (reason required); customer and passengers snapshotted |
| 18 | refund_requests | `request_refund()` → `approve_refund()` (requested amount or less) → `pay_refund()`, or `reject_refund()` / `withdraw_refund()`; `record_paid_refund()` (one step, marked "recorded directly"); separation of duties; direct refund writes revoked |
| 19 | team_access | invitations with name, team, revoke and send tracking; access granted when the invitation is **accepted** (email confirmed); `invite_member()`, `change_member_role()` and `set_member_status()` (reason; not yourself; open work handed to a colleague), `team_directory()`; direct member/invitation writes revoked |
| 20 | agency_settings | `update_agency_settings()` (admins; every value validated); direct `organizations` updates revoked; `invoices.issuer` freezes the agency details, bank details and terms when an invoice is issued |
| 21 | gap_fills | customers with active bookings / quotations that became bookings can't be archived; lead stage changes logged automatically; timeline lines that mention money (`booking_events.mentions_money`) hidden from roles without money access |

## Relationships (main links)
```
organizations ─┬─ organization_members ── profiles (= auth.users)      teams ── team_members
               ├─ customers ─┬─ customer_travel_documents
               │             ├─ leads (customer_id once converted) ── lead_activities
               │             ├─ whatsapp_conversations ── whatsapp_messages
               │             └─ bookings
               ├─ leads / customers ── quotations ── quotation_items ── flight_offers ── flight_searches
               ├─ quotations ── bookings (one booking per accepted quotation)
               └─ bookings ─┬─ booking_services ── suppliers ── supplier_transactions
                            ├─ booking_events (timeline)
                            ├─ passengers ── tickets ── ticket_documents
                            ├─ pnr_records ── booking_segments
                            ├─ payments ── payment_transactions   ├─ refunds
                            └─ invoices ── invoice_lines
tasks, ai_actions → lead / customer / quotation / booking / conversation        audit_logs → everything
```
Every child table references its parent with a **composite key `(parent_id, organization_id)`**, so a
record can never be linked to another organization's data. Readable codes (`CU-1025`, `LD-2062`,
`QT-3009`, `FV-10484`, `RC-10479-2`, `INV-2026-0004`) are assigned by triggers.

## Roles & access (Row Level Security)
| Area | Admin | Sales Manager | Sales Agent | Ticketing | Finance | Support |
|---|---|---|---|---|---|---|
| Customers | all | team's + unassigned | **assigned only** | with bookings (read) | with bookings (read) | all (edit, can't re-assign) |
| Leads | all | team's + unassigned | assigned only | – | – | all (read; can create) |
| Quotations | all | team's | own customers/leads | read | read | – |
| Bookings | all | team's | own customers | all (manage) | read + refund decisions | read only |
| Prices, costs, payments, invoices | all | team's (read) | own (read) | read | **manage** | – |
| Refunds | all | request | request | request | **approve & pay** | – |
| Supplier payments | all | – | – | read | manage | – |
| Supplier directory | manage | read | read | manage | manage | – |
| Booking timeline lines with amounts | all | team's | own | all | all | **hidden** |
| Passengers, passports | all | team's | own customers | all | – | – |
| PNRs, segments, tickets | all | team's (read) | own (read) | **manage** | read tickets | read PNRs/segments |
| WhatsApp | all | team's + unassigned | own | – | – | all |
| Audit log | read | – | – | – | – | – |
| Team, invitations, agency settings | manage | directory | directory | directory | directory | directory |

Rules live in `private.*` functions (one place per rule). Logged-out visitors (`anon`) have **no**
privileges. Disabled members lose all access. There is **no public sign-up**: a user gets access only if
an admin created an invitation for their email.

## Archiving (soft delete)
Customers, leads and quotations are archived by setting `deleted_at`, not deleted. Since migration 14:

- **Archived rows are visible to admins only.** Restrictive RLS policies hide rows with `deleted_at` set
  from every other role, and only admins can edit them.
- **Non-admins cannot archive with a plain `update … set deleted_at`.** PostgreSQL checks the updated row
  against the read policies, and an archived row would be hidden from them, so the update is rejected
  with a row-level security error. They use the functions below instead.
- **Admins** can archive with the functions or a plain update, and **restore** with
  `update … set deleted_at = null`.

| Function | Parameter | Archives |
|---|---|---|
| `archive_customer` | `p_customer_id uuid` | a customer |
| `archive_lead` | `p_lead_id uuid` | a lead |
| `archive_quotation` | `p_quotation_id uuid` | a quotation |

All three behave the same way:
- Return nothing (`void`). They set `deleted_at = now()` on the one row.
- Allowed for whoever may **edit** that record under the existing rules (`private.can_write_customer`,
  `private.can_write_lead`, `private.can_write_quotation`):
  - customers: admin and support (any), sales manager (team's + unassigned), sales agent (assigned only);
  - leads and quotations: admin, sales manager and sales agent within their scope (support cannot).
- Fail with `You cannot archive this customer.` / `…lead.` / `…quotation.` (error code `42501`) when
  the record doesn't exist, is already archived, or the caller isn't allowed to edit it.
- Callable by signed-in users only (execute revoked from `anon`). They run as `SECURITY DEFINER` with
  a pinned `search_path`; the audit log still records the caller as the actor.

Since migration 21, `archive_customer` also refuses a customer with active bookings (not completed or
cancelled; the message names them), and `archive_quotation` refuses a quotation that became a booking.
In the app: **Archive** on the customer, lead and quotation screens; admins restore from **Archived** on each list.

From the frontend:
```ts
const { error } = await supabase.rpc("archive_customer", { p_customer_id: customerId });
```

## Sensitive data
- Passport/ID numbers are **encrypted (pgcrypto AES-256)** with a key in **Supabase Vault**
  (`flyvera_document_key`). Only the last 4 characters are stored readable.
- The encrypted columns cannot be read or written by API users. **Every role, including admin, must use**
  `reveal_customer_travel_document()`, `reveal_passenger_document()`, `save_customer_travel_document()`,
  `set_passenger_document()` or `copy_customer_document_to_passenger()`. Each checks the role, and every
  reveal writes an audit entry.
- When connecting the frontend, select **explicit columns** from `passengers` and
  `customer_travel_documents` (`select *` is refused because of the protected column).
- Audit entries replace passport data and dates of birth with `[encrypted]` / `[redacted]`.
- Files live in private buckets, in `<organization_id>/<booking_or_customer_id>/` folders.

### Encryption key (production, once)
In the Supabase dashboard SQL editor, run (generate your own random 40+ character value; never commit it):
```sql
select vault.create_secret('<long random value>', 'flyvera_document_key', 'Passport encryption key');
```
Losing this key makes stored passport numbers unreadable: back it up in your password manager.

## Development seed
`seed.sql` reproduces the app's demo data (24 customers, 18 leads, 8 quotations, 8 bookings, 9 payments)
plus staff, teams, passengers, PNRs, tickets, invoices, WhatsApp and AI samples, and a second test agency.
All people are fictional (`*.test` emails); passports use a **development-only** key.
Dev users (password `flyvera-dev-password`, local only): Aisha (admin), Maya (sales manager, Team Atlas),
Sara & Daniel (sales agents, Team Atlas), Priya (sales agent, Team Horizon), Leo (ticketing), Fiona (finance),
Sam (support), Tom (disabled), Nora (admin of the test agency).

## Testing
```
npm run db:test
```
Creates an in-memory PostgreSQL (PGlite), applies the stand-in + all migrations + seed, and runs **102 tests**
in 21 sections: structure, seed totals vs the app, relationships and money rules, agency isolation, each of
the six roles, passport protection, audit log, storage, and the rules of migrations 14–21 (archiving,
booking creation and payment corrections, ticketing, invoices, refund requests, team & access, dashboard
data, agency settings, gap fills).

```
npm run test:unit
```
Runs the unit tests for the app's pure business rules (dashboard figures, CSV exports, settings, suppliers,
lead activity, invoice wording, security headers, navigation) with Node's test runner — no database needed.

### What PGlite tests do NOT cover
PGlite is real PostgreSQL, but `supabase/tests/supabase-shim.sql` only imitates Supabase. Not tested:
real Auth/JWT handling, the PostgREST API layer, the Storage API and signed URLs, Vault's encryption at
rest, Supabase's exact default grants and Postgres version (PGlite is PG 18; Supabase runs 15/17),
performance with real data volumes, and webhooks. **Before going live, apply the migrations to a Supabase
staging project and test the main flows with real logins for every role.**

## Going live
Follow [`docs/GO-LIVE.md`](../GO-LIVE.md). In short: production environment variables and Auth settings,
`db push` of migrations 01–21 **without the seed**, the Vault passport key, then the first agency and admin.
