# FLYVERA CRM — Going live (production runbook)

**Database status (checked 27 Nov 2026):** the production Supabase project (`flyvera-crm`) and staging
(`flyvera-crm-staging`) both have **migrations 01–25** applied — see the log in section 3. Every other step
below changes real systems: do them in order, one at a time, and stop if anything looks different from what
is described. Nothing here is automated.

**Never, on production:** run `supabase db push --include-seed`, `supabase db reset`, or load
`supabase/seed.sql` (it contains demo logins with a known password). Never put real keys in this repository.

---

## 0. Before you start
- [ ] `feature/supabase-auth` is reviewed and merged into `main`; you deploy from `main`.
- [ ] All checks pass on `main`: `npm run test:unit`, `npm run db:test`, `npx tsc --noEmit`, `npx eslint src supabase tests`, `npm run build`.
- [ ] The staging browser tests pass for every role.
- [ ] A password manager entry is ready for: the production database password, the publishable key, the
      service-role key, the Server Actions key, the Vault passport key, and the SMTP credentials.
- [ ] Production Supabase project: on a plan with **daily backups / point-in-time recovery** switched on.
- [ ] The **"before" DNS snapshot** of `flyvera.us` is recorded (section 1, step 1).

## 1. Hosting: Hostinger Node.js Web App at `crm.flyvera.us`
The CRM runs as its **own website** on the existing Hostinger Business/Unlimited plan, on the subdomain
**`crm.flyvera.us`**. The main website `flyvera.us` and its email stay exactly as they are.

**Never, while doing this:** delete, edit, rebuild or "convert" the `flyvera.us` website; change the
nameservers; change or delete the `flyvera.us` A, MX, TXT (SPF) or any other existing DNS record; connect
the root domain `flyvera.us` (or `www`) to the Web App. Every step below is on the **`crm.flyvera.us`**
website only. Hostinger has no Stop/Delete button for a Node app: deleting a *website* deletes its app, so
double-check the website name before using any menu.

