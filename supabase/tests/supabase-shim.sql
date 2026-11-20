-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️  TEST ONLY — NEVER RUN THIS AGAINST A REAL SUPABASE PROJECT  ⚠️
-- ════════════════════════════════════════════════════════════════════════════
-- PGlite is plain PostgreSQL. Real Supabase adds the auth, storage and vault
-- schemas, the anon / authenticated / service_role roles and some default
-- grants. This file recreates MINIMAL stand-ins so the FLYVERA migrations can
-- be applied and tested locally. It is deliberately simple; behaviour of the
-- real services (JWT validation, storage API, Vault encryption at rest) is NOT
-- reproduced — see docs/database/README.md → "What PGlite tests do not cover".

-- Roles -------------------------------------------------------------------------
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

-- Extensions schema (Supabase installs extensions here) ------------------------
create schema extensions;
create extension pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- auth --------------------------------------------------------------------------
create schema auth;
create table auth.users (
  instance_id         uuid,
  id                  uuid primary key,
  aud                 text,
  role                text,
  email               text unique,
  encrypted_password  text,
  email_confirmed_at  timestamptz,
  raw_app_meta_data   jsonb default '{}'::jsonb,
  raw_user_meta_data  jsonb default '{}'::jsonb,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- Same contract as Supabase: the signed-in user's id comes from the JWT claims.
create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), '')::uuid;
$$;

create function auth.role() returns text
language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;

-- storage -----------------------------------------------------------------------
create schema storage;
create table storage.buckets (
  id                  text primary key,
  name                text not null unique,
  public              boolean not null default false,
  file_size_limit     bigint,
  allowed_mime_types  text[],
  created_at          timestamptz not null default now()
);
create table storage.objects (
  id          uuid primary key default gen_random_uuid(),
  bucket_id   text references storage.buckets (id),
  name        text not null,
  owner       uuid,
  metadata    jsonb,
  created_at  timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;

-- Same behaviour as Supabase's storage.foldername(): folders of a path, without the file name.
create function storage.foldername(name text) returns text[]
language plpgsql immutable
as $$
declare
  parts text[] := string_to_array(name, '/');
begin
  return parts[1:array_length(parts, 1) - 1];
end;
$$;

grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- vault (real Vault encrypts secrets at rest; this stand-in does not) --------------
create schema vault;
create table vault.secrets (
  id           uuid primary key default gen_random_uuid(),
  name         text unique,
  secret       text not null,
  description  text,
  created_at   timestamptz not null default now()
);
create view vault.decrypted_secrets as
  select id, name, secret as decrypted_secret, description, created_at from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid
language sql
as $$
  insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id;
$$;
revoke all on schema vault from public;   -- as in Supabase: only privileged roles can read secrets

-- Supabase's default privileges: the API roles get everything in `public`,
-- and Row Level Security is what actually protects the data. Our migrations
-- are tested against these permissive defaults on purpose.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
