-- ════════════════════════════════════════════════════════════════════════════
-- FLYVERA CRM · Migration 06 · Suppliers, bookings, passengers, PNRs, tickets
-- ════════════════════════════════════════════════════════════════════════════

-- Suppliers -------------------------------------------------------------------
create table public.suppliers (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  name                text not null check (char_length(btrim(name)) between 2 and 120),
  supplier_type       public.supplier_type not null,
  iata_code           char(2) check (iata_code ~ '^[A-Z0-9]{2}$'),   -- airlines only
  email               text,
  phone               text,
  payment_terms_days  integer not null default 14 check (payment_terms_days between 0 and 365),
  notes               text check (char_length(notes) <= 500),
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organization_id, name),
  unique (id, organization_id)
);

-- Bookings --------------------------------------------------------------------
create table public.bookings (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  code             text not null,                               -- FV-10481
  customer_id      uuid not null,
  quotation_id     uuid,
  title            text not null check (char_length(btrim(title)) between 1 and 80),
  destination      text not null check (char_length(btrim(destination)) between 1 and 60),
  depart_on        date not null,
  return_on        date,
  adults           integer not null default 1 check (adults between 1 and 99),
  children         integer not null default 0 check (children between 0 and 99),
  discount         numeric(12, 2) not null default 0 check (discount >= 0),
  tax_rate         numeric(5, 2) not null default 0 check (tax_rate between 0 and 50),
  currency         char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  status           public.booking_status not null default 'Pending',
  deposit_due_on   date not null,
  balance_due_on   date not null,
  agent_id         uuid,
  cancel_reason    text check (char_length(cancel_reason) <= 120),
  cancelled_at     timestamptz,
  refund_decision  public.refund_decision,
  created_by       uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, code),
  unique (id, organization_id),
  check (return_on is null or return_on >= depart_on),
  check (balance_due_on >= deposit_due_on),
  check ((status = 'Cancelled') = (cancelled_at is not null)),
  check (refund_decision is null or status = 'Cancelled'),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete restrict,
  foreign key (quotation_id, organization_id) references public.quotations (id, organization_id) on delete restrict,
  foreign key (organization_id, agent_id)
    references public.organization_members (organization_id, user_id) on delete set null (agent_id)
);
create unique index bookings_quotation_uidx on public.bookings (quotation_id) where quotation_id is not null;  -- one booking per quotation
create index bookings_customer_idx on public.bookings (customer_id);
create index bookings_depart_idx on public.bookings (organization_id, depart_on);

-- Priced services on a booking (copied from the accepted quotation) ----------
create table public.booking_services (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  booking_id       uuid not null,
  position         smallint not null default 0,
  service_type     public.quote_item_type not null,
  description      text not null check (char_length(btrim(description)) between 1 and 200),
  quantity         integer not null check (quantity between 1 and 999),
  unit_price       numeric(12, 2) not null check (unit_price >= 0),
  cost             numeric(12, 2) not null default 0 check (cost >= 0),
  supplier_id      uuid,
  supplier_ref     text check (supplier_ref ~ '^[A-Z0-9-]{2,40}$'),       -- airline PNR / hotel confirmation no.
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id) on delete cascade,
  foreign key (supplier_id, organization_id) references public.suppliers (id, organization_id) on delete set null (supplier_id)
);
create index booking_services_booking_idx on public.booking_services (booking_id, position);

-- Human-readable booking timeline (append-only) ------------------------------
create table public.booking_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  booking_id       uuid not null,
  body             text not null check (char_length(btrim(body)) between 1 and 300),
  occurred_at      timestamptz not null default now(),
  created_by       uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id) on delete cascade
);
create index booking_events_booking_idx on public.booking_events (booking_id, occurred_at);

-- Passengers (document number ENCRYPTED; snapshot as used for ticketing) -----
create table public.passengers (
  id                         uuid primary key default gen_random_uuid(),
  organization_id            uuid not null,
  booking_id                 uuid not null,
  customer_id                uuid,                                   -- when the traveller is a CRM customer
  passenger_type             public.passenger_type not null default 'Adult',
  title                      text check (title in ('Mr', 'Mrs', 'Ms', 'Mx', 'Dr', 'Mstr', 'Miss')),
  first_name                 text not null check (char_length(btrim(first_name)) between 1 and 50),
  last_name                  text not null check (char_length(btrim(last_name)) between 1 and 50),
  date_of_birth              date check (date_of_birth > date '1900-01-01'),
  gender                     char(1) check (gender in ('F', 'M', 'X')),
  nationality                text,
  document_type              public.travel_document_type,
  document_number_encrypted  bytea,
  document_last4             text check (document_last4 ~ '^[A-Z0-9]{1,4}$'),
  document_issuing_country   text,
  document_expiry_on         date,
  frequent_flyer             text check (char_length(frequent_flyer) <= 30),
  meal_preference            text check (char_length(meal_preference) <= 40),
  special_assistance         text check (char_length(special_assistance) <= 200),
  is_lead_passenger          boolean not null default false,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (id, organization_id),
  check ((document_number_encrypted is null) = (document_last4 is null)),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id) on delete cascade,
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete set null (customer_id)
);
create index passengers_booking_idx on public.passengers (booking_id);
create unique index passengers_one_lead_uidx on public.passengers (booking_id) where is_lead_passenger;

