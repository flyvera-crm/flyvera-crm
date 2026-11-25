-- ════════════════════════════════════════════════════════════════════════════
-- FLYVERA CRM · Migration 18 · Refund requests: request → approve → pay (or reject / withdraw)
-- ════════════════════════════════════════════════════════════════════════════
--   1. Requests are made on CANCELLED bookings by sales (their bookings), ticketing,
--      finance or admins, with a reason category and details.
--   2. Finance / admins approve (optionally for a LOWER amount, with a note),
--      reject (with a reason) or mark an approved refund paid (date, method,
--      bank/card reference). The requester may withdraw while it's pending.
--   3. Separation of duties: whoever requested a refund can't approve or pay it,
--      unless they're an admin (so a one-person agency isn't blocked).
--   4. Finance / admins may record a refund already sent in one step; it's marked
--      "recorded directly — no separate approval" in the audit log and timeline.
--   5. Every step goes through the functions below (app users can no longer insert
--      or update refund rows directly) and is written to the audit log (with the
--      reason) and to the booking's timeline.
-- The existing check that requests + approvals + payments never exceed the money
-- received still applies. Existing refunds are not changed.

-- ── 1. Columns ──────────────────────────────────────────────────────────────
alter table public.refunds
  add column reason_category   text check (reason_category in ('Cancellation', 'Airline refund', 'Schedule change', 'Duplicate payment', 'Other')),
  add column ticket_id         uuid,
  add column requested_amount  numeric(12, 2) check (requested_amount > 0),
  add column decision_note     text check (char_length(decision_note) <= 200),
  add column rejected_by       uuid references public.profiles (id) on delete set null,
  add column rejected_at       timestamptz,
  add column withdrawn_by      uuid references public.profiles (id) on delete set null,
  add column withdrawn_at      timestamptz,
  add column payment_reference text check (char_length(payment_reference) <= 60),
  add column recorded_directly boolean not null default false,
  add constraint refunds_ticket_fkey foreign key (ticket_id, organization_id)
    references public.tickets (id, organization_id) on delete set null (ticket_id),
  add constraint refunds_rejected_has_date check (status <> 'Rejected' or rejected_at is not null or withdrawn_at is not null),
  add constraint refunds_amount_not_above_request check (requested_amount is null or amount <= requested_amount);

-- ── 2. Helpers ──────────────────────────────────────────────────────────────
create or replace function private.refund_event(p_organization_id uuid, p_booking_id uuid, p_body text)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.booking_events (organization_id, booking_id, body, created_by)
  values (p_organization_id, p_booking_id, left(p_body, 300), auth.uid());
$$;

create or replace function private.money_text(amount numeric)
returns text
language sql immutable set search_path = ''
as $$ select to_char(amount, 'FM999999990.00') $$;

