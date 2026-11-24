-- ════════════════════════════════════════════════════════════════════════════
-- FLYVERA CRM · Migration 14 · Integrity hardening
-- ════════════════════════════════════════════════════════════════════════════
-- Closes small gaps found in the pre-production review:
--   1. Tasks, flight searches, AI actions: who created / requested a record and
--      which organization it belongs to can no longer be changed after insert.
--   2. AI actions: reviewed_by / reviewed_at are stamped by the database with the
--      signed-in user — nobody can record someone else as the reviewer.
--   3. Travel documents: verified_by / verified_at are stamped the same way.
--   4. Archived (soft-deleted) customers, leads and quotations are hidden from
--      everyone except admins, and only admins can edit them.
--   5. quotation_totals gets the explicit role filter the other views have.
--
-- Every guard applies only to signed-in users (auth.uid() is not null). The
-- service role, the SQL editor and seed scripts are unaffected.
-- No data is changed and nothing is dropped.

-- ── 1. Columns that never change after insert ──────────────────────────────
-- Trigger arguments: the column names to protect.
create or replace function private.guard_immutable_columns()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  col    text;
  old_j  jsonb := to_jsonb(old);
  new_j  jsonb := to_jsonb(new);
begin
  if auth.uid() is null then
    return new;
  end if;
  foreach col in array tg_argv loop
    if new_j -> col is distinct from old_j -> col then
      raise exception '% cannot be changed on %.', col, tg_table_name using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

create trigger tasks_guard_immutable before update on public.tasks
  for each row execute function private.guard_immutable_columns('organization_id', 'created_by');
create trigger flight_searches_guard_immutable before update on public.flight_searches
  for each row execute function private.guard_immutable_columns('organization_id', 'created_by');
create trigger ai_actions_guard_immutable before update on public.ai_actions
  for each row execute function private.guard_immutable_columns('organization_id', 'requested_by');

-- ── 2. AI action review is stamped with the real reviewer ──────────────────
-- INSERT: a request that arrives already decided is recorded as decided by the
--         requester; otherwise the review fields start empty.
-- UPDATE: the review fields keep their old values, except when the status
--         moves to Approved / Rejected (or straight to Applied with no earlier
--         review) — then they are set to the current user and now().
create or replace function private.stamp_ai_review()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status in ('Approved', 'Rejected', 'Applied') then
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
    else
      new.reviewed_by := null;
      new.reviewed_at := null;
    end if;
    return new;
  end if;

  new.reviewed_by := old.reviewed_by;
  new.reviewed_at := old.reviewed_at;
  if new.status is distinct from old.status
     and (new.status in ('Approved', 'Rejected')
          or (new.status = 'Applied' and old.reviewed_by is null)) then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;

create trigger ai_actions_stamp_review before insert or update on public.ai_actions
  for each row execute function private.stamp_ai_review();

-- ── 3. Travel document verification is stamped with the real verifier ──────
-- Setting verified_by (to any value) records the current user and now();
-- clearing it clears verified_at. verified_at can't be edited on its own.
create or replace function private.stamp_document_verification()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.verified_by is distinct from old.verified_by then
    if new.verified_by is null then
      new.verified_at := null;
    else
      new.verified_by := auth.uid();
      new.verified_at := now();
    end if;
  else
    new.verified_at := old.verified_at;
  end if;
  return new;
end;
$$;

create trigger customer_travel_documents_stamp_verification before update on public.customer_travel_documents
  for each row execute function private.stamp_document_verification();

-- ── 4. Archived records: admins only ───────────────────────────────────────
-- RESTRICTIVE policies are AND-ed with the existing ones, so they only ever
-- narrow access. Admins see, edit, archive and restore (plain UPDATE of
-- deleted_at). Everyone else archives through archive_customer() /
-- archive_lead() / archive_quotation() below — PostgreSQL checks an updated
-- row against the SELECT policies, so a non-admin can't archive with a plain
-- UPDATE (the row would become invisible to them).
create policy "customers: archived rows admins only" on public.customers
  as restrictive for select to authenticated
  using (deleted_at is null or private.has_role(organization_id, 'admin'));
create policy "customers: archived rows edited by admins only" on public.customers
  as restrictive for update to authenticated
  using (deleted_at is null or private.has_role(organization_id, 'admin'));

