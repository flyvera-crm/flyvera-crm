-- ════════════════════════════════════════════════════════════════════════════
-- FLYVERA CRM · Migration 01 · Extensions, schemas and shared helpers
-- ════════════════════════════════════════════════════════════════════════════
-- Supabase already provides the `extensions`, `auth`, `storage` and `vault`
-- schemas. Everything FLYVERA-specific lives in:
--   • public  – business tables (exposed through the Supabase API, protected by RLS)
--   • private – helper functions & internal tables (NOT exposed through the API)

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
comment on schema private is
  'FLYVERA internal helpers (access checks, encryption, counters). Never add this schema to the API''s exposed schemas.';

revoke all on schema private from public;
-- Policies call private.* functions as the signed-in user, so they need USAGE.
grant usage on schema private to authenticated, service_role;

-- Keeps updated_at current on every UPDATE.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Returns NULL instead of raising when text is not a UUID (used for storage paths).
create or replace function private.try_uuid(value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return value::uuid;
exception when others then
  return null;
end;
$$;
