-- ════════════════════════════════════════════════════════════════════════════
-- FLYVERA CRM · Migration 03 · Organizations, users, team roles
-- ════════════════════════════════════════════════════════════════════════════
-- FLYVERA TRAVEL runs as a single agency, but every business row carries
-- organization_id so branches/agencies can be added later.
-- There is NO public sign-up: people get access only through an invitation
-- created by an admin (see private.handle_new_user below).

-- Organizations ---------------------------------------------------------------
create table public.organizations (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null check (char_length(btrim(name)) between 2 and 120),
  slug                    text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  parent_organization_id  uuid references public.organizations (id) on delete set null,
  base_currency           char(3) not null default 'USD' check (base_currency ~ '^[A-Z]{3}$'),
  timezone                text not null default 'UTC',
  settings                jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
comment on table public.organizations is 'An agency (or, later, a branch). Settings hold quote terms, validity days, default tax, margin alert, etc.';
comment on column public.organizations.parent_organization_id is 'Future use: a branch points at its head-office organization.';

-- Profiles (one per login user) -----------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  full_name     text not null default '' check (char_length(full_name) <= 120),
  display_name  text check (char_length(display_name) <= 40),
  phone         text check (phone is null or regexp_replace(phone, '[\s().-]', '', 'g') ~ '^\+[0-9]{7,15}$'),
  avatar_url    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.profiles is 'Public profile of a Supabase Auth user (name shown in the CRM, e.g. "Sara K.").';

-- Membership + role -----------------------------------------------------------
create table public.organization_members (
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  role             public.app_role not null,
  status           public.member_status not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);
comment on table public.organization_members is 'Who belongs to which organization and with which role. Disabled members lose all access.';

-- Teams (Sales Managers see records assigned to members of teams they manage)
create table public.teams (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 2 and 60),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, name),
  unique (id, organization_id)
);

create table public.team_members (
  team_id          uuid not null,
  organization_id  uuid not null,
  user_id          uuid not null,
  is_manager       boolean not null default false,
  created_at       timestamptz not null default now(),
  primary key (team_id, user_id),
  foreign key (team_id, organization_id) references public.teams (id, organization_id) on delete cascade,
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade
);
create index team_members_user_idx on public.team_members (organization_id, user_id);

-- Invitations (the only way to join) ------------------------------------------
create table public.organization_invitations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  email            text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role             public.app_role not null,
  invited_by       uuid references public.profiles (id) on delete set null default auth.uid(),
  expires_at       timestamptz not null default now() + interval '14 days',
  accepted_at      timestamptz,
  created_at       timestamptz not null default now()
);
create unique index organization_invitations_pending_uidx
  on public.organization_invitations (organization_id, email) where accepted_at is null;

-- Human-readable codes (CU-1001, LD-2001, QT-3001, FV-10001, INV-2026-0001) ----
create table private.org_counters (
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  kind             text not null,
  last_value       bigint not null,
  primary key (organization_id, kind)
);
comment on table private.org_counters is 'Per-organization sequence for readable codes. Internal only.';

-- RLS on from the start (policies are added in migration 10) ------------------
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.organization_invitations enable row level security;

create trigger organizations_updated_at before update on public.organizations for each row execute function private.set_updated_at();
create trigger profiles_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger organization_members_updated_at before update on public.organization_members for each row execute function private.set_updated_at();
create trigger teams_updated_at before update on public.teams for each row execute function private.set_updated_at();

-- ── Membership helpers ──────────────────────────────────────────────────────
-- SECURITY DEFINER so they can read membership without triggering RLS
-- recursion. All are STABLE and pin search_path for safety.

create or replace function private.member_role(org uuid)
returns public.app_role
language sql stable security definer set search_path = ''
as $$
  select m.role
  from public.organization_members m
  where m.organization_id = org and m.user_id = auth.uid() and m.status = 'active';
$$;

create or replace function private.is_member(org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.member_role(org) is not null;
$$;

create or replace function private.has_role(org uuid, variadic roles public.app_role[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.member_role(org) = any (roles), false);
$$;

-- The current user plus everyone in the teams they manage.
create or replace function private.managed_user_ids(org uuid)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select auth.uid()
  union
  select tm.user_id
  from public.team_members tm
  where tm.organization_id = org
    and tm.team_id in (
      select mine.team_id from public.team_members mine
      where mine.organization_id = org and mine.user_id = auth.uid() and mine.is_manager
    );
$$;

-- Sales visibility of a record assigned to `assignee`:
--   admin → everything · sales_manager → own, their teams' and unassigned · sales_agent → own only
create or replace function private.in_sales_scope(org uuid, assignee uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case private.member_role(org)
    when 'admin' then true
    when 'sales_manager' then assignee is null or assignee in (select private.managed_user_ids(org))
    when 'sales_agent' then assignee is not null and assignee = auth.uid()
    else false
  end;
$$;

-- Do two users share an active organization? (who may see whose profile)
create or replace function private.shares_org(other_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members me
    join public.organization_members them on them.organization_id = me.organization_id
    where me.user_id = auth.uid() and me.status = 'active' and them.user_id = other_user
  );
$$;

-- ── Readable codes ──────────────────────────────────────────────────────────
create or replace function private.next_code(p_org uuid, p_kind text, p_start bigint)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v bigint;
begin
  insert into private.org_counters as c (organization_id, kind, last_value)
  values (p_org, p_kind, p_start)
  on conflict (organization_id, kind) do update set last_value = c.last_value + 1
  returning last_value into v;
  return v;
end;
$$;

-- Trigger: fills NEW.code ('CU-1025') when not given. When a code IS given
-- (imports, seed data), the counter is moved past it so new codes never clash.
-- Trigger arguments: kind, prefix, first number.
create or replace function private.assign_code()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_kind   text := tg_argv[0];
  v_prefix text := tg_argv[1];
  v_first  bigint := tg_argv[2]::bigint;
  n        bigint;
begin
  if new.code is null then
    new.code := v_prefix || private.next_code(new.organization_id, v_kind, v_first);
  else
    n := substring(new.code from '([0-9]+)$')::bigint;
    if n is not null then
      insert into private.org_counters as c (organization_id, kind, last_value)
      values (new.organization_id, v_kind, n)
      on conflict (organization_id, kind) do update set last_value = greatest(c.last_value, excluded.last_value);
    end if;
  end if;
  return new;
end;
$$;

-- ── Sign-up handling (single agency: invitation only) ───────────────────────
create or replace function private.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'display_name'
  )
  on conflict (id) do nothing;

  -- Grant membership ONLY if an admin invited this email address.
  insert into public.organization_members (organization_id, user_id, role)
  select i.organization_id, new.id, i.role
  from public.organization_invitations i
  where i.email = lower(new.email) and i.accepted_at is null and i.expires_at > now()
  on conflict do nothing;

  update public.organization_invitations
  set accepted_at = now()
  where email = lower(new.email) and accepted_at is null and expires_at > now();

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ── Never leave an organization without an active admin ─────────────────────
create or replace function private.protect_last_admin()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.role = 'admin' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role <> 'admin' or new.status <> 'active')
     -- skip when the whole organization is being deleted (cascade)
     and exists (select 1 from public.organizations o where o.id = old.organization_id)
     and not exists (
       select 1 from public.organization_members m
       where m.organization_id = old.organization_id and m.role = 'admin'
         and m.status = 'active' and m.user_id <> old.user_id
     ) then
    raise exception 'An organization must keep at least one active admin.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger organization_members_protect_last_admin
  before update or delete on public.organization_members
  for each row execute function private.protect_last_admin();
