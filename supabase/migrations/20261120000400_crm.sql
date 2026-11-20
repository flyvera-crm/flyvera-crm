-- ════════════════════════════════════════════════════════════════════════════
-- FLYVERA CRM · Migration 04 · Customers, travel documents, leads, tasks
-- ════════════════════════════════════════════════════════════════════════════
-- Pattern used throughout: child rows reference parents with a composite
-- foreign key (parent_id, organization_id). This makes it IMPOSSIBLE to link a
-- record to another organization's customer, lead, booking, etc.

-- Customers -------------------------------------------------------------------
create table public.customers (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations (id) on delete cascade,
  code                     text not null,                       -- CU-1001 (filled automatically)
  first_name               text not null check (char_length(btrim(first_name)) between 1 and 50),
  last_name                text not null check (char_length(btrim(last_name)) between 1 and 50),
  email                    text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$'),
  phone                    text not null check (regexp_replace(phone, '[\s().-]', '', 'g') ~ '^\+[0-9]{7,15}$'),
  phone_e164               text generated always as (regexp_replace(phone, '[\s().-]', '', 'g')) stored,
  city                     text not null check (char_length(btrim(city)) between 1 and 80),
  country                  text not null check (char_length(btrim(country)) between 1 and 80),
  nationality              text,
  date_of_birth            date check (date_of_birth > date '1900-01-01'),
  tier                     public.customer_tier not null default 'Standard',
  status                   public.customer_status not null default 'Active',
  preferred_contact        public.contact_method not null default 'WhatsApp',
  seat_preference          public.seat_preference not null default 'No preference',
  favourite_destination    text,
  whatsapp_opt_in          boolean not null default false,
  whatsapp_opt_in_at       timestamptz,
  notes                    text check (char_length(notes) <= 500),
  assigned_to              uuid,
  -- History from before FLYVERA CRM (imported once). Live figures come from bookings.
  imported_trip_count      integer not null default 0 check (imported_trip_count >= 0),
  imported_lifetime_value  numeric(12, 2) not null default 0 check (imported_lifetime_value >= 0),
  imported_last_trip_on    date,
  created_by               uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz,                          -- archived (soft delete)
  unique (organization_id, code),
  unique (id, organization_id),
  foreign key (organization_id, assigned_to)
    references public.organization_members (organization_id, user_id) on delete set null (assigned_to)
);
create index customers_assigned_idx on public.customers (organization_id, assigned_to);
create unique index customers_email_uidx on public.customers (organization_id, lower(email))
  where email is not null and deleted_at is null;
create unique index customers_phone_uidx on public.customers (organization_id, phone_e164) where deleted_at is null;
comment on table public.customers is 'Traveller profiles. Lifetime value / trip count are calculated in the customer_stats view.';

-- Travel documents (passports etc.) — the number is ENCRYPTED --------------
create table public.customer_travel_documents (
  id                         uuid primary key default gen_random_uuid(),
  organization_id            uuid not null,
  customer_id                uuid not null,
  document_type              public.travel_document_type not null default 'Passport',
  document_number_encrypted  bytea not null,
  number_last4               text not null check (number_last4 ~ '^[A-Z0-9]{1,4}$'),
  issuing_country            text not null,
  nationality                text,
  issue_date                 date,
  expiry_date                date not null,
  is_primary                 boolean not null default true,
  verified_by                uuid references public.profiles (id) on delete set null,
  verified_at                timestamptz,
  created_by                 uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  check (issue_date is null or issue_date < expiry_date),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade
);
create unique index customer_travel_documents_primary_uidx
  on public.customer_travel_documents (customer_id, document_type) where is_primary;
comment on column public.customer_travel_documents.document_number_encrypted is
  'pgcrypto-encrypted with the Vault key "flyvera_document_key". Not readable by API users — use reveal_customer_travel_document().';

