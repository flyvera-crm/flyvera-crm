-- ════════════════════════════════════════════════════════════════════════════
-- FLYVERA CRM · Migration 17 · Invoices: numbering at issue, snapshots, audited lifecycle
-- ════════════════════════════════════════════════════════════════════════════
--   1. Drafts have no number. The number (INV-<year>-0001, per agency per year)
--      is given when the invoice is ISSUED, so abandoned drafts never leave gaps.
--   2. At most one active (non-void) invoice per booking. Corrections are
--      "void with a reason, then issue a new invoice".
--   3. Amounts always mirror the booking (services, discount, tax rate), so the
--      invoice total equals the booking total and every payment fits. A service
--      fee is added as a booking service, then appears on the invoice.
--   4. Issuing freezes a snapshot of the bill-to customer and the passengers
--      (with their issued ticket numbers) and links the booking's payments.
--   5. Create / refresh / issue / void only through the functions below (finance
--      and admins); a guard stops anyone issuing, voiding or un-voiding by editing
--      the row. invoice_lines are now in the audit log too.
-- No table or data is removed; existing invoices (seed drafts) stay valid.

-- ── 1. Columns ──────────────────────────────────────────────────────────────
alter table public.invoices alter column number drop not null;
alter table public.invoices
  add column tax_rate    numeric(5, 2) not null default 0 check (tax_rate between 0 and 50),
  add column bill_to     jsonb check (bill_to is null or jsonb_typeof(bill_to) = 'object'),
  add column passengers  jsonb check (passengers is null or jsonb_typeof(passengers) = 'array'),
  add column void_reason text check (char_length(void_reason) <= 200),
  add column voided_at   timestamptz,
  add column voided_by   uuid references public.profiles (id) on delete set null;
alter table public.invoices
  add constraint invoices_number_when_issued check (status = 'Draft' or number is not null),
  add constraint invoices_void_reason check (status <> 'Void' or (void_reason is not null and voided_at is not null));

alter table public.invoice_lines
  add column item_type text not null default 'Other'
    check (item_type in ('Flight', 'Hotel', 'Transfer', 'Activity', 'Insurance', 'Visa', 'Service fee', 'Other'));

create unique index invoices_one_active_per_booking on public.invoices (booking_id) where status <> 'Void';

-- ── 2. Numbering: only issued invoices get a number ─────────────────────────
-- Same as migration 07, except a Draft inserted without a number stays unnumbered.
create or replace function private.assign_invoice_number()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  yr text := to_char(coalesce(new.issue_on, current_date), 'YYYY');
  m  text[];
begin
  if new.number is null then
    if new.status <> 'Draft' then
      new.number := 'INV-' || yr || '-' || lpad(private.next_code(new.organization_id, 'invoice-' || yr, 1)::text, 4, '0');
    end if;
  else
    m := regexp_match(new.number, '^INV-([0-9]{4})-([0-9]+)$');
    if m is not null then
      insert into private.org_counters as c (organization_id, kind, last_value)
      values (new.organization_id, 'invoice-' || m[1], m[2]::bigint)
      on conflict (organization_id, kind) do update set last_value = greatest(c.last_value, excluded.last_value);
    end if;
  end if;
  return new;
end;
$$;

-- ── 3. Lifecycle guard ──────────────────────────────────────────────────────
-- App users create Drafts only; status changes and changes to an issued invoice
-- happen only inside the functions below (which set flyvera.invoice_action).
create or replace function private.guard_invoice_lifecycle()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  in_function boolean := coalesce(current_setting('flyvera.invoice_action', true), '') = 'on';
begin
  if auth.uid() is null or in_function then
    return new;   -- service role / SQL editor, or one of the invoice functions
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'Draft' or new.number is not null then
      raise exception 'New invoices start as unnumbered drafts. Use Issue to number them.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  -- (total is a generated column: not yet computed in a BEFORE trigger, and always derived from the amounts)
  if new.status is distinct from old.status then
    raise exception 'Use Issue or Void to change an invoice''s status.' using errcode = 'P0001';
  end if;
  if old.status = 'Draft'
     and (to_jsonb(new) - 'total' - 'notes' - 'due_on' - 'updated_at' - 'pdf_storage_path')
         is distinct from (to_jsonb(old) - 'total' - 'notes' - 'due_on' - 'updated_at' - 'pdf_storage_path') then
    raise exception 'Draft amounts come from the booking — use Refresh from booking.' using errcode = 'P0001';
  end if;
  if old.status <> 'Draft'
     and (to_jsonb(new) - 'total' - 'updated_at' - 'pdf_storage_path') is distinct from (to_jsonb(old) - 'total' - 'updated_at' - 'pdf_storage_path') then
    raise exception 'Issued invoices can''t be changed — void it and issue a new one.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger invoices_guard_lifecycle before insert or update on public.invoices
  for each row execute function private.guard_invoice_lifecycle();