### Environment variables
| Variable | Where it comes from | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Production project → Project Settings → API | no (public) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Production project → Project Settings → API Keys (publishable) | no (public; RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY` | Production project → Project Settings → API Keys (secret / service_role) | **yes** — Hostinger's environment variables only, never `NEXT_PUBLIC_`, never committed |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | Generate once (below); base64 of 16, 24 or 32 random bytes (32 recommended). **Required: the build stops without it** | **yes** — same rules as the service-role key |

The service-role key is used on the server only, to send invitation emails and to remove revoked,
unaccepted logins — always after checking that the caller is an admin.
No AI service or AI key is needed: the Flights page reads typed trip requests with the CRM's own code
(`src/lib/flight-request-parser.ts`). If `ANTHROPIC_API_KEY` is still set in Hostinger from an earlier
version, it is no longer used and can be deleted.

The Server Actions key keeps the app's action IDs the same from one build to the next. Without it, every
deploy gets a random key and pages already open in a browser fail with "Server Action not found" (409);
`scripts/check-build-env.mjs` stops `npm run build` when it is missing or malformed (it never prints the
value). Generate it once, store it in the password manager, and **keep the same value on every deploy**:
```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
Changing it later only makes open pages fail once (users reload); it doesn't affect data.
Use the **production** project's values here — never staging's, and never upload the local `.env.local`
(it holds staging values).

### Step 1 — "before" DNS snapshot (read-only)
In PowerShell (read-only lookups), and save the output with the date:
```
foreach ($t in "NS","SOA","A","AAAA","MX","TXT") { Resolve-DnsName flyvera.us -Type $t -Server cosmos.dns-parking.com -DnsOnly }
Resolve-DnsName www.flyvera.us -Type CNAME -Server cosmos.dns-parking.com -DnsOnly
Resolve-DnsName _dmarc.flyvera.us -Type TXT -Server cosmos.dns-parking.com -DnsOnly
Resolve-DnsName autoconfig.flyvera.us -Type CNAME -Server cosmos.dns-parking.com -DnsOnly
Resolve-DnsName autodiscover.flyvera.us -Type CNAME -Server cosmos.dns-parking.com -DnsOnly
Resolve-DnsName crm.flyvera.us -Type A -Server cosmos.dns-parking.com -DnsOnly
```
(`cosmos.dns-parking.com` is Hostinger's nameserver, so the answers aren't cached. Windows can't look up CAA
records; check them with `https://cloudflare-dns.com/dns-query?name=flyvera.us&type=CAA` and the header
`accept: application/dns-json`.)

Snapshot taken 25 Nov 2026:
| Record | Value | After go-live |
|---|---|---|
| NS | `cosmos.dns-parking.com`, `nova.dns-parking.com` (Hostinger) | **identical** |
| MX | `5 mx1.hostinger.com`, `10 mx2.hostinger.com` | **identical** |
| TXT (SPF) | `v=spf1 include:_spf.mail.hostinger.com ~all` | **identical** |
| `_dmarc` TXT | `v=DMARC1; p=none` | **identical** |
| `www` CNAME | `www.flyvera.us.cdn.hstgr.net` | **identical** |
| `autoconfig` / `autodiscover` CNAME | `autoconfig.mail.hostinger.com` / `autodiscover.mail.hostinger.com` | **identical** |
| CAA | none (so nothing blocks the SSL certificate for `crm`) | **still none** |
| A / AAAA (website) | Hostinger CDN addresses that **change on almost every lookup** (e.g. `145.79.24.x`, `145.79.29.x`) | **not compared** — check that `https://flyvera.us` loads instead |
| SOA serial | `2026111901` | **increases** — normal, any DNS edit bumps it |
| `crm.flyvera.us` | *does not exist* | **exists** — the only new name |

### Step 2 — a `production` branch
Hostinger redeploys automatically on every push to the connected branch, so connect a dedicated
**`production`** branch, not `main`. Merging into `main` then never goes live by accident.
```
git switch main
git pull --ff-only
git switch -c production
git push -u origin production
```
(Only after `main` has passed every check in section 0.)

### Step 3 — create the Web App (hPanel)
1. **Websites → Create site → Web App** (a new website — not "Add" on `flyvera.us`).
2. **Import a Git repository → connect GitHub** with the Hostinger GitHub App. When GitHub asks, give it
   access to **only the `flyvera-crm` repository**. Pick `flyvera-crm/flyvera-crm`, branch **`production`**.
3. **Domain:** choose to use a **subdomain**, and enter **`crm.flyvera.us`** (its own website, not a subfolder).
   If hPanel offers to use or replace `flyvera.us` itself, stop — that is the wrong option.
4. **Build settings:**
   | Setting | Value |
   |---|---|
   | Framework / application type | Next.js (`next`) |
   | Node.js version | **24** |
   | Root directory | the repository root (leave empty) |
   | Package manager | npm (detected from `package-lock.json`) |
   | Build script | `build` |
   | Output directory | `.next` (entry file: not used for Next.js) |
5. **Environment variables — before the first build.** Add the variables above (one by one; don't use
   "Import .env" with a local file). `NEXT_PUBLIC_*` values are built into the app, so they must exist before
   the build; any later change to them needs a redeploy (saving variables in hPanel redeploys).
6. **Deploy**, and watch the build log.

### Step 4 — first-deploy checks (build log and app)
- [ ] The install step includes the build tools (`typescript`, `tailwindcss`, which are dev dependencies).
      If the build fails with "Cannot find module 'typescript'" (or tailwind), the install skipped dev
      dependencies — fix that in the build settings / environment before retrying.
- [ ] Hostinger reports that it applied standalone output to `next.config.ts` and the build finishes.
- [ ] **Runtime Logs** show the server started, with no "Supabase is not configured" error.
- [ ] Domain connected and **SSL installed** for `crm.flyvera.us` (can take up to 24 hours for DNS/SSL).
- [ ] Redirects stay on **https**: `https://crm.flyvera.us/dashboard` while signed out goes to
      `https://crm.flyvera.us/login?next=%2Fdashboard` (signing in and out is checked in section 7, once the first admin exists).
      If any redirect goes to `http://` or an internal address, stop and fix it before inviting anyone.
- [ ] Security headers present on any page (browser dev tools → Network → Headers):
      `X-Frame-Options: DENY`, `Strict-Transport-Security`, `Content-Security-Policy`.

### Step 5 — "after" DNS check
Run the same lookups as step 1 and compare with the snapshot table:
- [ ] Every row marked **identical** (NS, MX, SPF, `_dmarc`, `www`, `autoconfig`/`autodiscover`) matches exactly,
      and there are still no CAA records.
- [ ] `crm.flyvera.us` now resolves — the only new name. A higher SOA serial is expected.
- [ ] The website addresses (A/AAAA) are **not** compared — they rotate through Hostinger's CDN. Instead,
      `https://flyvera.us` and `https://www.flyvera.us` load as before.
- [ ] Send and receive one test email on a `@flyvera.us` mailbox.

If any **identical** row changed, or `flyvera.us` doesn't load, stop and restore the recorded values in
hPanel → Domains → DNS / Nameservers.

### Hostinger limits to keep in mind
| Limit | What it means for the CRM |
|---|---|
| Process limit shared by **all** sites on the plan (Business: 120; a Next.js app uses ~10–11) | If reached, sites can answer **503**. Watch the plan's usage graphs; Cloud plans raise the limit |
| RAM / CPU for Node apps not published | Watch the CPU/RAM graphs after launch |
| App sleeps after a period without traffic | The first request afterwards is slower; no data is lost |
| 120-second limit per request | Fine (an invoice PDF takes about a second; reading a flight request takes a few milliseconds) |
| No inbound WebSockets, no always-running background workers | Not used by the CRM today; matters for future WhatsApp/AI features |
| Builds: 15 min install + 15 min build; up to 2 earlier versions kept | Ample (about a minute locally) |

### Releasing updates later
1. Work on a feature branch → pull request into `main` → checks pass and staging is tested → merge.
2. Bring `production` up to `main` and push — this deploys:
   ```
   git switch production
   git pull --ff-only
   git merge --ff-only origin/main
   git push
   ```
3. Watch the build log and run the smoke test (section 7) briefly.
New migrations must be applied to the production database (section 3) **before** pushing app code that needs them.

## 2. Supabase Auth (production project dashboard)
- [ ] **Authentication → Sign In / Providers → Email:** enabled; **"Allow new users to sign up" OFF**;
      **"Confirm email" ON**; minimum password length **10**.
- [ ] **Authentication → URL Configuration:** Site URL `https://crm.flyvera.us`; Redirect URLs
      `https://crm.flyvera.us/**`.
- [ ] **Authentication → Emails → Templates:**
  - Invite user — link: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`
  - Reset password — link: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`
- [ ] **Authentication → Emails → SMTP settings:** your email provider (the built-in sender only allows a
      few emails per hour). Option: a **new** Hostinger mailbox such as `noreply@flyvera.us` (hPanel → Emails;
      creating a mailbox doesn't change existing mailboxes or MX records) with the SMTP host, port and
      security shown in hPanel → Emails → *Connect apps & devices*; check Hostinger's sending limits.
      Send yourself a test reset email afterwards.

## 3. Database: migrations (no seed)
Always staging first, then production, and only one new migration (or a known set) at a time.

1. **Identify the projects.** `npx supabase projects list` shows both: `flyvera-crm` (production) and
   `flyvera-crm-staging`. Note each ref from that listing; the local `.env.local` URL and
   `supabase/.temp/project-ref` must both show **staging's** ref.
2. **Staging dry run, then apply** (the CLI is linked to staging):
   ```
   npx supabase db push --remote --dry-run
   npx supabase db push --remote --yes
   ```
3. **Production dry run** — target production by its ref, so the staging link on this computer never changes:
   ```
   npx supabase db push --remote=<production project ref> --dry-run
   ```
   It must print `Target: project <production project ref> (not the linked project)` and list **exactly**
   the new migration file(s), with no seeds. (When linked, the CLI labels every hosted project "production";
   go by the name and ref, never the label.)
4. **Apply to production**, without the seed:
   ```
   npx supabase db push --remote=<production project ref> --yes
   ```
5. **Check:** the same dry run now says "Remote database is up to date", and
   `npx supabase migration list --remote=<production project ref>` shows every file with a remote timestamp.
6. Apply each migration **before** deploying the app code that needs it.

### Migration log
| Migrations | Staging | Production |
|---|---|---|
| 01–24 | applied (already present on 27 Nov 2026) | applied (already present on 27 Nov 2026) |
| 25 `ai_flight_requests` | applied 27 Nov 2026 | applied 27 Nov 2026 |

Migration 25 was checked on both projects afterwards: the `Flight request` AI action kind,
`ai_actions.flight_search_id` and its link to flight searches, and the `ai_actions_guard_flight_request`
trigger exist, and signed-in and anonymous users can't call the guard function directly.

## 4. Passport encryption key (once, before anyone saves a passport)
In the production **SQL editor** (generate your own random value of 40+ characters; never commit it):
```sql
select vault.create_secret('<long random value>', 'flyvera_document_key', 'Passport encryption key');
```
Store the value in the password manager. **Losing it makes stored passport numbers unreadable.**

## 5. The agency and the first admin
The app can't create an agency or its first admin (there is no public sign-up).

**Primary admin and contact email: `louispeterlouis00@gmail.com`** — the owner's login for the first admin account and the
owner's contact address. It is **not** the transactional sender: invitation and password emails are sent from
the SMTP mailbox in section 2 (e.g. `noreply@flyvera.us`) and are received at this address.

In the **SQL editor**:
```sql
-- 1. The agency (slug: lowercase letters, digits, dashes)
insert into public.organizations (name, slug, base_currency, timezone)
values ('FLYVERA TRAVEL', 'flyvera', 'USD', 'UTC')
returning id;

-- 2. An admin invitation for the owner (use the id returned above; email in lowercase)
insert into public.organization_invitations (organization_id, email, full_name, role)
values ('<organization id>', 'louispeterlouis00@gmail.com', '<Owner Name>', 'admin');
```
3. **Authentication → Users → Add user:** `louispeterlouis00@gmail.com` and a strong password, **"Auto Confirm User" on**.
   The database grants admin access when a confirmed login matches a valid invitation.
4. Check:
   ```sql
   select u.email, m.role, m.status
   from public.organization_members m join auth.users u on u.id = m.user_id;
   ```
   One row: the owner, `admin`, `active`.

## 6. First sign-in and setup (in the app, as the owner)
- [ ] Sign in at `https://crm.flyvera.us/login`; change the password under Settings → My profile → Change password if you like.
- [ ] **Settings → Agency:** trading and legal name, address, phone, email, **TRN** (invoices say "Tax invoice"
      only when a TRN is set), IATA number, **bank details**, defaults and terms. Check the preview.
- [ ] **Team → Teams:** create the teams. **Team → Invite person** for each colleague with the right role and team.
- [ ] **Suppliers:** add the main airlines, hotels and partners.

## 7. Smoke test (production, with your own records)
- [ ] Signing in and out stays on `https://crm.flyvera.us` (never `http://` or an internal address).
- [ ] An invited colleague receives the email, sets a password and lands in the CRM with the right role.
- [ ] Forgot password sends an email whose link opens "Choose a new password".
- [ ] Customer → quotation → print (letterhead shows) → accept → booking (deposit/balance dates follow Settings).
- [ ] Record a payment → receipt prints → create and issue an invoice → PDF downloads with "How to pay".
- [ ] Add a passport (proves the Vault key works) and reveal it (an audit entry appears).
- [ ] **Flights:** as an admin, sales or ticketing user, the "Describe the trip" panel shows the readings left
      today (50 per person); a typed request with no personal details becomes search details (plus questions
      about anything unclear) to review before saving; a request containing an e-mail address or phone number
      is refused. A finance or support colleague doesn't see the panel. Also try a multi-city request
      ("Dubai to London on 15 Jan, then London to Paris on 20 Jan") and one with baggage and fare conditions
      ("2 x 23kg, refundable, direct"): they are saved as the customer's requests, never as allowances or fares.
      After saving, each one appears at once under **Saved searches** on the same page.
- [ ] Dashboard shows the payment; a support-role colleague sees no amounts.
- [ ] Response headers on any page include `X-Frame-Options: DENY` and `Strict-Transport-Security` (browser
      dev tools → Network → the page → Headers).
Void the test invoice (with a reason) and archive the test customer afterwards if they shouldn't stay.

## If something goes wrong
- **A migration fails:** each migration runs in its own transaction, so the failed one leaves no partial
  changes. Stop, copy the error, and fix it in a **new** migration — never edit an applied one, never `db reset`.
- **The app misbehaves after deploying:** in hPanel → the `crm.flyvera.us` website → Deployments, redeploy
  the previous version (Hostinger keeps up to 2 earlier ones). The database stays as it is;
  migrations are only ever added, never rolled back by hand.
- **Data damage:** restore from the Supabase backup / point-in-time recovery to just before the problem.
- **A key leaked:** rotate it in the Supabase dashboard (API keys) and update the host's settings right away.
