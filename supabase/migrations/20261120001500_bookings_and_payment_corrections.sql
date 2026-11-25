-- ════════════════════════════════════════════════════════════════════════════
-- FLYVERA CRM · Migration 15 · Atomic booking creation, audited payment corrections
-- ════════════════════════════════════════════════════════════════════════════
--   1. The audit log can record WHY a change was made (a reason given by the
--      function making it), in audit_logs.context.reason.
--   2. create_booking_from_quotation(): booking + its services + first timeline
--      entry in one all-or-nothing step. Runs with the caller's permissions
--      (SECURITY INVOKER), so Row Level Security still decides who may book.
--   3. correct_payment(): the ONLY way to change a recorded payment. Finance and
--      admins only, a written reason is required, the booking, receipt number and
--      recorder can't change, card-gateway payments can't be edited, and every
--      correction is written to the audit log (before/after + reason) and to the
--      booking's timeline. Direct UPDATEs of payments by app users are revoked.
-- No table is created or dropped and no existing data is changed.

-- ── 1. Audit log: optional reason for a change ──────────────────────────────
-- Same as migration 09, plus: if the transaction set flyvera.change_reason,
-- it's stored in context.reason.
create or replace function private.audit_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  old_j   jsonb;
  new_j   jsonb;
  changed text[];
  org     uuid;
  reason  text := nullif(current_setting('flyvera.change_reason', true), '');
begin
  if tg_op in ('UPDATE', 'DELETE') then old_j := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then new_j := to_jsonb(new); end if;

  -- Compare the REAL values (so changes to sensitive fields are still detected) …
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into changed
    from jsonb_each(new_j) n
    where n.value is distinct from old_j -> n.key and n.key <> 'updated_at';
    if changed is null then
      return null;   -- nothing meaningful changed
    end if;
  end if;

  -- … then blank out sensitive values before anything is stored.
  old_j := private.redact(old_j);
  new_j := private.redact(new_j);

  org := case when tg_table_name = 'organizations'
              then coalesce(new_j ->> 'id', old_j ->> 'id')
              else coalesce(new_j ->> 'organization_id', old_j ->> 'organization_id') end::uuid;
  -- when a whole organization is deleted, keep the entry but drop the link
  if org is not null and not exists (select 1 from public.organizations o where o.id = org) then
    org := null;
  end if;

  insert into public.audit_logs (organization_id, actor_id, action, table_name, record_id, changed_fields, old_data, new_data, context)
  values (
    org,
    auth.uid(),
    tg_op,
    tg_table_name,
    coalesce(new_j ->> 'id', old_j ->> 'id', new_j ->> 'user_id', old_j ->> 'user_id')::uuid,
    changed,
    old_j,
    new_j,
    case when reason is null then '{}'::jsonb else jsonb_build_object('reason', reason) end
  );
  return null;
end;
$$;

-- ── 2. Booking from an accepted quotation, all or nothing ───────────────────
create or replace function public.create_booking_from_quotation(
  p_quotation_id    uuid,
  p_customer_id     uuid,
  p_depart_on       date,
  p_return_on       date,
  p_deposit_due_on  date,
  p_balance_due_on  date
)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  q          record;
  v_booking_id uuid;
  services   integer;
begin
  select id, organization_id, code, status, customer_id, title, destination, adults, children,
         discount, tax_rate, currency, prepared_by
    into q
  from public.quotations
  where id = p_quotation_id and deleted_at is null;

  if q.id is null then
    raise exception 'Quotation not found.' using errcode = 'P0002';
  end if;
  if q.status <> 'Accepted' then
    raise exception 'Only accepted quotations can be booked.' using errcode = 'P0001';
  end if;
  if q.customer_id is not null and q.customer_id <> p_customer_id then
    raise exception 'This quotation belongs to a different customer.' using errcode = 'P0001';
  end if;

  insert into public.bookings (
    organization_id, customer_id, quotation_id, title, destination, depart_on, return_on,
    adults, children, discount, tax_rate, currency, deposit_due_on, balance_due_on, agent_id)
  values (
    q.organization_id, p_customer_id, q.id, q.title, q.destination, p_depart_on, p_return_on,
    q.adults, q.children, q.discount, q.tax_rate, q.currency, p_deposit_due_on, p_balance_due_on, q.prepared_by)
  returning id into v_booking_id;

  insert into public.booking_services (organization_id, booking_id, position, service_type, description, quantity, unit_price, cost)
  select q.organization_id, v_booking_id, i.position, i.item_type, i.description, i.quantity, i.unit_price, i.cost
  from public.quotation_items i
  where i.quotation_id = q.id;
  get diagnostics services = row_count;
  if services = 0 then
    raise exception 'This quotation has no items to book.' using errcode = 'P0001';  -- rolls back the booking too
  end if;

  insert into public.booking_events (organization_id, booking_id, body, created_by)
  values (q.organization_id, v_booking_id, 'Booking created from ' || q.code || ' — awaiting deposit', auth.uid());

  return v_booking_id;
