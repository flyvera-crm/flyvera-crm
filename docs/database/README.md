# FLYVERA CRM — Database (Supabase / PostgreSQL)

Status: **schema, security, seed and tests are ready. Nothing is connected yet.**
The app still runs on browser demo data. No credentials exist in this repository.

## Contents
- `supabase/migrations/` — 13 ordered migrations (the only source of truth for the schema)
- `supabase/seed.sql` — **development data only** (generated; never load into production)
- `supabase/scripts/build-seed.mjs` — builds `seed.sql` from the app's demo data (`npm run db:seed:build`)
- `supabase/tests/` — PGlite test suite (`npm run db:test`) + a **test-only** Supabase stand-in (`supabase-shim.sql`)
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
| Passengers, passports | all | team's | own customers | all | – | – |
| PNRs, segments, tickets | all | team's (read) | own (read) | **manage** | read tickets | read PNRs/segments |
| WhatsApp | all | team's + unassigned | own | – | – | all |
| Audit log | read | – | – | – | – | – |
| Team, invitations, settings | manage | read | read | read | read | read |

Rules live in `private.*` functions (one place per rule). Logged-out visitors (`anon`) have **no**
privileges. Disabled members lose all access. There is **no public sign-up**: a user gets access only if
an admin created an invitation for their email.

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
Creates an in-memory PostgreSQL (PGlite), applies the stand-in + all migrations + seed, and runs 56 tests:
structure, seed totals vs the app, relationships and money rules, agency isolation, each of the six roles,
passport protection, audit log and storage.

### What PGlite tests do NOT cover
PGlite is real PostgreSQL, but `supabase/tests/supabase-shim.sql` only imitates Supabase. Not tested:
real Auth/JWT handling, the PostgREST API layer, the Storage API and signed URLs, Vault's encryption at
rest, Supabase's exact default grants and Postgres version (PGlite is PG 18; Supabase runs 15/17),
performance with real data volumes, and webhooks. **Before going live, apply the migrations to a Supabase
staging project and test the main flows with real logins for every role.**

## Going live (later, not done yet)
1. Create a Supabase project; keep URL/keys in `.env.local` (ignored by git). Never commit the service-role key.
2. `supabase link` then `supabase db push` (applies migrations only; **do not** load `seed.sql`).
3. Create the Vault encryption key (above).
4. Create the FLYVERA organization and the first admin with the service role, then invite staff.
5. Test every role on staging, then connect the screens module by module.
