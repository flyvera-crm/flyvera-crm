-- ════════════════════════════════════════════════════════════════════════════
-- FLYVERA CRM · Migration 13 · Private file storage
-- ════════════════════════════════════════════════════════════════════════════
-- Two PRIVATE buckets (no public URLs; files are served via short-lived signed URLs):
--   ticket-documents  <organization_id>/<booking_id>/<file>   e-tickets, vouchers
--   travel-documents  <organization_id>/<customer_id>/<file>  passport / visa scans

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('ticket-documents', 'ticket-documents', false, 20971520, array['application/pdf', 'image/png', 'image/jpeg']),
  ('travel-documents', 'travel-documents', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

-- Path helpers: first folder = organization, second = booking / customer.
create or replace function private.storage_org(object_name text)
returns uuid language sql immutable set search_path = '' as $$
  select private.try_uuid((storage.foldername(object_name))[1]);
$$;
create or replace function private.storage_record(object_name text)
returns uuid language sql immutable set search_path = '' as $$
  select private.try_uuid((storage.foldername(object_name))[2]);
$$;
grant execute on function private.storage_org(text), private.storage_record(text) to authenticated;

-- E-tickets & vouchers -----------------------------------------------------------
create policy "ticket files: read with tickets" on storage.objects
  for select to authenticated
  using (bucket_id = 'ticket-documents'
         and private.can_read_tickets(private.storage_org(name), private.storage_record(name))
         and exists (select 1 from public.bookings b
                     where b.id = private.storage_record(name) and b.organization_id = private.storage_org(name)));
create policy "ticket files: ticketing uploads" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'ticket-documents'
              and private.has_role(private.storage_org(name), 'admin', 'ticketing_agent')
              and exists (select 1 from public.bookings b
                          where b.id = private.storage_record(name) and b.organization_id = private.storage_org(name)));
create policy "ticket files: ticketing deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'ticket-documents' and private.has_role(private.storage_org(name), 'admin', 'ticketing_agent'));

-- Passport / visa scans ------------------------------------------------------------
create policy "travel document files: read by role" on storage.objects
  for select to authenticated
  using (bucket_id = 'travel-documents'
         and private.can_access_documents(private.storage_org(name), private.storage_record(name))
         and exists (select 1 from public.customers c
                     where c.id = private.storage_record(name) and c.organization_id = private.storage_org(name)));
create policy "travel document files: upload by role" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'travel-documents'
              and private.can_access_documents(private.storage_org(name), private.storage_record(name))
              and exists (select 1 from public.customers c
                          where c.id = private.storage_record(name) and c.organization_id = private.storage_org(name)));
create policy "travel document files: admins delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'travel-documents' and private.has_role(private.storage_org(name), 'admin'));
