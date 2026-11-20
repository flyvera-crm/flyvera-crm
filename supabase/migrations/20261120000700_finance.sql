-- ════════════════════════════════════════════════════════════════════════════
-- FLYVERA CRM · Migration 07 · Payments, refunds, invoices, supplier transactions
-- ════════════════════════════════════════════════════════════════════════════
-- Money rows are never deleted by app users — mistakes are corrected with a
-- reversing entry (refund / credit note). Totals are calculated in views.

-- Invoices (numbered INV-2026-0001; amounts frozen when issued) -------------
create table public.invoices (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  number            text not null,
  booking_id        uuid not null,
  customer_id       uuid not null,
  status            public.invoice_status not null default 'Draft',
  issue_on          date,
  due_on            date,
  currency          char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  subtotal          numeric(12, 2) not null default 0 check (subtotal >= 0),
  discount          numeric(12, 2) not null default 0 check (discount >= 0),
  tax               numeric(12, 2) not null default 0 check (tax >= 0),
  total             numeric(12, 2) generated always as (subtotal - discount + tax) stored,
  notes             text check (char_length(notes) <= 600),
  pdf_storage_path  text,
  issued_by         uuid references public.profiles (id) on delete set null,
  created_by        uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, number),
  unique (id, organization_id),
  check (discount <= subtotal),
  check (status = 'Draft' or issue_on is not null),
  check (due_on is null or issue_on is null or due_on >= issue_on),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id) on delete restrict,
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete restrict
);
create index invoices_booking_idx on public.invoices (booking_id);

create table public.invoice_lines (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  invoice_id          uuid not null,
  position            smallint not null default 0,
  description         text not null check (char_length(btrim(description)) between 1 and 200),
  quantity            numeric(10, 2) not null check (quantity > 0),
  unit_price          numeric(12, 2) not null check (unit_price >= 0),
  line_total          numeric(12, 2) generated always as (round(quantity * unit_price, 2)) stored,
  booking_service_id  uuid,
  created_at          timestamptz not null default now(),
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id) on delete cascade,
  foreign key (booking_service_id, organization_id) references public.booking_services (id, organization_id) on delete set null (booking_service_id)
);

-- Customer payments (money in) -------------------------------------------------
create table public.payments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  booking_id       uuid not null,
  invoice_id       uuid,
  sequence_no      smallint not null,                          -- 1, 2, 3… per booking (filled automatically)
  receipt_number   text not null,                              -- RC-10479-2 (filled automatically)
  amount           numeric(12, 2) not null check (amount > 0),
  currency         char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  method           public.payment_method not null,
  received_on      date not null,
  reference        text check (char_length(reference) <= 60),
  note             text check (char_length(note) <= 120),
  recorded_by      uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, receipt_number),
  unique (booking_id, sequence_no),
  unique (id, organization_id),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id) on delete restrict,
  foreign key (invoice_id, organization_id) references public.invoices (id, organization_id) on delete set null (invoice_id)
);
create index payments_received_idx on public.payments (organization_id, received_on);

-- Card / gateway events (written by server-side webhooks only) -------------
create table public.payment_transactions (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  booking_id          uuid not null,
  payment_id          uuid,
  provider            text not null,
  provider_reference  text not null,
  status              public.payment_txn_status not null,
  amount              numeric(12, 2) not null check (amount > 0),
  currency            char(3) not null check (currency ~ '^[A-Z]{3}$'),
  raw                 jsonb,
  occurred_at         timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  unique (provider, provider_reference),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id) on delete restrict,
  foreign key (payment_id, organization_id) references public.payments (id, organization_id) on delete set null (payment_id)
);

-- Refunds (money back to the customer) ----------------------------------------
create table public.refunds (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  booking_id        uuid not null,
  payment_id        uuid,                                       -- the original payment, when known
  sequence_no       smallint not null,
  reference_number  text not null,                              -- RF-10477-1 (filled automatically)
  amount            numeric(12, 2) not null check (amount > 0),
  currency          char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  method            public.payment_method not null,
  status            public.refund_status not null default 'Requested',
  reason            text check (char_length(reason) <= 200),
  note              text check (char_length(note) <= 120),
  requested_by      uuid references public.profiles (id) on delete set null default auth.uid(),
  approved_by       uuid references public.profiles (id) on delete set null,
  approved_at       timestamptz,
  paid_on           date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, reference_number),
  unique (booking_id, sequence_no),
  check ((status = 'Paid') = (paid_on is not null)),
  check (status not in ('Approved', 'Paid') or approved_at is not null),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id) on delete restrict,
  foreign key (payment_id, organization_id) references public.payments (id, organization_id) on delete set null (payment_id)
);

-- What the agency pays suppliers (or gets back) --------------------------------
create table public.supplier_transactions (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  supplier_id         uuid,
  booking_id          uuid,
  booking_service_id  uuid,
  kind                public.supplier_txn_kind not null default 'Payment',
  amount              numeric(12, 2) not null check (amount > 0),
  currency            char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  method              public.payment_method not null default 'Bank transfer',
  occurred_on         date not null,
  reference           text check (char_length(reference) <= 60),
  note                text check (char_length(note) <= 120),
  recorded_by         uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (booking_service_id is null or booking_id is not null),
  foreign key (supplier_id, organization_id) references public.suppliers (id, organization_id) on delete set null (supplier_id),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id) on delete restrict,
  foreign key (booking_service_id, organization_id) references public.booking_services (id, organization_id) on delete set null (booking_service_id)
);
create index supplier_transactions_booking_idx on public.supplier_transactions (booking_id);

