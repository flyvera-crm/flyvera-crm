-- ════════════════════════════════════════════════════════════════════════════
-- FLYVERA CRM · Migration 22 · Answered (Accepted / Declined) quotations are final
-- ════════════════════════════════════════════════════════════════════════════
-- The app already treats an accepted or declined quotation as final ("Duplicate it instead"), but the
-- database still let any user who may edit the quotation change it through the API: edit its details,
-- move it back to Draft, or change its item prices. This migration makes the database enforce the rule:
--
--   1. An Accepted or Declined quotation can't be changed, except for archiving / restoring it
--      (deleted_at, with the existing rules: archive_quotation() and the admin-only restore).
--      This covers its status too, so it can't be moved back to Draft/Sent or flipped to the other answer.
--   2. Its items can't be added, changed or removed. When a whole quotation is deleted (admins only,
--      existing policy), its items still go with it.
--
-- Unchanged: Draft and Sent quotations (editing, items, Draft → Sent → Accepted/Declined); who may
-- read, create, edit, archive, restore or delete quotations (RLS); bookings and invoices made from an
-- accepted quotation (they only read it); the audit trail (blocked changes are never written, so they
-- leave no audit entry; allowed ones are audited as before).
--
-- Like the other guards (migration 14), these apply only to signed-in users (auth.uid() is not null):
-- the service role, the SQL editor and seed scripts are unaffected, so a support correction stays possible.
-- No data is changed and nothing is dropped.

-- ── 1. Quotations ────────────────────────────────────────────────────────────
create or replace function private.guard_answered_quotation()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or old.status not in ('Accepted', 'Declined') then
    return new;
  end if;
  -- Everything except archiving/restoring (deleted_at) and the automatic updated_at must stay as it was.
  if (to_jsonb(new) - array['deleted_at', 'updated_at']) is distinct from (to_jsonb(old) - array['deleted_at', 'updated_at']) then
    raise exception 'Quotation % was %, so it can''t be changed. Duplicate it to make a revised quotation.',
      old.code, lower(old.status::text)
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger quotations_guard_answered before update on public.quotations
  for each row execute function private.guard_answered_quotation();

-- ── 2. Quotation items ───────────────────────────────────────────────────────
create or replace function private.guard_answered_quotation_items()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  q record;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  -- The quotation the item belongs to (and, for a move, the one it would move to).
  for q in
    select x.code, x.status
    from public.quotations x
    where x.id in (
      case when tg_op in ('UPDATE', 'DELETE') then old.quotation_id end,
      case when tg_op in ('INSERT', 'UPDATE') then new.quotation_id end
    )
  loop
    if q.status in ('Accepted', 'Declined') then
      raise exception 'Quotation % was %, so its items can''t be changed. Duplicate it to make a revised quotation.',
        q.code, lower(q.status::text)
        using errcode = '42501';
    end if;
  end loop;
  -- No row found = the quotation itself is being deleted and its items go with it (allowed).
  return coalesce(new, old);
end;
$$;

create trigger quotation_items_guard_answered before insert or update or delete on public.quotation_items
  for each row execute function private.guard_answered_quotation_items();

-- Trigger functions are called by the triggers only.
revoke execute on function private.guard_answered_quotation(), private.guard_answered_quotation_items() from public, anon, authenticated;
