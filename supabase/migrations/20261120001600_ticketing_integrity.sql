-- ════════════════════════════════════════════════════════════════════════════
-- FLYVERA CRM · Migration 16 · Ticketing integrity & auditable ticket history
-- ════════════════════════════════════════════════════════════════════════════
--   1. Links stay inside one booking: a ticket's passenger and PNR, a flight
--      segment's PNR and service, and a ticket document's ticket must all
--      belong to the same booking.
--   2. Tickets are only recorded through issue_ticket() and only change through
--      change_ticket_status():
--        • issuing needs the airline's 13-digit ticket number, a confirmed
--          booking and an active PNR on that booking — nothing is ever marked
--          issued automatically;
--        • after issue, the number, passenger, booking, PNR, fare and issue date
--          are frozen; status only moves forward (Issued → Voided / Refunded /
--          Exchanged), never back;
--        • every status change needs a reason, which goes to the audit log
--          (before/after values) and to the booking's timeline.
--      Direct INSERT / UPDATE / DELETE of tickets by app users is revoked, so the
--      history can't be edited or removed through the API.
-- Existing bookings, payments and tickets are not changed. Rules apply to
-- signed-in app users; the service role / SQL editor (imports, seed) is exempt.

-- ── 1. Same-booking links ───────────────────────────────────────────────────
create or replace function private.check_ticketing_links()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name = 'tickets' then
    if not exists (select 1 from public.passengers p where p.id = new.passenger_id and p.booking_id = new.booking_id) then
      raise exception 'This passenger isn''t on this booking.' using errcode = 'P0001';
    end if;
    if new.pnr_id is not null
       and not exists (select 1 from public.pnr_records r where r.id = new.pnr_id and r.booking_id = new.booking_id) then
      raise exception 'This PNR isn''t on this booking.' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'booking_segments' then
    if new.pnr_id is not null
       and not exists (select 1 from public.pnr_records r where r.id = new.pnr_id and r.booking_id = new.booking_id) then
      raise exception 'This PNR isn''t on this booking.' using errcode = 'P0001';
    end if;
    if new.booking_service_id is not null
       and not exists (select 1 from public.booking_services s where s.id = new.booking_service_id and s.booking_id = new.booking_id) then
      raise exception 'This service isn''t on this booking.' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'ticket_documents' then
    if new.ticket_id is not null
       and not exists (select 1 from public.tickets t where t.id = new.ticket_id and t.booking_id = new.booking_id) then
      raise exception 'This ticket isn''t on this booking.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger tickets_check_links before insert or update on public.tickets
  for each row execute function private.check_ticketing_links();
create trigger booking_segments_check_links before insert or update on public.booking_segments
  for each row execute function private.check_ticketing_links();
create trigger ticket_documents_check_links before insert or update on public.ticket_documents
  for each row execute function private.check_ticketing_links();

-- ── 2. Ticket rules (issue and status changes) ──────────────────────────────
create or replace function private.guard_ticket()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  booking_status public.booking_status;
  pnr_status     public.pnr_status;
begin
  if auth.uid() is null then
    return new;   -- service role / SQL editor (imports, seed data)
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'Issued' then
      raise exception 'A new ticket must be recorded as Issued.' using errcode = 'P0001';
    end if;
    select status into booking_status from public.bookings where id = new.booking_id;
    if booking_status not in ('Confirmed', 'Ticketed') then
      raise exception 'Tickets can only be recorded on a confirmed booking.' using errcode = 'P0001';
    end if;
    if new.pnr_id is null then
      raise exception 'Link the ticket to the airline reservation (PNR) it was issued on.' using errcode = 'P0001';
    end if;
    select status into pnr_status from public.pnr_records where id = new.pnr_id;
    if pnr_status not in ('Active', 'Ticketed') then
      raise exception 'The PNR is %; tickets can only be issued on an active reservation.', lower(pnr_status::text) using errcode = 'P0001';
    end if;
    if new.issued_at > now() then
      raise exception 'The issue date can''t be in the future.' using errcode = '22023';
    end if;
    new.issued_by := auth.uid();
    new.voided_at := null;
    return new;
  end if;

  -- UPDATE: what the airline issued is frozen; status only moves forward.
  if (new.organization_id, new.booking_id, new.passenger_id, new.pnr_id, new.ticket_number, new.issuing_airline,
      new.base_fare, new.taxes, new.currency, new.issued_at, new.issued_by)
     is distinct from
     (old.organization_id, old.booking_id, old.passenger_id, old.pnr_id, old.ticket_number, old.issuing_airline,
      old.base_fare, old.taxes, old.currency, old.issued_at, old.issued_by) then
    raise exception 'Issued ticket details can''t be changed. Void or exchange the ticket and record the new one.' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status and old.status <> 'Issued' then
    raise exception 'A % ticket can''t change status again.', lower(old.status::text) using errcode = 'P0001';
  end if;
  if new.status = 'Issued' and old.status <> 'Issued' then
    raise exception 'A ticket can''t be put back to Issued.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger tickets_guard before insert or update on public.tickets
  for each row execute function private.guard_ticket();