create policy "leads: archived rows admins only" on public.leads
  as restrictive for select to authenticated
  using (deleted_at is null or private.has_role(organization_id, 'admin'));
create policy "leads: archived rows edited by admins only" on public.leads
  as restrictive for update to authenticated
  using (deleted_at is null or private.has_role(organization_id, 'admin'));

create policy "quotations: archived rows admins only" on public.quotations
  as restrictive for select to authenticated
  using (deleted_at is null or private.has_role(organization_id, 'admin'));
create policy "quotations: archived rows edited by admins only" on public.quotations
  as restrictive for update to authenticated
  using (deleted_at is null or private.has_role(organization_id, 'admin'));

-- Archive functions: allowed for whoever may edit the record (same rules as
-- the existing UPDATE policies). The audit log records the caller.
create or replace function public.archive_customer(p_customer_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  c record;
begin
  select id, organization_id, assigned_to into c
  from public.customers where id = p_customer_id and deleted_at is null;
  if c.id is null or not private.can_write_customer(c.organization_id, c.assigned_to) then
    raise exception 'You cannot archive this customer.' using errcode = '42501';
  end if;
  update public.customers set deleted_at = now() where id = c.id;
end;
$$;

create or replace function public.archive_lead(p_lead_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  l record;
begin
  select id, organization_id, assigned_to into l
  from public.leads where id = p_lead_id and deleted_at is null;
  if l.id is null or not private.can_write_lead(l.organization_id, l.assigned_to) then
    raise exception 'You cannot archive this lead.' using errcode = '42501';
  end if;
  update public.leads set deleted_at = now() where id = l.id;
end;
$$;

create or replace function public.archive_quotation(p_quotation_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  q record;
begin
  select id, organization_id, customer_id, lead_id, prepared_by into q
  from public.quotations where id = p_quotation_id and deleted_at is null;
  if q.id is null or not private.can_write_quotation(q.organization_id, q.customer_id, q.lead_id, q.prepared_by) then
    raise exception 'You cannot archive this quotation.' using errcode = '42501';
  end if;
  update public.quotations set deleted_at = now() where id = q.id;
end;
$$;

revoke execute on function
  public.archive_customer(uuid), public.archive_lead(uuid), public.archive_quotation(uuid)
  from public, anon;
grant execute on function
  public.archive_customer(uuid), public.archive_lead(uuid), public.archive_quotation(uuid)
  to authenticated;

-- ── 5. quotation_totals: explicit role filter ──────────────────────────────
-- Same roles that can read quotations (support agents get no rows). Columns
-- are unchanged, so existing grants are kept.
create or replace view public.quotation_totals
with (security_invoker = true) as
with base as (
  select q.id as quotation_id, q.organization_id, q.code, q.status, q.valid_until, q.currency,
         s.subtotal, least(q.discount, s.subtotal) as discount, q.tax_rate, s.cost
  from public.quotations q
  cross join lateral (
    select coalesce(sum(round(i.quantity * i.unit_price, 2)), 0)::numeric(12, 2) as subtotal,
           coalesce(sum(i.cost), 0)::numeric(12, 2) as cost
    from public.quotation_items i where i.quotation_id = q.id
  ) s
  where private.has_role(q.organization_id, 'admin', 'sales_manager', 'sales_agent', 'ticketing_agent', 'finance_manager')
), calc as (
  select *, (subtotal - discount)::numeric(12, 2) as taxable,
         round((subtotal - discount) * tax_rate / 100, 2)::numeric(12, 2) as tax
  from base
)
select quotation_id, organization_id, code, status,
       (status = 'Sent' and valid_until < current_date) as is_expired,
       currency, subtotal, discount, taxable, tax_rate, tax,
       (taxable + tax)::numeric(12, 2) as total,
       cost,
       (taxable - cost)::numeric(12, 2) as profit,
       case when taxable > 0 then round((taxable - cost) / taxable * 100, 1) end as margin_percent
from calc;

-- ── Function privileges (same rule as migration 10) ────────────────────────
revoke execute on function
  private.guard_immutable_columns(),
  private.stamp_ai_review(),
  private.stamp_document_verification()
  from public, anon;