-- Lines are written only by the invoice functions (from the booking's services).
revoke insert, update, delete on public.invoice_lines from authenticated;

-- invoice_lines changes now appear in the audit log as well.
create trigger invoice_lines_audit after insert or update or delete on public.invoice_lines
  for each row execute function private.audit_change();

-- ── 4. Functions (finance and admins) ───────────────────────────────────────

-- Rebuilds a draft's lines and totals from its booking (same maths as booking_financials).
create or replace function private.fill_invoice_from_booking(p_invoice_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  inv        record;
  b          record;
  v_subtotal numeric(12, 2);
  v_discount numeric(12, 2);
begin
  select id, organization_id, booking_id, status into inv from public.invoices where id = p_invoice_id;
  if inv.status <> 'Draft' then
    raise exception 'Only drafts can be refreshed.' using errcode = 'P0001';
  end if;
  select discount, tax_rate, currency into b from public.bookings where id = inv.booking_id;

  perform set_config('flyvera.invoice_action', 'on', true);
  delete from public.invoice_lines where invoice_id = inv.id;
  insert into public.invoice_lines (organization_id, invoice_id, position, description, quantity, unit_price, booking_service_id, item_type)
  select inv.organization_id, inv.id, s.position, s.description, s.quantity, s.unit_price, s.id,
         case when s.service_type = 'Other' and s.description ilike 'service fee%' then 'Service fee' else s.service_type::text end
  from public.booking_services s
  where s.booking_id = inv.booking_id;

  select coalesce(sum(l.line_total), 0) into v_subtotal from public.invoice_lines l where l.invoice_id = inv.id;
  v_discount := least(b.discount, v_subtotal);
  update public.invoices
  set subtotal = v_subtotal, discount = v_discount, tax_rate = b.tax_rate, currency = b.currency,
      tax = round((v_subtotal - v_discount) * b.tax_rate / 100, 2)
  where id = inv.id;
  perform set_config('flyvera.invoice_action', '', true);
end;
$$;

create or replace function public.create_invoice(
  p_booking_id    uuid,
  p_service_fee   numeric,
  p_due_on        date,
  p_notes         text
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  b            record;
  v_invoice_id uuid;
  fee          numeric := round(coalesce(p_service_fee, 0), 2);
begin
  select id, organization_id, code, customer_id, status into b from public.bookings where id = p_booking_id;
  if b.id is null or not private.is_finance(b.organization_id) then
    raise exception 'Only Finance or an admin can create invoices.' using errcode = '42501';
  end if;
  if b.status = 'Cancelled' then
    raise exception 'Cancelled bookings can''t be invoiced.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.invoices i where i.booking_id = b.id and i.status <> 'Void') then
    raise exception 'This booking already has an invoice. Void it first to issue a new one.' using errcode = 'P0001';
  end if;
  if fee < 0 or fee > 100000 then
    raise exception 'Enter a service fee between 0 and 100,000.' using errcode = '22023';
  end if;
  if p_due_on is not null and p_due_on < current_date then
    raise exception 'The due date can''t be in the past.' using errcode = '22023';
  end if;

  -- A service fee becomes part of the booking, so the booking and invoice totals match.
  if fee > 0 then
    insert into public.booking_services (organization_id, booking_id, position, service_type, description, quantity, unit_price, cost)
    values (b.organization_id, b.id,
            coalesce((select max(position) + 1 from public.booking_services where booking_id = b.id), 0),
            'Other', 'Service fee', 1, fee, 0);
    insert into public.booking_events (organization_id, booking_id, body, created_by)
    values (b.organization_id, b.id, format('Service fee of %s added for invoicing', to_char(fee, 'FM999999990.00')), auth.uid());
  end if;

  insert into public.invoices (organization_id, booking_id, customer_id, status, due_on, notes, created_by)
  values (b.organization_id, b.id, b.customer_id, 'Draft', p_due_on, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid())
  returning id into v_invoice_id;
  perform private.fill_invoice_from_booking(v_invoice_id);

  insert into public.booking_events (organization_id, booking_id, body, created_by)
  values (b.organization_id, b.id, 'Invoice draft created', auth.uid());
  return v_invoice_id;
end;
$$;

create or replace function public.refresh_invoice_draft(p_invoice_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  org uuid;
begin
  select organization_id into org from public.invoices where id = p_invoice_id;
  if org is null or not private.is_finance(org) then
    raise exception 'Only Finance or an admin can change invoices.' using errcode = '42501';
  end if;
  perform private.fill_invoice_from_booking(p_invoice_id);
end;
$$;

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
      passengers = pax
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

create or replace function public.void_invoice(p_invoice_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  inv    record;
  reason text := btrim(coalesce(p_reason, ''));
begin
  select id, organization_id, booking_id, status, number into inv from public.invoices where id = p_invoice_id;
  if inv.id is null or not private.is_finance(inv.organization_id) then
    raise exception 'Only Finance or an admin can void invoices.' using errcode = '42501';
  end if;
  if inv.status = 'Void' then
    raise exception 'This invoice is already void.' using errcode = 'P0001';
  end if;
  if char_length(reason) < 5 or char_length(reason) > 200 then
    raise exception 'Give a reason (5–200 characters).' using errcode = '22023';
  end if;

  perform set_config('flyvera.invoice_action', 'on', true);
  perform set_config('flyvera.change_reason', reason, true);
  update public.invoices
  set status = 'Void', void_reason = reason, voided_at = now(), voided_by = auth.uid()
  where id = inv.id;
  perform set_config('flyvera.change_reason', '', true);
  perform set_config('flyvera.invoice_action', '', true);

  insert into public.booking_events (organization_id, booking_id, body, created_by)
  values (inv.organization_id, inv.booking_id,
          left(format('Invoice %s voided — reason: %s', coalesce(inv.number, 'draft'), reason), 300), auth.uid());
end;
$$;

-- ── Privileges ──────────────────────────────────────────────────────────────
revoke execute on function
  public.create_invoice(uuid, numeric, date, text),
  public.refresh_invoice_draft(uuid),
  public.issue_invoice(uuid, date, date),
  public.void_invoice(uuid, text)
  from public, anon;
grant execute on function
  public.create_invoice(uuid, numeric, date, text),
  public.refresh_invoice_draft(uuid),
  public.issue_invoice(uuid, date, date),
  public.void_invoice(uuid, text)
  to authenticated;
revoke execute on function private.fill_invoice_from_booking(uuid), private.guard_invoice_lifecycle() from public, anon, authenticated;
