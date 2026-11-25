# FLYVERA CRM

A private CRM for **FLYVERA TRAVEL**: customers, leads, quotations, bookings, payments, tickets, invoices,
refunds, suppliers and team — on [Next.js 16](https://nextjs.org) and [Supabase](https://supabase.com)
(PostgreSQL with Row Level Security).

> **Status:** all modules run on Supabase and are tested on the **staging** project. Production is not set up
> yet — see [`docs/GO-LIVE.md`](docs/GO-LIVE.md).

## Modules
| Area | What it does |
|---|---|
| Dashboard & Reports | Live figures for each role, revenue, pipeline, departures, activity; CSV reports |
| Customers | Profiles, encrypted passports (audited reveal), trip history, archive, CSV export (admins) |
| Leads | Board and list, activity log, automatic stage history, convert to customer, archive |
| Quotations | Builder, print/PDF with the agency letterhead, accept → booking, archive |
| Bookings | Created from accepted quotations, status flow, services linked to suppliers, timeline |
| Tickets | Passengers, PNRs, segments, issued tickets (only with real details), e-ticket files |
| Payments | Receipts, Finance corrections with a reason, refunds queue, supplier payments, CSV export |
| Invoices | Numbered when issued, frozen once issued, PDF with "How to pay", CSV export |
| Refund requests | Request → approve → pay (separation of duties), reject or withdraw |
| Suppliers | Directory of airlines, hotels and partners |
| Team & Access | Invitations by email, six roles, disable with handover of open work, teams |
| Settings | Agency profile, bank details, defaults and terms (admins); My profile (everyone) |

WhatsApp, AI Assistant and Flights search are planned and hidden from the menu.

Roles: **Admin, Sales Manager, Sales Agent, Ticketing Agent, Finance Manager, Support Agent**. What each role
can see and do is enforced by the database — see [`docs/database/README.md`](docs/database/README.md).

## Getting started (local, against the staging project)
Requirements: **Node.js 24 or newer** (developed on Node 26), npm, and access to the staging Supabase project.

1. Install dependencies:
   ```
   npm install
   ```
2. Create `.env.local` in the project root (it is ignored by Git — never commit it):
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<staging publishable key>
   SUPABASE_SERVICE_ROLE_KEY=<staging secret / service_role key>
   ```
   - The URL and publishable key are in the Supabase dashboard under **Project Settings → API / API Keys**.
   - The service-role key is only needed to send invitation emails. It is used on the server only; never give
     it a `NEXT_PUBLIC_` name and never share it.
   - Use the **staging** project's values for development, never production's.
3. Start the app and open http://localhost:3000:
   ```
   npm run dev
   ```
   Sign in with an account that has been invited to the agency. There is no public sign-up.

Next.js reads `.env.local` only when it starts: restart `npm run dev` after changing it.

## Scripts
| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / run it |
| `npm run lint` | ESLint |
| `npm run test:unit` | Unit tests for the business rules (no database needed) |
| `npm run db:test` | Database tests: every migration and the dev seed in an in-memory PostgreSQL (PGlite) — roles, money rules, audit, migrations 14–21 |
| `npm run db:seed:build` | Regenerates `supabase/seed.sql` from the demo data (development only) |

Before every commit: `npm run test:unit`, `npm run db:test`, `npx tsc --noEmit`, `npm run lint` and
`npm run build` should all pass.

## Project structure
```
src/app/            pages and routes (the (crm) group holds the signed-in screens)
src/components/     screens and UI by module
src/lib/            business rules (pure, unit-tested), data loaders, Server Actions (src/lib/actions)
src/config/         navigation, roles, form options
supabase/migrations database schema — the only source of truth (01–21)
supabase/tests/     database tests (PGlite)
tests/unit/         unit tests
docs/               database guide and production runbook
```

## Database
- Schema changes are **new migration files only** — never edit a migration that has been applied.
- `supabase/seed.sql` is **development data only** (demo logins with a known password). Never load it into
  staging or production, and never run `supabase db push --include-seed` or `supabase db reset` against a
  hosted project.
- Before any `supabase db push`, check which project the CLI is linked to (`supabase/.temp/project-ref`) and
  run a `--dry-run` first.

Full details: [`docs/database/README.md`](docs/database/README.md).

## Going live
Follow [`docs/GO-LIVE.md`](docs/GO-LIVE.md): hosting and environment variables, Supabase Auth and email
settings, migrations without the seed, the passport encryption key, the first agency and admin, and a
smoke test.

## Working on the code
Work on a feature branch, open a pull request into `main`, and merge only after the checks above pass and the
changes have been tested on staging. `main` is what gets deployed.
