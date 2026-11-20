-- ════════════════════════════════════════════════════════════════════════════
-- FLYVERA CRM · Migration 05 · Flight searches & offers, quotations
-- ════════════════════════════════════════════════════════════════════════════

-- Flight searches (who looked for what) ---------------------------------------
create table public.flight_searches (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  created_by       uuid references public.profiles (id) on delete set null default auth.uid(),
  lead_id          uuid,
  customer_id      uuid,
  origin           char(3) not null check (origin ~ '^[A-Z]{3}$'),
  destination      char(3) not null check (destination ~ '^[A-Z]{3}$'),
  depart_on        date not null,
  return_on        date,
  adults           smallint not null default 1 check (adults between 1 and 9),
  children         smallint not null default 0 check (children between 0 and 9),
  infants          smallint not null default 0 check (infants between 0 and adults),
  cabin            public.cabin_class not null default 'Economy',
  provider         text not null default 'Manual',
  request          jsonb,
  searched_at      timestamptz not null default now(),
  unique (id, organization_id),
  check (origin <> destination),
  check (return_on is null or return_on >= depart_on),
  foreign key (lead_id, organization_id) references public.leads (id, organization_id) on delete set null (lead_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete set null (customer_id)
);

-- Priced results of a search --------------------------------------------------
create table public.flight_offers (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  search_id           uuid not null,
  provider            text not null,
  provider_offer_id   text not null,
  validating_carrier  char(2) check (validating_carrier ~ '^[A-Z0-9]{2}$'),
  base_amount         numeric(12, 2) not null check (base_amount >= 0),
  tax_amount          numeric(12, 2) not null default 0 check (tax_amount >= 0),
  total_amount        numeric(12, 2) generated always as (base_amount + tax_amount) stored,
  currency            char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  itinerary           jsonb not null default '[]'::jsonb,   -- slices → segments (carrier, flight, times)
  expires_at          timestamptz,
  is_selected         boolean not null default false,
  created_at          timestamptz not null default now(),
  unique (search_id, provider, provider_offer_id),
  unique (id, organization_id),
  foreign key (search_id, organization_id) references public.flight_searches (id, organization_id) on delete cascade
);

-- Quotations ------------------------------------------------------------------
create table public.quotations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  code             text not null,                               -- QT-3001
  customer_id      uuid,
  lead_id          uuid,
  recipient        jsonb not null check (jsonb_typeof(recipient) = 'object' and recipient ? 'name'),
  title            text not null check (char_length(btrim(title)) between 1 and 80),
  destination      text not null check (char_length(btrim(destination)) between 1 and 60),
  depart_on        date,
  return_on        date,
  adults           integer not null default 2 check (adults between 1 and 99),
  children         integer not null default 0 check (children between 0 and 99),
  discount         numeric(12, 2) not null default 0 check (discount >= 0),
  tax_rate         numeric(5, 2) not null default 0 check (tax_rate between 0 and 50),
  currency         char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  valid_until      date not null,
  status           public.quote_status not null default 'Draft',
  notes            text check (char_length(notes) <= 600),
  prepared_by      uuid,
  sent_at          timestamptz,
  responded_at     timestamptz,
  created_by       uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  unique (organization_id, code),
  unique (id, organization_id),
  check (num_nonnulls(customer_id, lead_id) = 1),               -- for a customer OR a lead, never both
  check (return_on is null or (depart_on is not null and return_on >= depart_on)),
  check (status = 'Draft' or sent_at is not null),
  check (status not in ('Accepted', 'Declined') or responded_at is not null),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete restrict,
  foreign key (lead_id, organization_id) references public.leads (id, organization_id) on delete restrict,
  foreign key (organization_id, prepared_by)
    references public.organization_members (organization_id, user_id) on delete set null (prepared_by)
);
create index quotations_customer_idx on public.quotations (customer_id);
create index quotations_lead_idx on public.quotations (lead_id);
comment on column public.quotations.recipient is 'Snapshot of name / email / phone at the time of quoting, so documents never change afterwards.';
comment on column public.quotations.status is 'A Sent quotation past valid_until is shown as "Expired" by the app; it is not a stored status.';

create table public.quotation_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  quotation_id     uuid not null,
  position         smallint not null default 0,
  item_type        public.quote_item_type not null,
  description      text not null check (char_length(btrim(description)) between 1 and 200),
  quantity         integer not null check (quantity between 1 and 999),
  unit_price       numeric(12, 2) not null check (unit_price >= 0),
  cost             numeric(12, 2) not null default 0 check (cost >= 0),   -- internal supplier cost
  flight_offer_id  uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (quotation_id, organization_id) references public.quotations (id, organization_id) on delete cascade,
  foreign key (flight_offer_id, organization_id) references public.flight_offers (id, organization_id) on delete set null (flight_offer_id)
);
create index quotation_items_quote_idx on public.quotation_items (quotation_id, position);

alter table public.tasks add foreign key (quotation_id, organization_id)
  references public.quotations (id, organization_id) on delete cascade;

-- RLS on, triggers ------------------------------------------------------------
alter table public.flight_searches enable row level security;
alter table public.flight_offers enable row level security;
alter table public.quotations enable row level security;
alter table public.quotation_items enable row level security;

create trigger quotations_code before insert on public.quotations
  for each row execute function private.assign_code('quotation', 'QT-', '3001');
create trigger quotations_updated_at before update on public.quotations for each row execute function private.set_updated_at();
create trigger quotation_items_updated_at before update on public.quotation_items for each row execute function private.set_updated_at();
