-- ════════════════════════════════════════════════════════════════════════════
-- FLYVERA CRM · Migration 12 · Calculated views
-- ════════════════════════════════════════════════════════════════════════════
-- Totals are never stored, so they can't drift out of sync. The maths matches
-- the frontend (src/lib/quote-math.ts, booking-rules.ts):
--   subtotal = Σ round(qty × unit_price, 2)
--   taxable  = subtotal − min(discount, subtotal)
--   tax      = round(taxable × tax_rate / 100, 2)
--   total    = taxable + tax ;  profit = taxable − Σ cost
-- All views use security_invoker, so the reader's RLS applies, and they add an
-- explicit role filter so roles without money access get no rows (not zeros).

create view public.booking_financials
with (security_invoker = true) as
with base as (
  select
    b.id as booking_id, b.organization_id, b.code, b.status, b.currency, b.customer_id,
    b.depart_on, b.deposit_due_on, b.balance_due_on, b.created_at, b.agent_id,
    s.subtotal, least(b.discount, s.subtotal) as discount, b.tax_rate, s.cost,
    p.received, r.refunded, st.supplier_paid
  from public.bookings b
  cross join lateral (
    select coalesce(sum(round(x.quantity * x.unit_price, 2)), 0)::numeric(12, 2) as subtotal,
           coalesce(sum(x.cost), 0)::numeric(12, 2) as cost
    from public.booking_services x where x.booking_id = b.id
  ) s
  cross join lateral (select coalesce(sum(x.amount), 0)::numeric(12, 2) as received from public.payments x where x.booking_id = b.id) p
  cross join lateral (
    select coalesce(sum(x.amount), 0)::numeric(12, 2) as refunded from public.refunds x where x.booking_id = b.id and x.status = 'Paid'
  ) r
  cross join lateral (
    select coalesce(sum(case when x.kind = 'Payment' then x.amount else -x.amount end), 0)::numeric(12, 2) as supplier_paid
    from public.supplier_transactions x where x.booking_id = b.id
  ) st
  where private.can_view_booking_money(b.organization_id, b.id)
), calc as (
  select *, (subtotal - discount)::numeric(12, 2) as taxable,
         round((subtotal - discount) * tax_rate / 100, 2)::numeric(12, 2) as tax
  from base
)
select
  booking_id, organization_id, code, status, currency, customer_id, agent_id, depart_on,
  deposit_due_on, balance_due_on, created_at,
  subtotal, discount, taxable, tax_rate, tax,
  (taxable + tax)::numeric(12, 2)                                     as total,
  cost,
  (taxable - cost)::numeric(12, 2)                                    as profit,
  case when taxable > 0 then round((taxable - cost) / taxable * 100, 1) end as margin_percent,
  received,
  refunded,
  (received - refunded)::numeric(12, 2)                               as paid,
  case when status = 'Cancelled' then 0
       else greatest(taxable + tax - (received - refunded), 0) end::numeric(12, 2) as balance,
  supplier_paid,
  (cost - supplier_paid)::numeric(12, 2)                              as supplier_owed
from calc;
comment on view public.booking_financials is 'Per-booking money: total, paid (net of refunds), balance, cost, profit, supplier owed. No rows for roles without money access.';

create view public.quotation_totals
with (security_invoker = true) as
with base as (
  select q.id as quotation_id, q.organization_id, q.code, q.status, q.valid_until, q.currency,
         s.subtotal, least(q.discount, s.subtotal) as discount, q.tax_rate, s.cost
  from public.quotations q
  cross join lateral (
    select coalesce(sum(round(i.quantity * i.unit_price, 2)), 0)::numeric(12, 2) as subtotal,
           coalesce(sum(i.cost), 0)::numeric(12, 2) as cost
    from public.quotation_items i where i.quotation_id = q.id
  ) s
), calc as (
  select *, (subtotal - discount)::numeric(12, 2) as taxable,
         round((subtotal - discount) * tax_rate / 100, 2)::numeric(12, 2) as tax
  from base
)
select quotation_id, organization_id, code, status,
       (status = 'Sent' and valid_until < current_date) as is_expired,
       currency, subtotal, discount, taxable, tax_rate, tax,
       (taxable + tax)::numeric(12, 2) as total,
       cost,
       (taxable - cost)::numeric(12, 2) as profit,
       case when taxable > 0 then round((taxable - cost) / taxable * 100, 1) end as margin_percent
from calc;

-- Customer lifetime figures = imported history + live bookings (cancelled excluded).
create view public.customer_stats
with (security_invoker = true) as
select
  c.id as customer_id,
  c.organization_id,
  (c.imported_trip_count + coalesce(bk.trips, 0))::integer                      as trip_count,
  (c.imported_lifetime_value + coalesce(bk.value, 0))::numeric(12, 2)          as lifetime_value,
  nullif(greatest(coalesce(c.imported_last_trip_on, date '0001-01-01'),
                  coalesce(bk.last_trip_on, date '0001-01-01')), date '0001-01-01') as last_trip_on,
  coalesce(bk.outstanding, 0)::numeric(12, 2)                                    as outstanding_balance
from public.customers c
left join lateral (
  select count(*) as trips,
         sum(f.total) as value,
         max(f.depart_on) filter (where f.depart_on <= current_date) as last_trip_on,
         sum(f.balance) as outstanding
  from public.booking_financials f
  where f.customer_id = c.id and f.status <> 'Cancelled'
) bk on true
where private.has_role(c.organization_id, 'admin', 'sales_manager', 'sales_agent', 'ticketing_agent', 'finance_manager');

-- One line per money movement (finance & admin only).
create view public.money_ledger
with (security_invoker = true) as
select p.organization_id, p.booking_id, 'Customer payment'::text as entry_type, p.receipt_number as reference,
       p.received_on as entry_date, p.amount as amount_in, 0::numeric(12, 2) as amount_out, p.method, p.currency
from public.payments p
where private.is_finance(p.organization_id)
union all
select r.organization_id, r.booking_id, 'Customer refund', r.reference_number, r.paid_on, 0, r.amount, r.method, r.currency
from public.refunds r
where r.status = 'Paid' and private.is_finance(r.organization_id)
union all
select t.organization_id, t.booking_id, 'Supplier ' || lower(t.kind::text), t.reference, t.occurred_on,
       case when t.kind = 'Payment' then 0 else t.amount end,
       case when t.kind = 'Payment' then t.amount else 0 end,
       t.method, t.currency
from public.supplier_transactions t
where private.is_finance(t.organization_id);

revoke all on public.booking_financials, public.quotation_totals, public.customer_stats, public.money_ledger from anon;
grant select on public.booking_financials, public.quotation_totals, public.customer_stats, public.money_ledger to authenticated;
