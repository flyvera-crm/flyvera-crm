-- ════════════════════════════════════════════════════════════════════════════
-- FLYVERA CRM · Migration 24 · Supplier-safe flight offers and ticket number source
-- ════════════════════════════════════════════════════════════════════════════
-- The CRM has no live flight supplier yet (GDS, NDC or consolidator). Fares and availability must
-- only ever come from an authorised supplier's response, never be typed in or invented.
--
--   1. Flight offers can only be stored by the server's supplier connection (service role), never by
--      app users: their insert / update / delete rights on flight_offers are removed. Reading is
--      unchanged. Offers get the fields a supplier returns (fetch time, fare brand, refund / change
--      rules, seats, stops, baggage, fare rules) and the supplier's raw response, kept for audit.
--      Placeholder provider names (Manual, Demo, Sample, Test, Mock) are refused.
--   2. Tickets record where their number came from:
--        Manual from supplier document  staff copied it from the airline's / consolidator's e-ticket;
--        Supplier API                   returned by an authorised supplier connection.
--      Staff (issue_ticket) always record "Manual from supplier document"; only the service role can
--      record "Supplier API". An optional supplier reference (e.g. consolidator booking reference) can
--      be added. Both are frozen once the ticket is recorded, like the number and fare.
--
-- Unchanged: flight searches, PNRs and their verification, bookings, payments, quotations, who may
-- record or change tickets. Production has no flight offers or tickets today. Like the other guards,
-- the rules apply to signed-in app users; the service role (supplier connection, imports) is exempt.

-- ── 1. Flight offers: from a supplier connection only ───────────────────────
drop policy "flight offers: manage with the search" on public.flight_offers;
revoke insert, update, delete on public.flight_offers from authenticated;

alter table public.flight_offers
  add column fetched_at      timestamptz not null default now(),   -- when the supplier returned it
  add column fare_brand      text check (char_length(fare_brand) <= 60),
  add column refundable      boolean,
  add column changeable      boolean,
  add column seats_available smallint check (seats_available >= 0),
  add column stops           smallint check (stops between 0 and 6),
  add column baggage         jsonb,        -- as returned by the supplier, per passenger type
  add column fare_rules      jsonb,        -- as returned by the supplier
  add column raw             jsonb,        -- the supplier's own response, kept for audit / disputes
  add constraint flight_offers_real_provider
    check (char_length(btrim(provider)) between 2 and 40
           and lower(btrim(provider)) not in ('manual', 'demo', 'sample', 'test', 'mock', 'fake')),
  add constraint flight_offers_provider_offer_id_present
    check (char_length(btrim(provider_offer_id)) between 1 and 200);

comment on table public.flight_offers is
  'Fares and availability exactly as returned by an authorised flight supplier (GDS / NDC / consolidator). Written only by the server''s supplier connection (service role); app users can read but never write them.';

-- ── 2. Tickets: where the number came from ──────────────────────────────────
create type public.ticket_number_source as enum ('Manual from supplier document', 'Supplier API');

alter table public.tickets
  add column number_source      public.ticket_number_source not null default 'Manual from supplier document',
  add column supplier_reference text check (supplier_reference ~ '^[A-Za-z0-9][A-Za-z0-9 /._-]{0,59}$');

comment on column public.tickets.number_source is
  'Manual from supplier document: copied by staff from the airline''s / consolidator''s e-ticket. Supplier API: returned by an authorised supplier connection (service role only).';

-- The ticket guard from migration 16, extended: staff always record the manual source, and the
-- source and supplier reference are frozen with the other issued details.
create or replace function private.guard_ticket()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  booking_status public.booking_status;
  pnr_status     public.pnr_status;
begin
  if auth.uid() is null then
    return new;   -- service role / SQL editor (supplier connection, imports, seed data)
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
    new.number_source := 'Manual from supplier document';   -- staff copy numbers from supplier documents
    return new;
  end if;

  -- UPDATE: what the airline issued is frozen; status only moves forward.
  if (new.organization_id, new.booking_id, new.passenger_id, new.pnr_id, new.ticket_number, new.issuing_airline,
      new.base_fare, new.taxes, new.currency, new.issued_at, new.issued_by, new.number_source, new.supplier_reference)
     is distinct from
     (old.organization_id, old.booking_id, old.passenger_id, old.pnr_id, old.ticket_number, old.issuing_airline,
      old.base_fare, old.taxes, old.currency, old.issued_at, old.issued_by, old.number_source, old.supplier_reference) then
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

-- issue_ticket() from migration 16, with an optional supplier reference (existing calls keep working).
drop function public.issue_ticket(uuid, uuid, uuid, text, text, numeric, numeric, timestamptz);

create function public.issue_ticket(
  p_booking_id         uuid,
  p_passenger_id       uuid,
  p_pnr_id             uuid,
  p_ticket_number      text,
  p_issuing_airline    text,
  p_base_fare          numeric,
  p_taxes              numeric,
  p_issued_at          timestamptz,
  p_supplier_reference text default null
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
  v_reference text := nullif(btrim(coalesce(p_supplier_reference, '')), '');
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
  if v_reference is not null and v_reference !~ '^[A-Za-z0-9][A-Za-z0-9 /._-]{0,59}$' then
    raise exception 'The supplier reference can have up to 60 letters, digits, spaces and / . _ -' using errcode = '22023';
  end if;

  insert into public.tickets (organization_id, booking_id, passenger_id, pnr_id, ticket_number, issuing_airline,
                              base_fare, taxes, currency, issued_at, supplier_reference)
  values (b.organization_id, b.id, p_passenger_id, p_pnr_id, v_number, v_airline,
          round(p_base_fare, 2), round(coalesce(p_taxes, 0), 2), b.currency, coalesce(p_issued_at, now()), v_reference)
  returning id into ticket_id;   -- guard_ticket() records the source as "Manual from supplier document"

  select first_name || ' ' || last_name into pax_name from public.passengers where id = p_passenger_id;
  insert into public.booking_events (organization_id, booking_id, body, created_by)
  values (b.organization_id, b.id,
          left(format('Ticket %s issued by %s for %s (%s %s)', v_number, v_airline, pax_name, b.currency,
                      to_char(round(p_base_fare, 2) + round(coalesce(p_taxes, 0), 2), 'FM999999990.00'))
               || coalesce(' — supplier ref ' || v_reference, ''), 300),
          auth.uid());
  return ticket_id;
end;
$$;

revoke execute on function public.issue_ticket(uuid, uuid, uuid, text, text, numeric, numeric, timestamptz, text) from public, anon;
grant execute on function public.issue_ticket(uuid, uuid, uuid, text, text, numeric, numeric, timestamptz, text) to authenticated;
