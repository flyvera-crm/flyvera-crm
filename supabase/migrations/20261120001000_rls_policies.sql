-- ════════════════════════════════════════════════════════════════════════════
-- FLYVERA CRM · Migration 10 · Role-based access (Row Level Security)
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHO SEES WHAT (summary — full matrix in docs/database/README.md)
--   admin            everything in the organization
--   sales_manager    customers/leads/quotes/bookings assigned to their teams (+ unassigned)
--   sales_agent      only customers/leads/quotes/bookings assigned to them
--   ticketing_agent  all bookings, passengers, PNRs, tickets; customers who have bookings
--   finance_manager  payments, refunds, invoices, supplier money; read bookings & their customers
--   support_agent    all customer profiles, leads (read) and WhatsApp; NO money, passports or passengers
--
-- Access checks live in private.* SECURITY DEFINER functions: one place per rule,
-- and no RLS recursion between tables that reference each other.

-- ════════════════════ 1. Access-check helpers ════════════════════

-- Customers --------------------------------------------------------------------
create or replace function private.can_read_customer(org uuid, cust uuid, assignee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when r in ('admin', 'support_agent') then true
    when r in ('sales_manager', 'sales_agent') then private.in_sales_scope(org, assignee)
    when r in ('ticketing_agent', 'finance_manager') then exists (select 1 from public.bookings b where b.customer_id = cust)
    else false
  end
  from (select private.member_role(org) as r) x;
$$;

create or replace function private.can_write_customer(org uuid, assignee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when r in ('admin', 'support_agent') then true
    when r in ('sales_manager', 'sales_agent') then private.in_sales_scope(org, assignee)
    else false
  end
  from (select private.member_role(org) as r) x;
$$;

create or replace function private.customer_visible(cust uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select private.can_read_customer(c.organization_id, c.id, c.assigned_to) from public.customers c where c.id = cust),
    false);
$$;

-- Passports / ID documents: admin, sales (their customers), ticketing (customers with bookings)
create or replace function private.can_access_documents(org uuid, cust uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when r = 'admin' then true
    when r in ('sales_manager', 'sales_agent') then private.customer_visible(cust)
    when r = 'ticketing_agent' then exists (select 1 from public.bookings b where b.customer_id = cust and b.organization_id = org)
    else false
  end
  from (select private.member_role(org) as r) x;
$$;

-- Leads ------------------------------------------------------------------------
create or replace function private.can_read_lead(org uuid, assignee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when r in ('admin', 'support_agent') then true
    when r in ('sales_manager', 'sales_agent') then private.in_sales_scope(org, assignee)
    else false
  end
  from (select private.member_role(org) as r) x;
$$;

create or replace function private.can_write_lead(org uuid, assignee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when r = 'admin' then true
    when r in ('sales_manager', 'sales_agent') then private.in_sales_scope(org, assignee)
    else false
  end
  from (select private.member_role(org) as r) x;
$$;

create or replace function private.lead_visible(lead uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select private.can_read_lead(l.organization_id, l.assigned_to) from public.leads l where l.id = lead),
    false);
$$;

-- Bookings ---------------------------------------------------------------------
create or replace function private.can_read_booking(org uuid, cust uuid, agent uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when r in ('admin', 'ticketing_agent', 'finance_manager', 'support_agent') then true
    when r in ('sales_manager', 'sales_agent') then private.in_sales_scope(org, agent) or private.customer_visible(cust)
    else false
  end
  from (select private.member_role(org) as r) x;
$$;

create or replace function private.can_write_booking(org uuid, cust uuid, agent uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when r in ('admin', 'ticketing_agent', 'finance_manager') then true
    when r in ('sales_manager', 'sales_agent') then private.in_sales_scope(org, agent) or private.customer_visible(cust)
    else false
  end
  from (select private.member_role(org) as r) x;
$$;

create or replace function private.booking_visible(bk uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select private.can_read_booking(b.organization_id, b.customer_id, b.agent_id) from public.bookings b where b.id = bk),
    false);
$$;

-- Prices, costs, payments, invoices of a booking (support: never)
create or replace function private.can_view_booking_money(org uuid, bk uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when r in ('admin', 'finance_manager', 'ticketing_agent') then true
    when r in ('sales_manager', 'sales_agent') then private.booking_visible(bk)
    else false
  end
  from (select private.member_role(org) as r) x;
$$;

-- Editing booked services
create or replace function private.can_edit_booking_services(org uuid, bk uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when r in ('admin', 'ticketing_agent') then true
    when r in ('sales_manager', 'sales_agent') then private.booking_visible(bk)
    else false
  end
  from (select private.member_role(org) as r) x;
$$;

-- Passenger records (names, DOB, passport snapshot)
create or replace function private.can_access_passengers(org uuid, bk uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when r in ('admin', 'ticketing_agent') then true
    when r in ('sales_manager', 'sales_agent') then private.booking_visible(bk)
    else false
  end
  from (select private.member_role(org) as r) x;
$$;

-- PNRs & flight segments (support may read them to answer flight questions)
create or replace function private.can_read_travel_records(org uuid, bk uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when r in ('admin', 'ticketing_agent', 'finance_manager', 'support_agent') then true
    when r in ('sales_manager', 'sales_agent') then private.booking_visible(bk)
    else false
  end
  from (select private.member_role(org) as r) x;
$$;

-- Tickets & e-ticket files (contain fares)
create or replace function private.can_read_tickets(org uuid, bk uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when r in ('admin', 'ticketing_agent', 'finance_manager') then true
    when r in ('sales_manager', 'sales_agent') then private.booking_visible(bk)
    else false
  end
  from (select private.member_role(org) as r) x;
$$;

create or replace function private.is_finance(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_role(org, 'admin', 'finance_manager');
$$;

create or replace function private.invoice_money_visible(inv uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select private.can_view_booking_money(i.organization_id, i.booking_id) from public.invoices i where i.id = inv),
    false);
$$;

-- Quotations -------------------------------------------------------------------
create or replace function private.sales_can_reach_quote(org uuid, cust uuid, lead uuid, preparer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.in_sales_scope(org, preparer)
      or (cust is not null and private.customer_visible(cust))
      or (lead is not null and private.lead_visible(lead));
$$;

create or replace function private.can_read_quotation(org uuid, cust uuid, lead uuid, preparer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when r in ('admin', 'finance_manager', 'ticketing_agent') then true
    when r in ('sales_manager', 'sales_agent') then private.sales_can_reach_quote(org, cust, lead, preparer)
    else false
  end
  from (select private.member_role(org) as r) x;
$$;

create or replace function private.can_write_quotation(org uuid, cust uuid, lead uuid, preparer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when r = 'admin' then true
    when r in ('sales_manager', 'sales_agent') then private.sales_can_reach_quote(org, cust, lead, preparer)
    else false
  end
  from (select private.member_role(org) as r) x;
$$;

create or replace function private.quotation_visible(q uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select private.can_read_quotation(x.organization_id, x.customer_id, x.lead_id, x.prepared_by)
                   from public.quotations x where x.id = q), false);
$$;

create or replace function private.quotation_writable(q uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select private.can_write_quotation(x.organization_id, x.customer_id, x.lead_id, x.prepared_by)
                   from public.quotations x where x.id = q), false);
$$;

-- Flight searches --------------------------------------------------------------
create or replace function private.can_read_flight_search(org uuid, creator uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when r in ('admin', 'ticketing_agent') then true
    when r in ('sales_manager', 'sales_agent') then private.in_sales_scope(org, creator)
    else false
  end
  from (select private.member_role(org) as r) x;
$$;

create or replace function private.flight_search_visible(s uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select private.can_read_flight_search(f.organization_id, f.created_by)
                   from public.flight_searches f where f.id = s), false);
$$;

-- WhatsApp ---------------------------------------------------------------------
create or replace function private.can_access_conversation(org uuid, assignee uuid, cust uuid, lead uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when r in ('admin', 'support_agent') then true
    when r in ('sales_manager', 'sales_agent') then
      private.in_sales_scope(org, assignee)
      or (cust is not null and private.customer_visible(cust))
      or (lead is not null and private.lead_visible(lead))
    else false
  end
  from (select private.member_role(org) as r) x;
$$;

create or replace function private.conversation_visible(conv uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select private.can_access_conversation(c.organization_id, c.assigned_to, c.customer_id, c.lead_id)
                   from public.whatsapp_conversations c where c.id = conv), false);
$$;

-- Tasks ------------------------------------------------------------------------
create or replace function private.can_read_task(org uuid, assignee uuid, creator uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_member(org) and (
       private.has_role(org, 'admin')
    or assignee = auth.uid()
    or creator = auth.uid()
    or (private.has_role(org, 'sales_manager') and assignee in (select private.managed_user_ids(org)))
  );
$$;

-- Support agents may edit customer details but not re-assign customers.
create or replace function private.guard_customer_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null
     and new.assigned_to is distinct from old.assigned_to
     and private.has_role(new.organization_id, 'support_agent') then
    raise exception 'Support agents cannot re-assign customers.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger customers_guard_assignment before update on public.customers
  for each row execute function private.guard_customer_assignment();

-- ════════════════════ 2. Table privileges ════════════════════
-- Supabase grants everything to anon/authenticated by default and relies on
-- RLS. We go further: anon (logged-out visitors) gets NOTHING.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

grant select, insert, update, delete on all tables in schema public to authenticated;

-- Append-only / server-written tables
revoke insert, update, delete on public.audit_logs from authenticated;
revoke insert, update, delete on public.payment_transactions from authenticated;
revoke update, delete on public.booking_events, public.lead_activities, public.whatsapp_messages from authenticated;
-- Money is corrected with reversing entries, never deleted
revoke delete on public.payments, public.refunds, public.supplier_transactions, public.invoices from authenticated;

-- Passport numbers: the encrypted column can't be read or written directly
-- (use the RPC functions in migration 11).
revoke all on public.customer_travel_documents from authenticated;
grant select (id, organization_id, customer_id, document_type, number_last4, issuing_country, nationality,
              issue_date, expiry_date, is_primary, verified_by, verified_at, created_by, created_at, updated_at)
  on public.customer_travel_documents to authenticated;
grant update (document_type, issuing_country, nationality, issue_date, expiry_date, is_primary, verified_by, verified_at)
  on public.customer_travel_documents to authenticated;
grant delete on public.customer_travel_documents to authenticated;

revoke all on public.passengers from authenticated;
grant select (id, organization_id, booking_id, customer_id, passenger_type, title, first_name, last_name, date_of_birth,
              gender, nationality, document_type, document_last4, document_issuing_country, document_expiry_on,
              frequent_flyer, meal_preference, special_assistance, is_lead_passenger, created_at, updated_at)
  on public.passengers to authenticated;
grant insert (id, organization_id, booking_id, customer_id, passenger_type, title, first_name, last_name, date_of_birth,
              gender, nationality, frequent_flyer, meal_preference, special_assistance, is_lead_passenger)
  on public.passengers to authenticated;
grant update (customer_id, passenger_type, title, first_name, last_name, date_of_birth, gender, nationality,
              frequent_flyer, meal_preference, special_assistance, is_lead_passenger)
  on public.passengers to authenticated;
grant delete on public.passengers to authenticated;

-- Functions: nothing callable by anon; policy helpers callable by signed-in users.
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
revoke execute on function private.next_code(uuid, text, bigint) from authenticated;

-- ════════════════════ 3. Policies ════════════════════

-- Organizations & team ---------------------------------------------------------
create policy "organizations: members read" on public.organizations
  for select to authenticated using (private.is_member(id));
create policy "organizations: admins update" on public.organizations
  for update to authenticated using (private.has_role(id, 'admin')) with check (private.has_role(id, 'admin'));
-- No INSERT/DELETE policy: organizations are created by the service role only (no public sign-up).

create policy "profiles: self and colleagues read" on public.profiles
  for select to authenticated using (id = auth.uid() or private.shares_org(id));
create policy "profiles: self update" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "members: members read" on public.organization_members
  for select to authenticated using (private.is_member(organization_id));
create policy "members: admins insert" on public.organization_members
  for insert to authenticated with check (private.has_role(organization_id, 'admin'));
create policy "members: admins update" on public.organization_members
  for update to authenticated using (private.has_role(organization_id, 'admin')) with check (private.has_role(organization_id, 'admin'));
create policy "members: admins delete" on public.organization_members
  for delete to authenticated using (private.has_role(organization_id, 'admin'));

create policy "teams: members read" on public.teams
  for select to authenticated using (private.is_member(organization_id));
create policy "teams: admins manage" on public.teams
  for all to authenticated using (private.has_role(organization_id, 'admin')) with check (private.has_role(organization_id, 'admin'));

create policy "team members: members read" on public.team_members
  for select to authenticated using (private.is_member(organization_id));
create policy "team members: admins manage" on public.team_members
  for all to authenticated using (private.has_role(organization_id, 'admin')) with check (private.has_role(organization_id, 'admin'));

create policy "invitations: admins manage" on public.organization_invitations
  for all to authenticated using (private.has_role(organization_id, 'admin')) with check (private.has_role(organization_id, 'admin'));

-- Customers --------------------------------------------------------------------
create policy "customers: read by role" on public.customers
  for select to authenticated using (private.can_read_customer(organization_id, id, assigned_to));
create policy "customers: create in own scope" on public.customers
  for insert to authenticated with check (private.can_write_customer(organization_id, assigned_to));
create policy "customers: edit in own scope" on public.customers
  for update to authenticated
  using (private.can_write_customer(organization_id, assigned_to))
  with check (private.can_write_customer(organization_id, assigned_to));
create policy "customers: admins delete" on public.customers
  for delete to authenticated using (private.has_role(organization_id, 'admin'));

create policy "travel documents: read by role" on public.customer_travel_documents
  for select to authenticated using (private.can_access_documents(organization_id, customer_id));
create policy "travel documents: edit by role" on public.customer_travel_documents
  for update to authenticated
  using (private.can_access_documents(organization_id, customer_id))
  with check (private.can_access_documents(organization_id, customer_id));
create policy "travel documents: admins delete" on public.customer_travel_documents
  for delete to authenticated using (private.has_role(organization_id, 'admin'));

-- Leads ------------------------------------------------------------------------
create policy "leads: read by role" on public.leads
  for select to authenticated using (private.can_read_lead(organization_id, assigned_to));
create policy "leads: create (sales in scope, support any)" on public.leads
  for insert to authenticated
  with check (private.can_write_lead(organization_id, assigned_to) or private.has_role(organization_id, 'support_agent'));
create policy "leads: edit in own scope" on public.leads
  for update to authenticated
  using (private.can_write_lead(organization_id, assigned_to))
  with check (private.can_write_lead(organization_id, assigned_to));
create policy "leads: admins delete" on public.leads
  for delete to authenticated using (private.has_role(organization_id, 'admin'));

create policy "lead activities: read with the lead" on public.lead_activities
  for select to authenticated using (private.lead_visible(lead_id));
create policy "lead activities: add as yourself" on public.lead_activities
  for insert to authenticated
  with check (private.lead_visible(lead_id) and created_by = auth.uid()
              and private.has_role(organization_id, 'admin', 'sales_manager', 'sales_agent', 'support_agent'));

-- Tasks ------------------------------------------------------------------------
create policy "tasks: own, assigned, team" on public.tasks
  for select to authenticated using (private.can_read_task(organization_id, assigned_to, created_by));
create policy "tasks: create as yourself" on public.tasks
  for insert to authenticated with check (private.is_member(organization_id) and created_by = auth.uid());
create policy "tasks: update visible" on public.tasks
  for update to authenticated
  using (private.can_read_task(organization_id, assigned_to, created_by))
  with check (private.is_member(organization_id));
create policy "tasks: creator or admin deletes" on public.tasks
  for delete to authenticated using (private.has_role(organization_id, 'admin') or created_by = auth.uid());

-- Flight searches & offers -----------------------------------------------------
create policy "flight searches: read by role" on public.flight_searches
  for select to authenticated using (private.can_read_flight_search(organization_id, created_by));
create policy "flight searches: create as yourself" on public.flight_searches
  for insert to authenticated
  with check (created_by = auth.uid() and private.has_role(organization_id, 'admin', 'sales_manager', 'sales_agent', 'ticketing_agent'));
create policy "flight searches: creator or admin changes" on public.flight_searches
  for update to authenticated
  using (created_by = auth.uid() or private.has_role(organization_id, 'admin'))
  with check (private.is_member(organization_id));
create policy "flight searches: creator or admin deletes" on public.flight_searches
  for delete to authenticated using (created_by = auth.uid() or private.has_role(organization_id, 'admin'));

create policy "flight offers: read with the search" on public.flight_offers
  for select to authenticated using (private.flight_search_visible(search_id));
create policy "flight offers: manage with the search" on public.flight_offers
  for all to authenticated
  using (private.flight_search_visible(search_id) and private.has_role(organization_id, 'admin', 'sales_manager', 'sales_agent', 'ticketing_agent'))
  with check (private.flight_search_visible(search_id) and private.has_role(organization_id, 'admin', 'sales_manager', 'sales_agent', 'ticketing_agent'));

-- Quotations -------------------------------------------------------------------
create policy "quotations: read by role" on public.quotations
  for select to authenticated using (private.can_read_quotation(organization_id, customer_id, lead_id, prepared_by));
create policy "quotations: create in scope" on public.quotations
  for insert to authenticated with check (private.can_write_quotation(organization_id, customer_id, lead_id, prepared_by));
create policy "quotations: edit in scope" on public.quotations
  for update to authenticated
  using (private.can_write_quotation(organization_id, customer_id, lead_id, prepared_by))
  with check (private.can_write_quotation(organization_id, customer_id, lead_id, prepared_by));
create policy "quotations: admins delete" on public.quotations
  for delete to authenticated using (private.has_role(organization_id, 'admin'));

create policy "quotation items: read with the quotation" on public.quotation_items
  for select to authenticated using (private.quotation_visible(quotation_id));
create policy "quotation items: edit with the quotation" on public.quotation_items
  for all to authenticated using (private.quotation_writable(quotation_id)) with check (private.quotation_writable(quotation_id));

-- Suppliers --------------------------------------------------------------------
create policy "suppliers: staff read (not support)" on public.suppliers
  for select to authenticated
  using (private.has_role(organization_id, 'admin', 'sales_manager', 'sales_agent', 'ticketing_agent', 'finance_manager'));
create policy "suppliers: ticketing & finance create" on public.suppliers
  for insert to authenticated with check (private.has_role(organization_id, 'admin', 'ticketing_agent', 'finance_manager'));
create policy "suppliers: ticketing & finance edit" on public.suppliers
  for update to authenticated
  using (private.has_role(organization_id, 'admin', 'ticketing_agent', 'finance_manager'))
  with check (private.has_role(organization_id, 'admin', 'ticketing_agent', 'finance_manager'));
create policy "suppliers: admins delete" on public.suppliers
  for delete to authenticated using (private.has_role(organization_id, 'admin'));

-- Bookings ---------------------------------------------------------------------
create policy "bookings: read by role" on public.bookings
  for select to authenticated using (private.can_read_booking(organization_id, customer_id, agent_id));
create policy "bookings: create by role" on public.bookings
  for insert to authenticated
  with check (private.can_write_booking(organization_id, customer_id, agent_id)
              and not private.has_role(organization_id, 'finance_manager'));  -- finance edits (refund decisions) but doesn't create
create policy "bookings: edit by role" on public.bookings
  for update to authenticated
  using (private.can_write_booking(organization_id, customer_id, agent_id))
  with check (private.can_write_booking(organization_id, customer_id, agent_id));
create policy "bookings: admins delete" on public.bookings
  for delete to authenticated using (private.has_role(organization_id, 'admin'));

create policy "booking services: read where money is visible" on public.booking_services
  for select to authenticated using (private.can_view_booking_money(organization_id, booking_id));
create policy "booking services: edit by role" on public.booking_services
  for all to authenticated
  using (private.can_edit_booking_services(organization_id, booking_id))
  with check (private.can_edit_booking_services(organization_id, booking_id));

create policy "booking events: read with the booking" on public.booking_events
  for select to authenticated using (private.booking_visible(booking_id));
create policy "booking events: add as yourself" on public.booking_events
  for insert to authenticated with check (private.booking_visible(booking_id) and created_by = auth.uid());

create policy "passengers: read by role" on public.passengers
  for select to authenticated using (private.can_access_passengers(organization_id, booking_id));
create policy "passengers: create by role" on public.passengers
  for insert to authenticated with check (private.can_access_passengers(organization_id, booking_id));
create policy "passengers: edit by role" on public.passengers
  for update to authenticated
  using (private.can_access_passengers(organization_id, booking_id))
  with check (private.can_access_passengers(organization_id, booking_id));
create policy "passengers: admins & ticketing delete" on public.passengers
  for delete to authenticated using (private.has_role(organization_id, 'admin', 'ticketing_agent'));

create policy "PNRs: read by role" on public.pnr_records
  for select to authenticated using (private.can_read_travel_records(organization_id, booking_id));
create policy "PNRs: ticketing manages" on public.pnr_records
  for all to authenticated
  using (private.has_role(organization_id, 'admin', 'ticketing_agent'))
  with check (private.has_role(organization_id, 'admin', 'ticketing_agent'));

create policy "segments: read by role" on public.booking_segments
  for select to authenticated using (private.can_read_travel_records(organization_id, booking_id));
create policy "segments: ticketing manages" on public.booking_segments
  for all to authenticated
  using (private.has_role(organization_id, 'admin', 'ticketing_agent'))
  with check (private.has_role(organization_id, 'admin', 'ticketing_agent'));

create policy "tickets: read by role" on public.tickets
  for select to authenticated using (private.can_read_tickets(organization_id, booking_id));
create policy "tickets: ticketing issues" on public.tickets
  for insert to authenticated with check (private.has_role(organization_id, 'admin', 'ticketing_agent'));
create policy "tickets: ticketing updates" on public.tickets
  for update to authenticated
  using (private.has_role(organization_id, 'admin', 'ticketing_agent'))
  with check (private.has_role(organization_id, 'admin', 'ticketing_agent'));
create policy "tickets: admins delete" on public.tickets
  for delete to authenticated using (private.has_role(organization_id, 'admin'));

create policy "ticket documents: read with tickets" on public.ticket_documents
  for select to authenticated using (private.can_read_tickets(organization_id, booking_id));
create policy "ticket documents: ticketing uploads" on public.ticket_documents
  for insert to authenticated with check (private.has_role(organization_id, 'admin', 'ticketing_agent'));
create policy "ticket documents: ticketing deletes" on public.ticket_documents
  for delete to authenticated using (private.has_role(organization_id, 'admin', 'ticketing_agent'));

-- Money ------------------------------------------------------------------------
create policy "payments: read where money is visible" on public.payments
  for select to authenticated using (private.can_view_booking_money(organization_id, booking_id));
create policy "payments: finance records" on public.payments
  for insert to authenticated with check (private.is_finance(organization_id));
create policy "payments: finance corrects" on public.payments
  for update to authenticated using (private.is_finance(organization_id)) with check (private.is_finance(organization_id));

create policy "payment transactions: finance reads" on public.payment_transactions
  for select to authenticated using (private.is_finance(organization_id));

create policy "refunds: read where money is visible" on public.refunds
  for select to authenticated using (private.can_view_booking_money(organization_id, booking_id));
create policy "refunds: finance records, others may only request" on public.refunds
  for insert to authenticated
  with check (
    private.is_finance(organization_id)
    or (
      status = 'Requested' and approved_at is null and approved_by is null and paid_on is null
      and requested_by = auth.uid()
      and private.has_role(organization_id, 'sales_manager', 'sales_agent', 'ticketing_agent')
      and private.booking_visible(booking_id)
    )
  );
create policy "refunds: finance approves & pays" on public.refunds
  for update to authenticated using (private.is_finance(organization_id)) with check (private.is_finance(organization_id));

create policy "invoices: read where money is visible" on public.invoices
  for select to authenticated using (private.can_view_booking_money(organization_id, booking_id));
create policy "invoices: finance creates" on public.invoices
  for insert to authenticated with check (private.is_finance(organization_id));
create policy "invoices: finance edits" on public.invoices
  for update to authenticated using (private.is_finance(organization_id)) with check (private.is_finance(organization_id));

create policy "invoice lines: read with the invoice" on public.invoice_lines
  for select to authenticated using (private.invoice_money_visible(invoice_id));
create policy "invoice lines: finance manages" on public.invoice_lines
  for all to authenticated using (private.is_finance(organization_id)) with check (private.is_finance(organization_id));

create policy "supplier transactions: finance & ticketing read" on public.supplier_transactions
  for select to authenticated using (private.has_role(organization_id, 'admin', 'finance_manager', 'ticketing_agent'));
create policy "supplier transactions: finance records" on public.supplier_transactions
  for insert to authenticated with check (private.is_finance(organization_id));
create policy "supplier transactions: finance corrects" on public.supplier_transactions
  for update to authenticated using (private.is_finance(organization_id)) with check (private.is_finance(organization_id));

-- WhatsApp ---------------------------------------------------------------------
create policy "conversations: read by role" on public.whatsapp_conversations
  for select to authenticated using (private.can_access_conversation(organization_id, assigned_to, customer_id, lead_id));
create policy "conversations: create by role" on public.whatsapp_conversations
  for insert to authenticated with check (private.can_access_conversation(organization_id, assigned_to, customer_id, lead_id));
create policy "conversations: update by role" on public.whatsapp_conversations
  for update to authenticated
  using (private.can_access_conversation(organization_id, assigned_to, customer_id, lead_id))
  with check (private.can_access_conversation(organization_id, assigned_to, customer_id, lead_id));
create policy "conversations: admins delete" on public.whatsapp_conversations
  for delete to authenticated using (private.has_role(organization_id, 'admin'));

create policy "messages: read with the conversation" on public.whatsapp_messages
  for select to authenticated using (private.conversation_visible(conversation_id));
create policy "messages: send as yourself" on public.whatsapp_messages
  for insert to authenticated
  with check (private.conversation_visible(conversation_id) and direction = 'Outbound' and sent_by = auth.uid());

-- AI actions -------------------------------------------------------------------
create policy "ai actions: own, team (managers), all (admin)" on public.ai_actions
  for select to authenticated
  using (
    private.is_member(organization_id) and (
      requested_by = auth.uid()
      or private.has_role(organization_id, 'admin')
      or (private.has_role(organization_id, 'sales_manager') and requested_by in (select private.managed_user_ids(organization_id)))
    )
  );
create policy "ai actions: request as yourself" on public.ai_actions
  for insert to authenticated with check (private.is_member(organization_id) and requested_by = auth.uid());
create policy "ai actions: requester or admin reviews" on public.ai_actions
  for update to authenticated
  using (private.is_member(organization_id) and (requested_by = auth.uid() or private.has_role(organization_id, 'admin')))
  with check (private.is_member(organization_id));

-- Audit log --------------------------------------------------------------------
create policy "audit log: admins read" on public.audit_logs
  for select to authenticated using (private.has_role(organization_id, 'admin'));