-- Leads -----------------------------------------------------------------------
create table public.leads (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  code               text not null,                             -- LD-2001
  full_name          text not null check (char_length(btrim(full_name)) between 1 and 80),
  phone              text not null check (regexp_replace(phone, '[\s().-]', '', 'g') ~ '^\+[0-9]{7,15}$'),
  phone_e164         text generated always as (regexp_replace(phone, '[\s().-]', '', 'g')) stored,
  email              text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$'),
  source             public.lead_source not null default 'WhatsApp',
  stage              public.lead_stage not null default 'New',
  priority           public.lead_priority not null default 'Warm',
  destination        text not null check (char_length(btrim(destination)) between 1 and 60),
  trip_type          public.trip_type not null default 'Holiday',
  depart_on          date,
  return_on          date,
  travellers         integer not null default 2 check (travellers between 1 and 99),
  budget             numeric(12, 2) not null default 0 check (budget >= 0),
  currency           char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  assigned_to        uuid,
  next_follow_up_on  date,
  last_contacted_at  timestamptz,
  lost_reason        text check (char_length(lost_reason) <= 120),
  customer_id        uuid,                                      -- set when converted
  converted_at       timestamptz,
  notes              text check (char_length(notes) <= 500),
  created_by         uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  unique (organization_id, code),
  unique (id, organization_id),
  check (return_on is null or (depart_on is not null and return_on >= depart_on)),
  check (stage = 'Lost' or lost_reason is null),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete set null (customer_id),
  foreign key (organization_id, assigned_to)
    references public.organization_members (organization_id, user_id) on delete set null (assigned_to)
);
create index leads_assigned_idx on public.leads (organization_id, assigned_to);
create index leads_stage_idx on public.leads (organization_id, stage);
create index leads_phone_idx on public.leads (organization_id, phone_e164);

-- Lead timeline (append-only) -------------------------------------------------
create table public.lead_activities (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  lead_id          uuid not null,
  activity_type    public.lead_activity_type not null,
  body             text check (char_length(body) <= 1000),
  from_stage       public.lead_stage,
  to_stage         public.lead_stage,
  occurred_at      timestamptz not null default now(),
  created_by       uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  check (activity_type <> 'Stage change' or to_stage is not null),
  foreign key (lead_id, organization_id) references public.leads (id, organization_id) on delete cascade
);
create index lead_activities_lead_idx on public.lead_activities (lead_id, occurred_at desc);

-- Tasks (follow-ups). quotation_id / booking_id FKs are added in later migrations.
create table public.tasks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  title            text not null check (char_length(btrim(title)) between 1 and 160),
  details          text check (char_length(details) <= 1000),
  due_at           timestamptz,
  status           public.task_status not null default 'Open',
  priority         public.task_priority not null default 'Normal',
  assigned_to      uuid,
  created_by       uuid references public.profiles (id) on delete set null default auth.uid(),
  completed_at     timestamptz,
  lead_id          uuid,
  customer_id      uuid,
  quotation_id     uuid,
  booking_id       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (num_nonnulls(lead_id, customer_id, quotation_id, booking_id) <= 1),
  check ((status = 'Done') = (completed_at is not null)),
  foreign key (organization_id, assigned_to)
    references public.organization_members (organization_id, user_id) on delete set null (assigned_to),
  foreign key (lead_id, organization_id) references public.leads (id, organization_id) on delete cascade,
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade
);
create index tasks_assignee_idx on public.tasks (organization_id, assigned_to, status);

-- RLS on, triggers ------------------------------------------------------------
alter table public.customers enable row level security;
alter table public.customer_travel_documents enable row level security;
alter table public.leads enable row level security;
alter table public.lead_activities enable row level security;
alter table public.tasks enable row level security;

create trigger customers_code before insert on public.customers
  for each row execute function private.assign_code('customer', 'CU-', '1001');
create trigger leads_code before insert on public.leads
  for each row execute function private.assign_code('lead', 'LD-', '2001');

create trigger customers_updated_at before update on public.customers for each row execute function private.set_updated_at();
create trigger customer_travel_documents_updated_at before update on public.customer_travel_documents for each row execute function private.set_updated_at();
create trigger leads_updated_at before update on public.leads for each row execute function private.set_updated_at();
create trigger tasks_updated_at before update on public.tasks for each row execute function private.set_updated_at();