-- PNR records (airline / GDS reservations) ------------------------------------
create table public.pnr_records (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  booking_id          uuid not null,
  record_locator      text not null check (record_locator ~ '^[A-Z0-9]{5,8}$'),
  provider            public.pnr_provider not null default 'Manual',
  airline_locator     text check (airline_locator ~ '^[A-Z0-9]{5,8}$'),
  status              public.pnr_status not null default 'Active',
  ticketing_deadline  timestamptz,
  raw                 jsonb,
  created_by          uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organization_id, provider, record_locator),
  unique (id, organization_id),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id) on delete cascade
);

-- Flight legs -----------------------------------------------------------------
create table public.booking_segments (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  booking_id          uuid not null,
  pnr_id              uuid,
  booking_service_id  uuid,
  segment_no          smallint not null check (segment_no >= 1),
  marketing_carrier   char(2) not null check (marketing_carrier ~ '^[A-Z0-9]{2}$'),
  flight_number       text not null check (flight_number ~ '^[0-9]{1,4}[A-Z]?$'),
  operating_carrier   char(2) check (operating_carrier ~ '^[A-Z0-9]{2}$'),
  origin              char(3) not null check (origin ~ '^[A-Z]{3}$'),
  destination         char(3) not null check (destination ~ '^[A-Z]{3}$'),
  departs_at          timestamptz not null,
  arrives_at          timestamptz not null,
  cabin               public.cabin_class not null default 'Economy',
  booking_class       char(1) check (booking_class ~ '^[A-Z]$'),
  status              public.segment_status not null default 'Confirmed',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (booking_id, segment_no),
  unique (id, organization_id),
  check (origin <> destination),
  check (arrives_at > departs_at),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id) on delete cascade,
  foreign key (pnr_id, organization_id) references public.pnr_records (id, organization_id) on delete set null (pnr_id),
  foreign key (booking_service_id, organization_id) references public.booking_services (id, organization_id) on delete set null (booking_service_id)
);

-- Tickets ---------------------------------------------------------------------
create table public.tickets (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  booking_id       uuid not null,
  passenger_id     uuid not null,
  pnr_id           uuid,
  ticket_number    text not null check (ticket_number ~ '^[0-9]{13}$'),
  issuing_airline  char(2) not null check (issuing_airline ~ '^[A-Z0-9]{2}$'),
  status           public.ticket_status not null default 'Issued',
  base_fare        numeric(12, 2) not null check (base_fare >= 0),
  taxes            numeric(12, 2) not null default 0 check (taxes >= 0),
  total            numeric(12, 2) generated always as (base_fare + taxes) stored,
  currency         char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  issued_at        timestamptz not null default now(),
  issued_by        uuid references public.profiles (id) on delete set null default auth.uid(),
  voided_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, ticket_number),
  unique (id, organization_id),
  check ((status = 'Voided') = (voided_at is not null)),
  -- tickets are accounting records: a booking with tickets can't simply be deleted
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id) on delete restrict,
  foreign key (passenger_id, organization_id) references public.passengers (id, organization_id) on delete restrict,
  foreign key (pnr_id, organization_id) references public.pnr_records (id, organization_id) on delete set null (pnr_id)
);
create index tickets_booking_idx on public.tickets (booking_id);

-- Files (PDF e-tickets, vouchers) live in the private storage bucket
-- "ticket-documents" under <organization_id>/<booking_id>/<file>.
create table public.ticket_documents (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  booking_id       uuid not null,
  ticket_id        uuid,
  document_kind    public.ticket_document_kind not null,
  storage_bucket   text not null default 'ticket-documents' check (storage_bucket = 'ticket-documents'),
  storage_path     text not null unique,
  file_name        text not null check (char_length(file_name) between 1 and 160),
  mime_type        text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes       integer not null check (size_bytes between 1 and 20971520),
  uploaded_by      uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  check (storage_path like organization_id::text || '/' || booking_id::text || '/%'),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id) on delete cascade,
  foreign key (ticket_id, organization_id) references public.tickets (id, organization_id) on delete cascade
);

alter table public.tasks add foreign key (booking_id, organization_id)
  references public.bookings (id, organization_id) on delete cascade;

-- RLS on, triggers ------------------------------------------------------------
alter table public.suppliers enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_services enable row level security;
alter table public.booking_events enable row level security;
alter table public.passengers enable row level security;
alter table public.pnr_records enable row level security;
alter table public.booking_segments enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_documents enable row level security;

create trigger bookings_code before insert on public.bookings
  for each row execute function private.assign_code('booking', 'FV-', '10001');

create trigger suppliers_updated_at before update on public.suppliers for each row execute function private.set_updated_at();
create trigger bookings_updated_at before update on public.bookings for each row execute function private.set_updated_at();
create trigger booking_services_updated_at before update on public.booking_services for each row execute function private.set_updated_at();
create trigger passengers_updated_at before update on public.passengers for each row execute function private.set_updated_at();
create trigger pnr_records_updated_at before update on public.pnr_records for each row execute function private.set_updated_at();
create trigger booking_segments_updated_at before update on public.booking_segments for each row execute function private.set_updated_at();
create trigger tickets_updated_at before update on public.tickets for each row execute function private.set_updated_at();
