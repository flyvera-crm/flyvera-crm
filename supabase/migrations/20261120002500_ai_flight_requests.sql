-- ════════════════════════════════════════════════════════════════════════════
-- FLYVERA CRM · Migration 25 · AI reading of flight requests (logged, limited, no personal data)
-- ════════════════════════════════════════════════════════════════════════════
-- Agents can type a trip request in plain words; the AI turns it into search details that the agent
-- reviews and approves before anything is saved. The AI never produces fares or availability.
--
--   1. ai_actions gets the kind "Flight request" and a link to the flight search the agent saved after
--      reviewing it. Every AI reading is logged there (Proposed → Applied / Rejected, or Failed).
--   2. At most 50 flight-request readings per person per day (UTC), counted in the database and
--      serialised per person, so it holds even for simultaneous requests.
--   3. The text sent to the AI must not contain personal identification details: e-mail addresses,
--      phone or other long ID numbers, or passport-style numbers are refused before anything is sent.
--      (The app checks this first; this is the backstop.) Names of linked customers / leads are checked
--      by the app, which knows them.
--
-- Unchanged: the other AI action kinds and their rules, who may read or review AI actions, flight
-- searches and their rules. Production has no AI actions today.

-- ── 1. Kind and link ─────────────────────────────────────────────────────────
alter type public.ai_action_kind add value if not exists 'Flight request';

alter table public.ai_actions
  add column flight_search_id uuid,
  add constraint ai_actions_flight_search_fkey
    foreign key (flight_search_id, organization_id) references public.flight_searches (id, organization_id)
    on delete set null (flight_search_id);

comment on column public.ai_actions.flight_search_id is
  'For a Flight request: the flight search the agent saved after reviewing and approving the AI''s reading.';

-- ── 2 + 3. Daily limit and personal-data backstop ───────────────────────────
create or replace function private.guard_ai_flight_request()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  daily_limit constant integer := 50;
  used        integer;
  txt         text;
  scrubbed    text;
begin
  if auth.uid() is null or new.action_kind::text <> 'Flight request' then
    return new;
  end if;

  -- Personal identification details must never reach the AI (input.text is what is sent).
  txt := coalesce(new.input ->> 'text', '');
  -- Dates (2027-01-15, 15/01/2027, 15.01.27) are travel details, not IDs: ignore them before counting digits.
  scrubbed := regexp_replace(txt, '\m\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\M', ' ', 'g');
  if txt ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
     or scrubbed ~ '\+?\d[\d\s().-]{5,}\d' and length(regexp_replace(substring(scrubbed from '\+?\d[\d\s().-]{5,}\d'), '\D', '', 'g')) >= 7
     or txt ~ '\m[A-Za-z]{1,2}\d{6,9}\M' then
    raise exception 'Remove personal details (e-mail addresses, phone numbers, passport or other ID numbers) before asking the AI.'
      using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    -- One person's requests are counted one at a time, so simultaneous requests can't exceed the limit.
    perform pg_advisory_xact_lock(hashtext('ai-flight-request:' || new.requested_by::text));
    select count(*) into used
    from public.ai_actions
    where requested_by = new.requested_by
      and action_kind::text = 'Flight request'
      and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
    if used >= daily_limit then
      raise exception 'Daily limit reached: % AI flight-request readings per person per day. Try again tomorrow.', daily_limit
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger ai_actions_guard_flight_request before insert or update of input on public.ai_actions
  for each row execute function private.guard_ai_flight_request();

revoke execute on function private.guard_ai_flight_request() from public, anon, authenticated;