end;
$$;

-- ── 3. Payment corrections (the only way to change a recorded payment) ──────
create or replace function public.correct_payment(
  p_payment_id   uuid,
  p_amount       numeric,
  p_received_on  date,
  p_method       public.payment_method,
  p_reference    text,
  p_note         text,
  p_reason       text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p          record;
  booked_on  date;
  reason     text := btrim(coalesce(p_reason, ''));
  new_ref    text := nullif(btrim(coalesce(p_reference, '')), '');
  new_note   text := nullif(btrim(coalesce(p_note, '')), '');
  changes    text[] := '{}';
begin
  select * into p from public.payments where id = p_payment_id;
  if p.id is null or not private.is_finance(p.organization_id) then
    raise exception 'Only Finance or an admin can correct payments.' using errcode = '42501';
  end if;
  if char_length(reason) < 5 or char_length(reason) > 200 then
    raise exception 'Give a reason for the correction (5–200 characters).' using errcode = '22023';
  end if;
  if exists (select 1 from public.payment_transactions t where t.payment_id = p.id) then
    raise exception 'This payment came from the card gateway and can''t be edited. Record a refund instead.' using errcode = 'P0001';
  end if;

  select created_at::date into booked_on from public.bookings where id = p.booking_id;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Enter an amount above 0 with at most 2 decimal places.' using errcode = '22023';
  end if;
  if p_received_on is null or p_received_on > current_date or p_received_on < booked_on then
    raise exception 'The payment date must be between the booking date and today.' using errcode = '22023';
  end if;
  if p_method is null then
    raise exception 'Choose a payment method.' using errcode = '22023';
  end if;

  if p_amount <> p.amount then changes := array_append(changes, format('amount %s → %s', to_char(p.amount, 'FM999999990.00'), to_char(p_amount, 'FM999999990.00'))); end if;
  if p_received_on <> p.received_on then changes := array_append(changes, format('date %s → %s', p.received_on, p_received_on)); end if;
  if p_method <> p.method then changes := array_append(changes, format('method %s → %s', p.method, p_method)); end if;
  if new_ref is distinct from p.reference then changes := array_append(changes, 'reference'); end if;
  if new_note is distinct from p.note then changes := array_append(changes, 'note'); end if;
  if cardinality(changes) = 0 then
    raise exception 'Nothing was changed.' using errcode = '22023';
  end if;

  -- The audit trigger stores old + new values; the reason goes with them.
  perform set_config('flyvera.change_reason', reason, true);
  update public.payments
  set amount = p_amount, received_on = p_received_on, method = p_method, reference = new_ref, note = new_note
  where id = p.id;   -- the payments_guard_total trigger still refuses more than the booking total
  perform set_config('flyvera.change_reason', '', true);

  insert into public.booking_events (organization_id, booking_id, body, created_by)
  values (
    p.organization_id, p.booking_id,
    left(format('Payment %s corrected (%s) — reason: %s', p.receipt_number, array_to_string(changes, '; '), reason), 300),
    auth.uid());
end;
$$;

-- App users can no longer UPDATE payments directly: corrections must go through
-- correct_payment() (reason required, always logged). Inserting new payments is unchanged.
revoke update on public.payments from authenticated;

-- ── Function privileges ─────────────────────────────────────────────────────
revoke execute on function
  public.create_booking_from_quotation(uuid, uuid, date, date, date, date),
  public.correct_payment(uuid, numeric, date, public.payment_method, text, text, text)
  from public, anon;
grant execute on function
  public.create_booking_from_quotation(uuid, uuid, date, date, date, date),
  public.correct_payment(uuid, numeric, date, public.payment_method, text, text, text)
  to authenticated;
