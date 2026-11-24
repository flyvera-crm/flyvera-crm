-- ════════════════════════════════════════════════════════════════════════════
-- FLYVERA CRM · Migration 20 · Agency settings
-- ════════════════════════════════════════════════════════════════════════════
--   1. Admins save the agency profile (printed on quotations, invoices and receipts),
--      bank details for invoices, and the sales & booking defaults through
--      update_agency_settings(), which checks every value. Direct updates of the
--      organizations row are no longer allowed for app users.
--   2. Issued invoices keep a copy of the agency's details and invoice terms
--      (invoices.issuer), so later changes never alter them. Invoices issued before
--      this migration get a copy of today's details.
-- Settings live in organizations.settings (jsonb). Unknown keys are kept as they are.
-- Defaults that aren't set fall back to the app's built-in values (same numbers as before).

-- ── 1. Validation helpers ───────────────────────────────────────────────────
create or replace function private.settings_text(p jsonb, k text, max_len integer, label text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v text;
begin
  if not (p ? k) or jsonb_typeof(p -> k) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p -> k) <> 'string' then
    raise exception '% must be text.', label using errcode = '22023';
  end if;
  v := btrim(p ->> k);
  if v = '' then
    return null;
  end if;
  if char_length(v) > max_len then
    raise exception '% is too long (at most % characters).', label, max_len using errcode = '22023';
  end if;
  return v;
end;
$$;

create or replace function private.settings_int(p jsonb, k text, lo integer, hi integer, label text)
returns integer
language plpgsql immutable set search_path = ''
as $$
declare
  n numeric;
begin
  if coalesce(jsonb_typeof(p -> k), 'missing') <> 'number' then
    raise exception '% must be a whole number.', label using errcode = '22023';
  end if;
  n := (p ->> k)::numeric;
  if n <> trunc(n) or n < lo or n > hi then
    raise exception '% must be a whole number from % to %.', label, lo, hi using errcode = '22023';
  end if;
  return n::integer;
end;
$$;

create or replace function private.settings_terms(p jsonb, k text, label text)
returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  item jsonb;
  out  jsonb := '[]'::jsonb;
  line text;
