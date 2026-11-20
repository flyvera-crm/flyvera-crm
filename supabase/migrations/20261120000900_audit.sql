-- ════════════════════════════════════════════════════════════════════════════
-- FLYVERA CRM · Migration 09 · Audit log
-- ════════════════════════════════════════════════════════════════════════════
-- Append-only history of who changed what. Written ONLY by triggers and by the
-- passport "reveal" functions (security definer). Nobody — not even an admin
-- using the app — can edit or delete audit entries. Sensitive values are
-- replaced before they are stored.

create table public.audit_logs (
  id               bigint generated always as identity primary key,
  organization_id  uuid references public.organizations (id) on delete cascade,
  actor_id         uuid,                       -- no FK: the log must outlive deleted users
  action           text not null check (action in ('INSERT', 'UPDATE', 'DELETE', 'REVEAL', 'EXPORT')),
  table_name       text not null,
  record_id        uuid,
  changed_fields   text[],
  old_data         jsonb,
  new_data         jsonb,
  context          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index audit_logs_org_time_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_record_idx on public.audit_logs (table_name, record_id);
alter table public.audit_logs enable row level security;

-- Keys that must never be copied into the audit log in readable form.
create or replace function private.redact(data jsonb)
returns jsonb
language sql immutable set search_path = ''
as $$
  select case when data is null then null else
    (select coalesce(jsonb_object_agg(
       key,
       case
         when key in ('document_number_encrypted') then to_jsonb('[encrypted]'::text)
         when key in ('date_of_birth') and value <> 'null'::jsonb then to_jsonb('[redacted]'::text)
         else value
       end), '{}'::jsonb)
     from jsonb_each(data))
  end;
$$;

create or replace function private.audit_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  old_j   jsonb;
  new_j   jsonb;
  changed text[];
  org     uuid;
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

  insert into public.audit_logs (organization_id, actor_id, action, table_name, record_id, changed_fields, old_data, new_data)
  values (
    org,
    auth.uid(),
    tg_op,
    tg_table_name,
    coalesce(new_j ->> 'id', old_j ->> 'id', new_j ->> 'user_id', old_j ->> 'user_id')::uuid,
    changed,
    old_j,
    new_j
  );
  return null;
end;
$$;

-- Attach to every table whose changes matter for compliance & disputes.
do $$
declare
  t text;
begin
  foreach t in array array[
    'organizations', 'organization_members', 'teams', 'team_members', 'organization_invitations',
    'customers', 'customer_travel_documents', 'leads', 'quotations',
    'bookings', 'booking_services', 'passengers', 'pnr_records', 'booking_segments', 'tickets', 'ticket_documents',
    'payments', 'refunds', 'invoices', 'supplier_transactions', 'suppliers',
    'ai_actions'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_change()',
      t || '_audit', t
    );
  end loop;
end;
$$;

-- Used by reveal functions and future export features.
create or replace function private.log_access(org uuid, action text, tbl text, rec uuid, ctx jsonb)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.audit_logs (organization_id, actor_id, action, table_name, record_id, context)
  values (org, auth.uid(), action, tbl, rec, coalesce(ctx, '{}'::jsonb));
$$;
