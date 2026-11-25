-- ════════════════════════════════════════════════════════════════════════════
-- FLYVERA CRM · Migration 21 · Gap fills: archive safeguards, lead stage history,
--                              money lines in booking timelines
-- ════════════════════════════════════════════════════════════════════════════
--   1. A customer with active bookings, or a quotation that became a booking, can't be
--      archived (archive_customer / archive_quotation keep their other rules).
--      Restoring stays a plain admin update (migration 14 already limits that to admins).
--   2. Every change of a lead's stage is written to lead_activities automatically
--      ("Stage change", from → to, by whom; the lost reason as the note).
--   3. Booking timeline lines that mention an amount or currency are readable only by
--      roles that may see that booking's money — support no longer receives them.
-- Suppliers and manual lead activity need no changes: their tables and policies exist.

-- ── 1. Archive safeguards ───────────────────────────────────────────────────
create or replace function public.archive_customer(p_customer_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  c      record;
  v_open text;
begin
  select id, organization_id, assigned_to into c
  from public.customers where id = p_customer_id and deleted_at is null;
  if c.id is null or not private.can_write_customer(c.organization_id, c.assigned_to) then
    raise exception 'You cannot archive this customer.' using errcode = '42501';
  end if;
  select string_agg(b.code, ', ' order by b.code) into v_open
  from public.bookings b
  where b.customer_id = c.id and b.status not in ('Completed', 'Cancelled');
  if v_open is not null then
    raise exception 'This customer has active bookings (%). Complete or cancel them first.', v_open using errcode = 'P0001';
  end if;
  update public.customers set deleted_at = now() where id = c.id;
end;
$$;

create or replace function public.archive_quotation(p_quotation_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  q         record;
  v_booking text;
begin
  select id, organization_id, customer_id, lead_id, prepared_by into q
  from public.quotations where id = p_quotation_id and deleted_at is null;
  if q.id is null or not private.can_write_quotation(q.organization_id, q.customer_id, q.lead_id, q.prepared_by) then
    raise exception 'You cannot archive this quotation.' using errcode = '42501';
  end if;
  select code into v_booking from public.bookings where quotation_id = q.id;
  if v_booking is not null then
    raise exception 'This quotation became booking % and stays on record.', v_booking using errcode = 'P0001';
  end if;
  update public.quotations set deleted_at = now() where id = q.id;
end;
$$;

-- ── 2. Lead stage history ───────────────────────────────────────────────────
create or replace function private.log_lead_stage_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.lead_activities (organization_id, lead_id, activity_type, body, from_stage, to_stage, created_by)
  values (new.organization_id, new.id, 'Stage change',
          case when new.stage = 'Lost' then nullif(btrim(coalesce(new.lost_reason, '')), '') end,
          old.stage, new.stage, auth.uid());
  return new;
end;
$$;
revoke execute on function private.log_lead_stage_change() from public, anon, authenticated;

create trigger leads_log_stage_change
  after update of stage on public.leads
  for each row when (new.stage is distinct from old.stage)
  execute function private.log_lead_stage_change();

-- ── 3. Money lines in booking timelines ─────────────────────────────────────
-- Same rule as the app's mentionsMoney() (src/lib/dashboard-metrics.ts): a currency sign,
-- a currency code, or an amount with two decimals.
alter table public.booking_events
  add column mentions_money boolean generated always as (
    body ~ '[$€£]|\m(USD|EUR|GBP|AED|SAR|QAR)\M|\m[0-9][0-9,]*\.[0-9]{2}\M'
  ) stored;
comment on column public.booking_events.mentions_money is
  'true when the line mentions an amount or currency; such lines are only readable with access to the booking''s money.';

-- RESTRICTIVE: AND-ed with "booking events: read with the booking", so it only narrows access.
create policy "booking events: money lines need money access" on public.booking_events
  as restrictive for select to authenticated
  using (not mentions_money or private.can_view_booking_money(organization_id, booking_id));