begin
  if coalesce(jsonb_typeof(p -> k), 'missing') <> 'array' then
    raise exception '% must be a list of lines.', label using errcode = '22023';
  end if;
  if jsonb_array_length(p -> k) > 10 then
    raise exception '% can have at most 10 lines.', label using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(p -> k) loop
    if jsonb_typeof(item) <> 'string' then
      raise exception '% must be a list of lines.', label using errcode = '22023';
    end if;
    line := btrim(item #>> '{}');
    if line = '' then
      continue;
    end if;
    if char_length(line) > 300 then
      raise exception 'Each line of % must be at most 300 characters.', lower(label) using errcode = '22023';
    end if;
    out := out || to_jsonb(line);
  end loop;
  return out;
end;
$$;

-- ── 2. Saving ───────────────────────────────────────────────────────────────
create or replace function public.update_agency_settings(
  p_organization_id uuid,
  p_name            text,
  p_profile         jsonb,
  p_defaults        jsonb
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_name     text := btrim(coalesce(p_name, ''));
  v_profile  jsonb;
  v_defaults jsonb;
  v_tax      numeric;
  v_email    text;
  v_phone    text;
  v_swift    text;
  v_iban     text;
  v_extra    text;
begin
  if not private.has_role(p_organization_id, 'admin') then
    raise exception 'Only an admin can change the agency settings.' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'Enter the agency name (2–120 characters).' using errcode = '22023';
  end if;
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' or p_defaults is null or jsonb_typeof(p_defaults) <> 'object' then
    raise exception 'The settings couldn''t be read.' using errcode = '22023';
  end if;

  -- Only known fields.
  select string_agg(k, ', ') into v_extra
  from jsonb_object_keys(p_profile) k
  where k not in ('legal_name', 'address', 'city', 'country', 'phone', 'email', 'website', 'tax_number', 'iata_number',
                  'bank_name', 'account_name', 'iban', 'swift', 'payment_note');
  if v_extra is not null then
    raise exception 'Unknown profile field: %.', v_extra using errcode = '22023';
  end if;
  select string_agg(k, ', ') into v_extra
  from jsonb_object_keys(p_defaults) k
  where k not in ('quote_validity_days', 'default_tax_rate', 'low_margin_percent', 'deposit_days',
                  'balance_days_before_departure', 'supplier_days_before_departure', 'quote_terms', 'invoice_terms');
  if v_extra is not null then
    raise exception 'Unknown setting: %.', v_extra using errcode = '22023';
  end if;

  -- Profile: every field optional; empty means "not shown".
  v_email := private.settings_text(p_profile, 'email', 254, 'Email');
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;
  v_phone := private.settings_text(p_profile, 'phone', 30, 'Phone');
  if v_phone is not null and v_phone !~ '^\+?[0-9 ().-]{6,30}$' then
    raise exception 'Enter a valid phone number.' using errcode = '22023';
  end if;
  v_swift := upper(private.settings_text(p_profile, 'swift', 11, 'SWIFT / BIC'));
  if v_swift is not null and v_swift !~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$' then
    raise exception 'A SWIFT / BIC code has 8 or 11 letters and digits.' using errcode = '22023';
  end if;
  v_iban := upper(regexp_replace(coalesce(private.settings_text(p_profile, 'iban', 42, 'IBAN'), ''), '\s', '', 'g'));
  if v_iban <> '' and v_iban !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$' then
    raise exception 'Enter a valid IBAN (country code, check digits, account).' using errcode = '22023';
  end if;

  v_profile := jsonb_strip_nulls(jsonb_build_object(
    'legal_name',   private.settings_text(p_profile, 'legal_name', 120, 'Legal name'),
    'address',      private.settings_text(p_profile, 'address', 200, 'Address'),
    'city',         private.settings_text(p_profile, 'city', 80, 'City'),
    'country',      private.settings_text(p_profile, 'country', 80, 'Country'),
    'phone',        v_phone,
    'email',        lower(v_email),
    'website',      private.settings_text(p_profile, 'website', 120, 'Website'),
    'tax_number',   private.settings_text(p_profile, 'tax_number', 40, 'Tax registration number'),
    'iata_number',  private.settings_text(p_profile, 'iata_number', 20, 'IATA number'),
    'bank_name',    private.settings_text(p_profile, 'bank_name', 80, 'Bank name'),
    'account_name', private.settings_text(p_profile, 'account_name', 120, 'Account name'),
    'iban',         nullif(v_iban, ''),
    'swift',        v_swift,
    'payment_note', private.settings_text(p_profile, 'payment_note', 300, 'Payment note')
  ));

  -- Defaults: all required.
  if coalesce(jsonb_typeof(p_defaults -> 'default_tax_rate'), 'missing') <> 'number' then
    raise exception 'Default tax must be a number.' using errcode = '22023';
  end if;
  v_tax := (p_defaults ->> 'default_tax_rate')::numeric;
  if v_tax < 0 or v_tax > 50 or v_tax <> round(v_tax, 2) then
    raise exception 'Default tax must be from 0 to 50 %%, with at most 2 decimals.' using errcode = '22023';
  end if;
  v_defaults := jsonb_build_object(
    'quote_validity_days',            private.settings_int(p_defaults, 'quote_validity_days', 1, 90, 'Quotation validity'),
    'default_tax_rate',               v_tax,
    'low_margin_percent',             private.settings_int(p_defaults, 'low_margin_percent', 0, 100, 'Low-margin alert'),
    'deposit_days',                   private.settings_int(p_defaults, 'deposit_days', 0, 60, 'Deposit due'),
    'balance_days_before_departure',  private.settings_int(p_defaults, 'balance_days_before_departure', 0, 180, 'Balance due'),
    'supplier_days_before_departure', private.settings_int(p_defaults, 'supplier_days_before_departure', 0, 90, 'Supplier payment'),
    'quote_terms',                    private.settings_terms(p_defaults, 'quote_terms', 'Quotation terms'),
    'invoice_terms',                  private.settings_terms(p_defaults, 'invoice_terms', 'Invoice terms')
  );

  perform set_config('flyvera.change_reason', 'Agency settings updated', true);
  update public.organizations
  set name = v_name,
      settings = settings || v_defaults || jsonb_build_object('profile', v_profile)
  where id = p_organization_id;
  perform set_config('flyvera.change_reason', '', true);
end;
$$;

-- Every change goes through update_agency_settings() (members can still read their agency).
revoke update on public.organizations from authenticated;

-- ── 3. Issued invoices keep the agency's details ────────────────────────────
alter table public.invoices add column issuer jsonb check (issuer is null or jsonb_typeof(issuer) = 'object');
comment on column public.invoices.issuer is
  'Copy of the agency details, bank details and invoice terms at the moment of issue (null on drafts).';

-- Same default terms as the app (src/lib/settings-rules.ts), used until the agency sets its own.
create or replace function private.invoice_issuer(p_organization_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('name', o.name)
         || coalesce(o.settings -> 'profile', '{}'::jsonb)
         || jsonb_build_object('terms', coalesce(
              nullif(o.settings -> 'invoice_terms', '[]'::jsonb),
              nullif(o.settings -> 'quote_terms', '[]'::jsonb),
              '["Prices are per the items listed and subject to availability until booked.",
                "A 30% deposit confirms the booking; the balance is due 30 days before departure.",
                "Flight fares are only guaranteed once tickets are issued.",
                "Cancellation charges apply as per supplier policies."]'::jsonb))
  from public.organizations o
  where o.id = p_organization_id;
$$;
revoke execute on function private.invoice_issuer(uuid) from public, anon, authenticated;

-- Invoices issued before this migration: a copy of today's details.
update public.invoices set issuer = private.invoice_issuer(organization_id) where status <> 'Draft' and issuer is null;

-- issue_invoice: unchanged from migration 17, plus the issuer copy.
create or replace function public.issue_invoice(p_invoice_id uuid, p_issue_on date, p_due_on date)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  inv      record;
  c        record;
  yr       text;
  v_number text;
  pax      jsonb;
begin
  select * into inv from public.invoices where id = p_invoice_id;
  if inv.id is null or not private.is_finance(inv.organization_id) then
    raise exception 'Only Finance or an admin can issue invoices.' using errcode = '42501';
  end if;
  if inv.status <> 'Draft' then
    raise exception 'This invoice has already been issued.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.invoice_lines where invoice_id = inv.id) then
    raise exception 'The invoice has no lines. Refresh it from the booking first.' using errcode = 'P0001';
  end if;
  if p_issue_on is null or p_issue_on > current_date then
    raise exception 'The issue date can''t be in the future.' using errcode = '22023';
  end if;
  if p_due_on is null or p_due_on < p_issue_on then
    raise exception 'The due date must be on or after the issue date.' using errcode = '22023';
  end if;

  select code, first_name, last_name, email, phone, city, country into c from public.customers where id = inv.customer_id;
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', concat_ws(' ', p.title, p.first_name, p.last_name),
           'type', p.passenger_type,
           'tickets', (select coalesce(jsonb_agg(t.ticket_number order by t.ticket_number), '[]'::jsonb)
                       from public.tickets t where t.passenger_id = p.id and t.status = 'Issued'))
         order by p.is_lead_passenger desc, p.created_at), '[]'::jsonb)
    into pax
  from public.passengers p where p.booking_id = inv.booking_id;

  yr := to_char(p_issue_on, 'YYYY');
  v_number := 'INV-' || yr || '-' || lpad(private.next_code(inv.organization_id, 'invoice-' || yr, 1)::text, 4, '0');

  perform set_config('flyvera.invoice_action', 'on', true);
  update public.invoices
  set status = 'Issued', number = v_number, issue_on = p_issue_on, due_on = p_due_on, issued_by = auth.uid(),
      bill_to = jsonb_build_object('code', c.code, 'name', c.first_name || ' ' || c.last_name, 'email', c.email,
                                   'phone', c.phone, 'city', c.city, 'country', c.country),
      passengers = pax,
      issuer = private.invoice_issuer(inv.organization_id)
  where id = inv.id;
  perform set_config('flyvera.invoice_action', '', true);

  -- The booking's payments now belong to this invoice (including ones from a voided invoice).
  perform set_config('flyvera.change_reason', 'Linked to invoice ' || v_number, true);
  update public.payments
  set invoice_id = inv.id
  where booking_id = inv.booking_id
    and (invoice_id is null or invoice_id in (select id from public.invoices where status = 'Void'));
  perform set_config('flyvera.change_reason', '', true);

  insert into public.booking_events (organization_id, booking_id, body, created_by)
  values (inv.organization_id, inv.booking_id,
          format('Invoice %s issued (%s %s, due %s)', v_number, inv.currency, to_char(inv.total, 'FM999999990.00'), p_due_on),
          auth.uid());
  return v_number;
end;
$$;

-- ── 4. Grants ───────────────────────────────────────────────────────────────
revoke execute on function public.update_agency_settings(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.update_agency_settings(uuid, text, jsonb, jsonb) to authenticated;
revoke execute on function
  private.settings_text(jsonb, text, integer, text),
  private.settings_int(jsonb, text, integer, integer, text),
  private.settings_terms(jsonb, text, text)
  from public, anon, authenticated;
