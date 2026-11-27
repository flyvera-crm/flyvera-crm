-- ════════════════════════════════════════════════════════════════════════════
-- FLYVERA CRM · Migration 23 · Manual PNR verification
-- ════════════════════════════════════════════════════════════════════════════
-- Staff check a PNR with the airline or consolidator (website, phone, portal) and record the result.
-- Verification is its own status, separate from the PNR's reservation status (Active / Ticketed /
-- Cancelled / Expired, unchanged) and from tickets (issue_ticket / change_ticket_status, unchanged).
--
--   1. pnr_records gets:
--        airline              the airline's 2-character code (optional, e.g. EK)
--        verification_status  Pending (default) / Verified / Not verified
--        verified_at, verified_by, verification_notes
--   2. verify_pnr(pnr, status, notes) is the only way to record a result. It stamps the signed-in user
--      and the time itself, needs notes when the result is "Not verified", writes a line to the booking's
--      timeline, and is audited (pnr_records is already in the audit trail). Same people as managing
--      PNRs today: admins and ticketing agents.
--   3. If a PNR's identifying details change (record locator, airline locator, airline, provider), its
--      verification no longer applies and goes back to Pending.
--
-- Unchanged: who may read, add, edit or delete PNRs (RLS); the PNR status values; tickets, segments,
-- bookings. Existing PNRs start as Pending (production has none today). Like the other guards, the
-- rules apply to signed-in app users; the service role / SQL editor (imports, seed) is exempt.

-- ── 1. Columns ───────────────────────────────────────────────────────────────
create type public.pnr_verification_status as enum ('Pending', 'Verified', 'Not verified');

alter table public.pnr_records
  add column airline             char(2) check (airline ~ '^[A-Z0-9]{2}$'),
  add column verification_status public.pnr_verification_status not null default 'Pending',
  add column verified_at         timestamptz,
  add column verified_by         uuid references public.profiles (id) on delete set null,
  add column verification_notes  text check (char_length(verification_notes) <= 500),
  -- Pending = never checked (no date); a result always has its date.
  add constraint pnr_records_verified_at_matches_status
    check ((verification_status = 'Pending') = (verified_at is null)),
  -- "Not verified" must say why.
  add constraint pnr_records_not_verified_needs_notes
    check (verification_status <> 'Not verified' or char_length(btrim(coalesce(verification_notes, ''))) >= 3);

comment on column public.pnr_records.verification_status is
  'Manual check of the PNR with the airline/consolidator. Separate from status (reservation) and from tickets. Set only through verify_pnr().';

-- ── 2. Guard: verification fields change only through verify_pnr() ─────────
create or replace function private.guard_pnr_verification()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or current_setting('crm.verifying_pnr', true) = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A new PNR always starts unverified, whatever was sent.
    new.verification_status := 'Pending';
    new.verified_at := null;
    new.verified_by := null;
    new.verification_notes := null;
    return new;
  end if;

  -- Identifying details changed: the earlier check no longer applies.
  if (new.record_locator, new.airline_locator, new.airline, new.provider)
     is distinct from (old.record_locator, old.airline_locator, old.airline, old.provider) then
    new.verification_status := 'Pending';
    new.verified_at := null;
    new.verified_by := null;
    new.verification_notes := null;
    return new;
  end if;

  -- Otherwise the verification fields keep their values (only verify_pnr() records a result).
  new.verification_status := old.verification_status;
  new.verified_at := old.verified_at;
  new.verified_by := old.verified_by;
  new.verification_notes := old.verification_notes;
  return new;
end;
$$;

create trigger pnr_records_guard_verification before insert or update on public.pnr_records
  for each row execute function private.guard_pnr_verification();

-- ── 3. Recording a result ───────────────────────────────────────────────────
create or replace function public.verify_pnr(
  p_pnr_id uuid,
  p_status public.pnr_verification_status,
  p_notes  text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p     record;
  notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  select id, organization_id, booking_id, record_locator into p
  from public.pnr_records where id = p_pnr_id;
  if p.id is null or not private.has_role(p.organization_id, 'admin', 'ticketing_agent') then
    raise exception 'You cannot verify this PNR.' using errcode = '42501';
  end if;
  if p_status is null or p_status = 'Pending' then
    raise exception 'Choose Verified or Not verified.' using errcode = 'P0001';
  end if;
  if p_status = 'Not verified' and char_length(coalesce(notes, '')) < 3 then
    raise exception 'Say why the PNR could not be verified.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(notes, '')) > 500 then
    raise exception 'Notes can be at most 500 characters.' using errcode = 'P0001';
  end if;

  perform set_config('crm.verifying_pnr', 'on', true);
  update public.pnr_records
     set verification_status = p_status,
         verified_at = now(),
         verified_by = auth.uid(),
         verification_notes = notes
   where id = p.id;
  perform set_config('crm.verifying_pnr', 'off', true);

  insert into public.booking_events (organization_id, booking_id, body, created_by)
  values (p.organization_id, p.booking_id,
          left(format('PNR %s %s', p.record_locator, lower(p_status::text)) || coalesce(' — ' || notes, ''), 300),
          auth.uid());
end;
$$;

revoke execute on function public.verify_pnr(uuid, public.pnr_verification_status, text) from public, anon;
grant execute on function public.verify_pnr(uuid, public.pnr_verification_status, text) to authenticated;
revoke execute on function private.guard_pnr_verification() from public, anon, authenticated;