-- ── 3. Request ──────────────────────────────────────────────────────────────
create or replace function public.request_refund(
  p_booking_id uuid,
  p_amount     numeric,
  p_method     public.payment_method,
  p_category   text,
  p_details    text,
  p_ticket_id  uuid
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  b       record;
  v_details text := btrim(coalesce(p_details, ''));
  r       record;
begin
  select id, organization_id, code, status, refund_decision, currency into b from public.bookings where id = p_booking_id;
  if b.id is null
     or not (private.has_role(b.organization_id, 'admin', 'finance_manager', 'ticketing_agent')
             or (private.has_role(b.organization_id, 'sales_manager', 'sales_agent') and private.booking_visible(b.id))) then
    raise exception 'You can''t request refunds on this booking.' using errcode = '42501';
  end if;
  if b.status <> 'Cancelled' then
    raise exception 'Refunds can only be requested on cancelled bookings.' using errcode = 'P0001';
  end if;
  if b.refund_decision = 'Kept as fee' then
    raise exception 'This booking was settled as a cancellation fee.' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Enter an amount above 0 with at most 2 decimal places.' using errcode = '22023';
  end if;
  if p_category is null or p_category not in ('Cancellation', 'Airline refund', 'Schedule change', 'Duplicate payment', 'Other') then
    raise exception 'Choose a reason.' using errcode = '22023';
  end if;
  if char_length(v_details) < 5 or char_length(v_details) > 200 then
    raise exception 'Explain the refund (5–200 characters).' using errcode = '22023';
  end if;
  if p_method is null then
    raise exception 'Choose how the customer should be refunded.' using errcode = '22023';
  end if;
  if p_ticket_id is not null and not exists (select 1 from public.tickets t where t.id = p_ticket_id and t.booking_id = b.id) then
    raise exception 'That ticket isn''t on this booking.' using errcode = 'P0001';
  end if;

  -- refunds_guard_total refuses requests that would exceed the money received.
  insert into public.refunds (organization_id, booking_id, amount, requested_amount, currency, method, status,
                              reason, reason_category, ticket_id, requested_by)
  values (b.organization_id, b.id, p_amount, p_amount, b.currency, p_method, 'Requested',
          v_details, p_category, p_ticket_id, auth.uid())
  returning * into r;

  perform private.refund_event(r.organization_id, r.booking_id, format('Refund %s of %s %s requested (%s) — %s',
                                         r.reference_number, b.currency, private.money_text(p_amount), p_category, v_details));
  return r.id;
end;
$$;

-- ── 4. Decisions (finance / admin) ──────────────────────────────────────────
create or replace function public.approve_refund(p_refund_id uuid, p_amount numeric, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r    record;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into r from public.refunds where id = p_refund_id;
  if r.id is null or not private.is_finance(r.organization_id) then
    raise exception 'Only Finance or an admin can approve refunds.' using errcode = '42501';
  end if;
  if r.status <> 'Requested' then
    raise exception 'Only requested refunds can be approved (this one is %).', lower(r.status::text) using errcode = 'P0001';
  end if;
  if r.requested_by = auth.uid() and not private.has_role(r.organization_id, 'admin') then
    raise exception 'You requested this refund, so someone else in Finance (or an admin) must approve it.' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Enter an amount above 0 with at most 2 decimal places.' using errcode = '22023';
  end if;
  if p_amount > coalesce(r.requested_amount, r.amount) then
    raise exception 'You can approve the requested amount or less, not more.' using errcode = '22023';
  end if;
  if p_amount < coalesce(r.requested_amount, r.amount) and (v_note is null or char_length(v_note) < 5) then
    raise exception 'Explain why less than requested is approved (at least 5 characters).' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 200 then
    raise exception 'Keep the note under 200 characters.' using errcode = '22023';
  end if;

  perform set_config('flyvera.change_reason', coalesce(v_note, 'Approved as requested'), true);
  update public.refunds
  set status = 'Approved', amount = p_amount, approved_by = auth.uid(), approved_at = now(), decision_note = v_note
  where id = r.id;
  perform set_config('flyvera.change_reason', '', true);

  perform private.refund_event(r.organization_id, r.booking_id, format('Refund %s approved for %s %s%s', r.reference_number, r.currency, private.money_text(p_amount),
                                         case when v_note is null then '' else ' — ' || v_note end));
end;
$$;

create or replace function public.reject_refund(p_refund_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r      record;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select * into r from public.refunds where id = p_refund_id;
  if r.id is null or not private.is_finance(r.organization_id) then
    raise exception 'Only Finance or an admin can reject refunds.' using errcode = '42501';
  end if;
  if r.status not in ('Requested', 'Approved') then
    raise exception 'This refund is already %.', lower(r.status::text) using errcode = 'P0001';
  end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 200 then
    raise exception 'Give a reason (5–200 characters).' using errcode = '22023';
  end if;

  perform set_config('flyvera.change_reason', v_reason, true);
  update public.refunds
  set status = 'Rejected', rejected_by = auth.uid(), rejected_at = now(), decision_note = v_reason
  where id = r.id;
  perform set_config('flyvera.change_reason', '', true);

  perform private.refund_event(r.organization_id, r.booking_id, format('Refund %s rejected — %s', r.reference_number, v_reason));
end;
$$;

create or replace function public.withdraw_refund(p_refund_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
begin
  select * into r from public.refunds where id = p_refund_id;
  if r.id is null or r.requested_by is distinct from auth.uid() or not private.is_member(r.organization_id) then
    raise exception 'Only the person who requested this refund can withdraw it.' using errcode = '42501';
  end if;
  if r.status <> 'Requested' then
    raise exception 'Only pending requests can be withdrawn (this one is %).', lower(r.status::text) using errcode = 'P0001';
  end if;

  perform set_config('flyvera.change_reason', 'Withdrawn by the requester', true);
  update public.refunds
  set status = 'Rejected', withdrawn_by = auth.uid(), withdrawn_at = now(), decision_note = 'Withdrawn by the requester'
  where id = r.id;
  perform set_config('flyvera.change_reason', '', true);

  perform private.refund_event(r.organization_id, r.booking_id, format('Refund request %s withdrawn', r.reference_number));
end;
$$;

create or replace function public.pay_refund(p_refund_id uuid, p_paid_on date, p_method public.payment_method, p_reference text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r         record;
  booked_on date;
  v_ref     text := nullif(btrim(coalesce(p_reference, '')), '');
begin
  select * into r from public.refunds where id = p_refund_id;
  if r.id is null or not private.is_finance(r.organization_id) then
    raise exception 'Only Finance or an admin can pay refunds.' using errcode = '42501';
  end if;
  if r.status <> 'Approved' then
    raise exception 'Only approved refunds can be paid (this one is %).', lower(r.status::text) using errcode = 'P0001';
  end if;
  if r.requested_by = auth.uid() and not private.has_role(r.organization_id, 'admin') then
    raise exception 'You requested this refund, so someone else in Finance (or an admin) must pay it.' using errcode = '42501';
  end if;
  select created_at::date into booked_on from public.bookings where id = r.booking_id;
  if p_paid_on is null or p_paid_on > current_date or p_paid_on < booked_on then
    raise exception 'The refund date must be between the booking date and today.' using errcode = '22023';
  end if;
  if p_method is null then
    raise exception 'Choose how the refund was sent.' using errcode = '22023';
  end if;
  if v_ref is not null and char_length(v_ref) > 60 then
    raise exception 'Keep the reference under 60 characters.' using errcode = '22023';
  end if;

  perform set_config('flyvera.change_reason', 'Refund paid', true);
  update public.refunds set status = 'Paid', paid_on = p_paid_on, method = p_method, payment_reference = v_ref where id = r.id;
  update public.bookings set refund_decision = 'Refunded' where id = r.booking_id;
  perform set_config('flyvera.change_reason', '', true);

  perform private.refund_event(r.organization_id, r.booking_id, format('Refund %s of %s %s paid (%s%s)', r.reference_number, r.currency, private.money_text(r.amount),
                                         p_method, case when v_ref is null then '' else ', ref ' || v_ref end));
end;
$$;

-- ── 5. One step: a refund Finance has already sent ──────────────────────────
create or replace function public.record_paid_refund(
  p_booking_id uuid,
  p_amount     numeric,
  p_method     public.payment_method,
  p_paid_on    date,
  p_category   text,
  p_details    text,
  p_reference  text
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  b         record;
  r         record;
  v_details text := btrim(coalesce(p_details, ''));
  v_ref     text := nullif(btrim(coalesce(p_reference, '')), '');
begin
  select id, organization_id, code, status, refund_decision, currency, created_at into b from public.bookings where id = p_booking_id;
  if b.id is null or not private.is_finance(b.organization_id) then
    raise exception 'Only Finance or an admin can record refunds.' using errcode = '42501';
  end if;
  if b.status <> 'Cancelled' then
    raise exception 'Refunds can only be recorded on cancelled bookings.' using errcode = 'P0001';
  end if;
  if b.refund_decision = 'Kept as fee' then
    raise exception 'This booking was settled as a cancellation fee.' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'Enter an amount above 0 with at most 2 decimal places.' using errcode = '22023';
  end if;
  if p_category is null or p_category not in ('Cancellation', 'Airline refund', 'Schedule change', 'Duplicate payment', 'Other') then
    raise exception 'Choose a reason.' using errcode = '22023';
  end if;
  if char_length(v_details) < 5 or char_length(v_details) > 200 then
    raise exception 'Explain the refund (5–200 characters).' using errcode = '22023';
  end if;
  if p_paid_on is null or p_paid_on > current_date or p_paid_on < b.created_at::date then
    raise exception 'The refund date must be between the booking date and today.' using errcode = '22023';
  end if;
  if v_ref is not null and char_length(v_ref) > 60 then
    raise exception 'Keep the reference under 60 characters.' using errcode = '22023';
  end if;

  perform set_config('flyvera.change_reason', 'Recorded directly — no separate approval', true);
  insert into public.refunds (organization_id, booking_id, amount, requested_amount, currency, method, status, reason, reason_category,
                              requested_by, approved_by, approved_at, paid_on, payment_reference, recorded_directly)
  values (b.organization_id, b.id, p_amount, p_amount, b.currency, p_method, 'Paid', v_details, p_category,
          auth.uid(), auth.uid(), now(), p_paid_on, v_ref, true)
  returning * into r;
  update public.bookings set refund_decision = 'Refunded' where id = b.id;
  perform set_config('flyvera.change_reason', '', true);

  perform private.refund_event(r.organization_id, r.booking_id, format('Refund %s of %s %s paid (%s) — recorded directly, no separate approval — %s',
                                         r.reference_number, b.currency, private.money_text(p_amount), p_method, v_details));
  return r.id;
end;
$$;

-- ── 6. Every step goes through the functions ────────────────────────────────
revoke insert, update on public.refunds from authenticated;

revoke execute on function
  public.request_refund(uuid, numeric, public.payment_method, text, text, uuid),
  public.approve_refund(uuid, numeric, text),
  public.reject_refund(uuid, text),
  public.withdraw_refund(uuid),
  public.pay_refund(uuid, date, public.payment_method, text),
  public.record_paid_refund(uuid, numeric, public.payment_method, date, text, text, text)
  from public, anon;
grant execute on function
  public.request_refund(uuid, numeric, public.payment_method, text, text, uuid),
  public.approve_refund(uuid, numeric, text),
  public.reject_refund(uuid, text),
  public.withdraw_refund(uuid),
  public.pay_refund(uuid, date, public.payment_method, text),
  public.record_paid_refund(uuid, numeric, public.payment_method, date, text, text, text)
  to authenticated;
revoke execute on function private.refund_event(uuid, uuid, text) from public, anon, authenticated;
