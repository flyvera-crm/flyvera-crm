-- ════════════════════════════════════════════════════════════════════════════
-- FLYVERA CRM · Migration 02 · Enumerated types
-- ════════════════════════════════════════════════════════════════════════════
-- Business values use EXACTLY the labels the frontend already shows
-- (e.g. 'Ticketed', 'Bank transfer', 'Walk-in'), so no translation layer is
-- needed when the screens are connected. Roles use snake_case identifiers.

-- Team roles ------------------------------------------------------------------
create type public.app_role as enum (
  'admin',            -- full access, team & settings
  'sales_manager',    -- sales data of the teams they manage
  'sales_agent',      -- only their assigned customers & leads
  'ticketing_agent',  -- bookings, passengers, PNRs, tickets
  'finance_manager',  -- payments, invoices, refunds, supplier payments, reports
  'support_agent'     -- customer profiles & conversations; no money or passports
);
create type public.member_status as enum ('active', 'disabled');

-- Customers -------------------------------------------------------------------
create type public.customer_tier as enum ('Platinum', 'Gold', 'Silver', 'Standard');
create type public.customer_status as enum ('Active', 'Travelling', 'Inactive');
create type public.contact_method as enum ('WhatsApp', 'Email', 'Phone');
create type public.seat_preference as enum ('No preference', 'Window', 'Aisle', 'Extra legroom');
create type public.travel_document_type as enum ('Passport', 'National ID', 'Visa', 'Residence permit');

-- Leads & tasks ---------------------------------------------------------------
create type public.lead_stage as enum ('New', 'Contacted', 'Quoted', 'Negotiation', 'Won', 'Lost');
create type public.lead_source as enum ('WhatsApp', 'Website', 'Referral', 'Instagram', 'Phone', 'Walk-in');
create type public.lead_priority as enum ('Hot', 'Warm', 'Cold');
create type public.trip_type as enum ('Holiday', 'Honeymoon', 'Family', 'Business', 'Umrah', 'Group');
create type public.lead_activity_type as enum ('Note', 'Call', 'WhatsApp', 'Email', 'Meeting', 'Stage change', 'Quotation');
create type public.task_status as enum ('Open', 'Done', 'Cancelled');
create type public.task_priority as enum ('Low', 'Normal', 'High');

-- Quotations & flights --------------------------------------------------------
create type public.quote_status as enum ('Draft', 'Sent', 'Accepted', 'Declined');
create type public.quote_item_type as enum ('Flight', 'Hotel', 'Transfer', 'Activity', 'Insurance', 'Visa', 'Other');
create type public.cabin_class as enum ('Economy', 'Premium economy', 'Business', 'First');

-- Bookings & travel -----------------------------------------------------------
create type public.booking_status as enum ('Pending', 'Confirmed', 'Ticketed', 'Completed', 'Cancelled');
create type public.refund_decision as enum ('Refunded', 'Kept as fee');
create type public.supplier_type as enum ('Airline', 'Hotel', 'Ground handler', 'Activity provider', 'Insurer', 'Visa agency', 'Other');
create type public.passenger_type as enum ('Adult', 'Child', 'Infant');
create type public.pnr_provider as enum ('Amadeus', 'Sabre', 'Travelport', 'NDC', 'Airline direct', 'Manual');
create type public.pnr_status as enum ('Active', 'Ticketed', 'Cancelled', 'Expired');
create type public.segment_status as enum ('Confirmed', 'Waitlisted', 'Cancelled', 'Flown');
create type public.ticket_status as enum ('Issued', 'Voided', 'Refunded', 'Exchanged');
create type public.ticket_document_kind as enum ('E-ticket', 'Itinerary', 'Voucher', 'Invoice', 'Other');

-- Money -----------------------------------------------------------------------
create type public.payment_method as enum ('Card', 'Bank transfer', 'Cash', 'Other');
create type public.payment_txn_status as enum ('Pending', 'Succeeded', 'Failed', 'Refunded');
create type public.refund_status as enum ('Requested', 'Approved', 'Paid', 'Rejected');
create type public.invoice_status as enum ('Draft', 'Issued', 'Paid', 'Void');
create type public.supplier_txn_kind as enum ('Payment', 'Refund', 'Credit note');

-- WhatsApp & AI ---------------------------------------------------------------
create type public.wa_conversation_status as enum ('Open', 'Pending', 'Closed');
create type public.wa_direction as enum ('Inbound', 'Outbound');
create type public.wa_message_type as enum ('Text', 'Image', 'Document', 'Audio', 'Location', 'Template');
create type public.wa_message_status as enum ('Received', 'Queued', 'Sent', 'Delivered', 'Read', 'Failed');
create type public.ai_action_kind as enum ('Draft reply', 'Itinerary', 'Quotation draft', 'Summary', 'Lead scoring');
create type public.ai_action_status as enum ('Proposed', 'Approved', 'Applied', 'Rejected', 'Failed');