-- ── 3. The only ways to record or change a ticket ───────────────────────────
create or replace function public.issue_ticket(
  p_booking_id      uuid,
  p_passenger_id    uuid,
  p_pnr_id          uuid,
  p_ticket_number   text,
  p_issuing_airline text,
  p_base_fare       numeric,
  p_taxes           numeric,
  p_issued_at       timestamptz
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  b         record;
  pax_name  text;
  ticket_id uuid;
  v_number    text := regexp_replace(coalesce(p_ticket_number, ''), '[\s-]', '', 'g');
  v_airline   text := upper(btrim(coalesce(p_issuing_airline, '')));
begin
  select id, organization_id, code, currency into b from public.bookings where id = p_booking_id;
  if b.id is null or not private.has_role(b.organization_id, 'admin', 'ticketing_agent') then
    raise exception 'Only Ticketing or an admin can record tickets.' using errcode = '42501';
  end if;
  if v_number !~ '^[0-9]{13}$' then
    raise exception 'Enter the 13-digit ticket number exactly as issued by the airline.' using errcode = '22023';
  end if;
  if v_airline !~ '^[A-Z0-9]{2}$' then
    raise exception 'Enter the 2-character code of the issuing airline (e.g. EK).' using errcode = '22023';
  end if;
  if p_base_fare is null or p_base_fare < 0 or coalesce(p_taxes, 0) < 0 then
    raise exception 'Enter the fare and taxes shown on the ticket.' using errcode = '22023';
  end if;

  insert into public.tickets (organization_id, booking_id, passenger_id, pnr_id, ticket_number, issuing_airline,
                              base_fare, taxes, currency, issued_at)
  values (b.organization_id, b.id, p_passenger_id, p_pnr_id, v_number, v_airline,
          round(p_base_fare, 2), round(coalesce(p_taxes, 0), 2), b.currency, coalesce(p_issued_at, now()))
  returning id into ticket_id;

  select first_name || ' ' || last_name into pax_name from public.passengers where id = p_passenger_id;
  insert into public.booking_events (organization_id, booking_id, body, created_by)
  values (b.organization_id, b.id,
          left(format('Ticket %s issued by %s for %s (%s %s)', v_number, v_airline, pax_name, b.currency,
                      to_char(round(p_base_fare, 2) + round(coalesce(p_taxes, 0), 2), 'FM999999990.00')), 300),
          auth.uid());
  return ticket_id;
end;
$$;

create or replace function public.change_ticket_status(
  p_ticket_id uuid,
  p_status    public.ticket_status,
  p_reason    text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t      record;
  reason text := btrim(coalesce(p_reason, ''));
begin
  select * into t from public.tickets where id = p_ticket_id;
  if t.id is null or not private.has_role(t.organization_id, 'admin', 'ticketing_agent') then
    raise exception 'Only Ticketing or an admin can change tickets.' using errcode = '42501';
  end if;
  if p_status not in ('Voided', 'Refunded', 'Exchanged') then
    raise exception 'A ticket can be voided, refunded or exchanged.' using errcode = '22023';
  end if;
  if char_length(reason) < 5 or char_length(reason) > 200 then
    raise exception 'Give a reason (5–200 characters).' using errcode = '22023';
  end if;

  perform set_config('flyvera.change_reason', reason, true);
  update public.tickets
  set status = p_status, voided_at = case when p_status = 'Voided' then now() else voided_at end
  where id = t.id;   -- guard_ticket() refuses anything but Issued → Voided / Refunded / Exchanged
  perform set_config('flyvera.change_reason', '', true);

  insert into public.booking_events (organization_id, booking_id, body, created_by)
  values (t.organization_id, t.booking_id,
          left(format('Ticket %s %s — reason: %s', t.ticket_number, lower(p_status::text), reason), 300),
          auth.uid());
end;
$$;

-- App users record and change tickets only through the functions above.
revoke insert, update, delete on public.tickets from authenticated;

revoke execute on function
  public.issue_ticket(uuid, uuid, uuid, text, text, numeric, numeric, timestamptz),
  public.change_ticket_status(uuid, public.ticket_status, text)
  from public, anon;
grant execute on function
  public.issue_ticket(uuid, uuid, uuid, text, text, numeric, numeric, timestamptz),
  public.change_ticket_status(uuid, public.ticket_status, text)
  to authenticated;
revoke execute on function private.check_ticketing_links(), private.guard_ticket() from public, anon;
