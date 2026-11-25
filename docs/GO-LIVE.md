# FLYVERA CRM — Going live (production runbook)

Production has **not** been set up yet. Every step below changes real systems: do them in order, one at a
time, and stop if anything looks different from what is described. Nothing here is automated.

**Never, on production:** run `supabase db push --include-seed`, `supabase db reset`, or load
`supabase/seed.sql` (it contains demo logins with a known password). Never put real keys in this repository.

---

## 0. Before you start
- [ ] `feature/supabase-auth` is reviewed and merged into `main`; you deploy from `main`.
- [ ] All checks pass on `main`: `npm run test:unit`, `npm run db:test`, `npx tsc --noEmit`, `npx eslint src supabase tests`, `npm run build`.
- [ ] The staging browser tests pass for every role.
- [ ] A password manager entry is ready for: the production database password, the publishable key, the
      service-role key, the Vault passport key, and the SMTP credentials.
- [ ] Production Supabase project: on a plan with **daily backups / point-in-time recovery** switched on.

## 1. Hosting and environment variables
Any host that runs Next.js 16 (Node) over **HTTPS**. Build: `npm run build` · Start: `npm start`.

| Variable | Where it comes from | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Production project → Project Settings → API | no (public) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Production project → Project Settings → API Keys (publishable) | no (public; RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY` | Production project → Project Settings → API Keys (secret / service_role) | **yes** — host's secret settings only, never `NEXT_PUBLIC_`, never committed |

The service-role key is used on the server only, to send invitation emails and to remove revoked,
unaccepted logins — always after checking that the caller is an admin.

## 2. Supabase Auth (production project dashboard)
- [ ] **Authentication → Sign In / Providers → Email:** enabled; **"Allow new users to sign up" OFF**;
      **"Confirm email" ON**; minimum password length **10**.
- [ ] **Authentication → URL Configuration:** Site URL `https://<your CRM domain>`; Redirect URLs
      `https://<your CRM domain>/**`.
- [ ] **Authentication → Emails → Templates:**
  - Invite user — link: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`
  - Reset password — link: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`
- [ ] **Authentication → Emails → SMTP settings:** your email provider (the built-in sender only allows a
      few emails per hour). Send yourself a test reset email afterwards.

## 3. Database: migrations 01–21 (no seed)
1. Link the CLI to **production** (this replaces the staging link on this computer):
   ```
   npx supabase link --project-ref <production project ref>
   ```
2. **Check the link** — it must print the production ref, not staging's:
   ```
   cat supabase/.temp/project-ref
   ```
3. Dry run — it must list exactly the 21 files `20261120000100_…` to `20261120002100_…`, and **no seeds**:
   ```
   npx supabase db push --remote --dry-run
   ```
   (The CLI labels every hosted project "production"; go by the project name and ref it prints.)
4. Apply, without the seed:
   ```
   npx supabase db push --remote
   ```
5. Confirm all 21 appear with a remote timestamp: `npx supabase migration list --remote`.
6. Link back to staging when done: `npx supabase link --project-ref <staging project ref>`, and check
   `supabase/.temp/project-ref` again.

## 4. Passport encryption key (once, before anyone saves a passport)
In the production **SQL editor** (generate your own random value of 40+ characters; never commit it):
```sql
select vault.create_secret('<long random value>', 'flyvera_document_key', 'Passport encryption key');
```
Store the value in the password manager. **Losing it makes stored passport numbers unreadable.**

## 5. The agency and the first admin
The app can't create an agency or its first admin (there is no public sign-up). In the **SQL editor**:
```sql
-- 1. The agency (slug: lowercase letters, digits, dashes)
insert into public.organizations (name, slug, base_currency, timezone)
values ('FLYVERA TRAVEL', 'flyvera', 'USD', 'UTC')
returning id;

-- 2. An admin invitation for the owner (use the id returned above; email in lowercase)
insert into public.organization_invitations (organization_id, email, full_name, role)
values ('<organization id>', '<owner email>', '<Owner Name>', 'admin');
```
3. **Authentication → Users → Add user:** the owner's email and a strong password, **"Auto Confirm User" on**.
   The database grants admin access when a confirmed login matches a valid invitation.
4. Check:
   ```sql
   select u.email, m.role, m.status
   from public.organization_members m join auth.users u on u.id = m.user_id;
   ```
   One row: the owner, `admin`, `active`.

## 6. First sign-in and setup (in the app, as the owner)
- [ ] Sign in at `https://<your CRM domain>/login`; change the password under Settings → My profile → Change password if you like.
- [ ] **Settings → Agency:** trading and legal name, address, phone, email, **TRN** (invoices say "Tax invoice"
      only when a TRN is set), IATA number, **bank details**, defaults and terms. Check the preview.
- [ ] **Team → Teams:** create the teams. **Team → Invite person** for each colleague with the right role and team.
- [ ] **Suppliers:** add the main airlines, hotels and partners.

## 7. Smoke test (production, with your own records)
- [ ] An invited colleague receives the email, sets a password and lands in the CRM with the right role.
- [ ] Forgot password sends an email whose link opens "Choose a new password".
- [ ] Customer → quotation → print (letterhead shows) → accept → booking (deposit/balance dates follow Settings).
- [ ] Record a payment → receipt prints → create and issue an invoice → PDF downloads with "How to pay".
- [ ] Add a passport (proves the Vault key works) and reveal it (an audit entry appears).
- [ ] Dashboard shows the payment; a support-role colleague sees no amounts.
- [ ] Response headers on any page include `X-Frame-Options: DENY` and `Strict-Transport-Security` (browser
      dev tools → Network → the page → Headers).
Void the test invoice (with a reason) and archive the test customer afterwards if they shouldn't stay.

## If something goes wrong
- **A migration fails:** each migration runs in its own transaction, so the failed one leaves no partial
  changes. Stop, copy the error, and fix it in a **new** migration — never edit an applied one, never `db reset`.
- **The app misbehaves after deploying:** redeploy the previous build on the host. The database stays as it is;
  migrations are only ever added, never rolled back by hand.
- **Data damage:** restore from the Supabase backup / point-in-time recovery to just before the problem.
- **A key leaked:** rotate it in the Supabase dashboard (API keys) and update the host's settings right away.