-- RLS on ----------------------------------------------------------------------
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.payments enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.refunds enable row level security;
alter table public.supplier_transactions enable row level security;

create trigger invoices_updated_at before update on public.invoices for each row execute function private.set_updated_at();
create trigger payments_updated_at before update on public.payments for each row execute function private.set_updated_at();
create trigger refunds_updated_at before update on public.refunds for each row execute function private.set_updated_at();
create trigger supplier_transactions_updated_at before update on public.supplier_transactions for each row execute function private.set_updated_at();

-- ── Money helpers & guards ──────────────────────────────────────────────────

-- Booking total = services − discount + tax (same maths as the frontend's quote-math.ts).
create or replace function private.booking_total(p_booking_id uuid)
returns numeric
language sql stable security definer set search_path = ''
as $$
  with s as (
    select coalesce(sum(round(bs.quantity * bs.unit_price, 2)), 0) as subtotal
    from public.booking_services bs where bs.booking_id = p_booking_id
  ), t as (
    select s.subtotal - least(b.discount, s.subtotal) as taxable, b.tax_rate
    from public.bookings b cross join s where b.id = p_booking_id
  )
  select round(t.taxable + round(t.taxable * t.tax_rate / 100, 2), 2) from t;
$$;

create or replace function private.booking_received(p_booking_id uuid)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(amount), 0) from public.payments where booking_id = p_booking_id;
$$;

create or replace function private.booking_refunded(p_booking_id uuid, include_pending boolean)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(amount), 0) from public.refunds
  where booking_id = p_booking_id
    and (status = 'Paid' or (include_pending and status in ('Requested', 'Approved')));
$$;

-- Numbers each payment / refund per booking: RC-10479-1, RC-10479-2 … / RF-10477-1 …
create or replace function private.assign_money_number()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  booking_code text;
  prefix text := tg_argv[0];
begin
  -- lock the booking row so two simultaneous payments can't get the same number
  select b.code into booking_code from public.bookings b where b.id = new.booking_id for update;
  if new.sequence_no is null then
    if tg_table_name = 'payments' then
      select coalesce(max(sequence_no), 0) + 1 into new.sequence_no from public.payments where booking_id = new.booking_id;
    else
      select coalesce(max(sequence_no), 0) + 1 into new.sequence_no from public.refunds where booking_id = new.booking_id;
    end if;
  end if;
  if tg_table_name = 'payments' then
    new.receipt_number := prefix || regexp_replace(booking_code, '\D', '', 'g') || '-' || new.sequence_no;
  else
    new.reference_number := prefix || regexp_replace(booking_code, '\D', '', 'g') || '-' || new.sequence_no;
  end if;
  return new;
end;
$$;

create trigger payments_number before insert on public.payments
  for each row execute function private.assign_money_number('RC-');
create trigger refunds_number before insert on public.refunds
  for each row execute function private.assign_money_number('RF-');

-- A booking can't be paid more than its total (net of refunds already paid).
create or replace function private.guard_payment_total()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  total numeric := private.booking_total(new.booking_id);
  net   numeric := private.booking_received(new.booking_id) - private.booking_refunded(new.booking_id, false);
begin
  if net > total + 0.005 then
    raise exception 'Payment exceeds the booking balance (total %, net paid %).', total, net using errcode = 'P0001';
  end if;
  return null;
end;
$$;
create trigger payments_guard_total after insert or update on public.payments
  for each row execute function private.guard_payment_total();

-- Refunds (requested + approved + paid) can't exceed what was received.
create or replace function private.guard_refund_total()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if private.booking_refunded(new.booking_id, true) > private.booking_received(new.booking_id) + 0.005 then
    raise exception 'Refunds exceed the amount received for this booking.' using errcode = 'P0001';
  end if;
  return null;
end;
$$;
create trigger refunds_guard_total after insert or update on public.refunds
  for each row execute function private.guard_refund_total();

-- Invoice numbers: INV-<year>-0001, counted per organization per year.
create or replace function private.assign_invoice_number()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  yr text := to_char(coalesce(new.issue_on, current_date), 'YYYY');
  m  text[];
begin
  if new.number is null then
    new.number := 'INV-' || yr || '-' || lpad(private.next_code(new.organization_id, 'invoice-' || yr, 1)::text, 4, '0');
  else
    m := regexp_match(new.number, '^INV-([0-9]{4})-([0-9]+)$');
    if m is not null then
      insert into private.org_counters as c (organization_id, kind, last_value)
      values (new.organization_id, 'invoice-' || m[1], m[2]::bigint)
      on conflict (organization_id, kind) do update set last_value = greatest(c.last_value, excluded.last_value);
    end if;
  end if;
  return new;
end;
$$;
create trigger invoices_number before insert on public.invoices
  for each row execute function private.assign_invoice_number();

-- Once an invoice is issued, its lines and amounts are frozen.
create or replace function private.guard_issued_invoice()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  inv_status public.invoice_status;
begin
  if tg_table_name = 'invoices' then
    if old.status <> 'Draft' and (new.subtotal, new.discount, new.tax, new.currency, new.booking_id, new.customer_id, new.number)
         is distinct from (old.subtotal, old.discount, old.tax, old.currency, old.booking_id, old.customer_id, old.number) then
      raise exception 'Issued invoices cannot be changed — void it and issue a new one.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  select status into inv_status from public.invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if inv_status is not null and inv_status <> 'Draft' then
    raise exception 'Lines of an issued invoice cannot be changed.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger invoices_guard_issued before update on public.invoices
  for each row execute function private.guard_issued_invoice();
create trigger invoice_lines_guard_issued before insert or update or delete on public.invoice_lines
  for each row execute function private.guard_issued_invoice();
