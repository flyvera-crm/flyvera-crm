// ⚠️ DEMO DATA ONLY — replace with a database/API call later.
// Recipients match the demo customers (CU-…) and leads (LD-…).
import type { Quotation } from "@/types/crm";

export const quotations: Quotation[] = [
  {
    id: "QT-3008", status: "Draft", agent: "Priya N.", created: "2026-11-19", updated: "2026-11-19", validUntil: "2026-12-03",
    recipient: { kind: "customer", id: "CU-1018", name: "Mohammed Al-Farsi", email: "m.alfarsi@example.com", phone: "+968 9555 0186" },
    title: "February ski week in Zermatt", destination: "Zermatt, Switzerland", departDate: "2027-02-06", returnDate: "2027-02-13", adults: 2, children: 1,
    discount: 0, taxRate: 0,
    items: [
      { id: "i1", type: "Flight", description: "Return flights MCT → ZRH, business class", quantity: 3, unitPrice: 2_450, cost: 6_600 },
      { id: "i2", type: "Hotel", description: "7 nights, Family Suite with breakfast, ski-in/ski-out", quantity: 1, unitPrice: 8_900, cost: 7_700 },
      { id: "i3", type: "Transfer", description: "Private transfer Zurich ↔ Zermatt (incl. Täsch shuttle)", quantity: 1, unitPrice: 780, cost: 610 },
      { id: "i4", type: "Activity", description: "6-day lift passes + 3 private ski lessons", quantity: 1, unitPrice: 1_640, cost: 1_420 },
    ],
    notes: "Ski equipment rental can be added on request.",
  },
  {
    id: "QT-3007", status: "Accepted", agent: "Priya N.", created: "2026-10-08", updated: "2026-10-12", validUntil: "2026-10-22", sentAt: "2026-10-08", respondedAt: "2026-10-12",
    recipient: { kind: "customer", id: "CU-1004", name: "Carlos Mendes", email: "carlos.mendes@example.com", phone: "+55 11 5555 0199" },
    title: "Paris city break", destination: "Paris, France", departDate: "2026-12-01", returnDate: "2026-12-08", adults: 2, children: 0,
    discount: 0, taxRate: 0,
    items: [
      { id: "i1", type: "Flight", description: "Return flights GRU → CDG, economy", quantity: 2, unitPrice: 1_150, cost: 2_040 },
      { id: "i2", type: "Hotel", description: "7 nights, boutique hotel in Le Marais, breakfast", quantity: 1, unitPrice: 2_380, cost: 2_050 },
      { id: "i3", type: "Activity", description: "Seine dinner cruise", quantity: 2, unitPrice: 140, cost: 230 },
    ],
  },
  {
    id: "QT-3006", status: "Declined", agent: "Sara K.", created: "2026-09-25", updated: "2026-10-18", validUntil: "2026-10-09", sentAt: "2026-09-25", respondedAt: "2026-10-18",
    recipient: { kind: "lead", id: "LD-2044", name: "Hannah Weiss", email: "hannah.weiss@example.com", phone: "+41 79 555 01 44" },
    title: "Mauritius honeymoon", destination: "Mauritius", departDate: "2027-05-10", returnDate: "2027-05-20", adults: 2, children: 0,
    discount: 200, taxRate: 0,
    items: [
      { id: "i1", type: "Flight", description: "Return flights ZRH → MRU via DXB", quantity: 2, unitPrice: 1_350, cost: 2_460 },
      { id: "i2", type: "Hotel", description: "10 nights, Ocean Suite, half board", quantity: 1, unitPrice: 5_100, cost: 4_480 },
      { id: "i3", type: "Transfer", description: "Private airport transfers", quantity: 1, unitPrice: 160, cost: 120 },
    ],
  },
  {
    id: "QT-3005", status: "Draft", agent: "Sara K.", created: "2026-11-18", updated: "2026-11-19", validUntil: "2026-12-02",
    recipient: { kind: "lead", id: "LD-2050", name: "Oliver Grant", email: "oliver.grant@example.com", phone: "+61 4 5555 0102" },
    title: "Maldives honeymoon — overwater villa", destination: "Maldives", departDate: "2026-12-27", returnDate: "2027-01-05", adults: 2, children: 0,
    discount: 500, taxRate: 0,
    items: [
      { id: "i1", type: "Flight", description: "Return flights SYD → MLE via SIN, premium economy", quantity: 2, unitPrice: 2_100, cost: 3_820 },
      { id: "i2", type: "Hotel", description: "9 nights, Overwater Villa with pool, all-inclusive", quantity: 1, unitPrice: 9_600, cost: 8_350 },
      { id: "i3", type: "Transfer", description: "Return seaplane transfer", quantity: 2, unitPrice: 650, cost: 1_150 },
      { id: "i4", type: "Insurance", description: "Comprehensive travel insurance", quantity: 2, unitPrice: 95, cost: 120 },
    ],
    notes: "Honeymoon perks included: couples' spa treatment and private sandbank dinner.",
  },
  {
    id: "QT-3004", status: "Sent", agent: "Daniel R.", created: "2026-11-04", updated: "2026-11-04", validUntil: "2026-11-18", sentAt: "2026-11-04",
    recipient: { kind: "lead", id: "LD-2051", name: "Laura Schmidt", phone: "+49 151 5555 0188" },
    title: "Spring in New York", destination: "New York, USA", departDate: "2027-03-08", returnDate: "2027-03-14", adults: 2, children: 0,
    discount: 0, taxRate: 0,
    items: [
      { id: "i1", type: "Flight", description: "Return flights FRA → JFK, economy", quantity: 2, unitPrice: 890, cost: 1_610 },
      { id: "i2", type: "Hotel", description: "6 nights, Midtown hotel, room only", quantity: 1, unitPrice: 2_950, cost: 2_560 },
      { id: "i3", type: "Activity", description: "New York CityPASS", quantity: 2, unitPrice: 160, cost: 270 },
    ],
  },
  {
    id: "QT-3003", status: "Sent", agent: "Sara K.", created: "2026-11-12", updated: "2026-11-14", validUntil: "2026-11-28", sentAt: "2026-11-14",
    recipient: { kind: "lead", id: "LD-2052", name: "Arjun Kapoor", email: "arjun.kapoor@example.com", phone: "+91 98100 55533" },
    title: "Switzerland family summer", destination: "Lucerne & Interlaken", departDate: "2027-05-20", returnDate: "2027-06-01", adults: 2, children: 2,
    discount: 400, taxRate: 0,
    items: [
      { id: "i1", type: "Flight", description: "Return flights DEL → ZRH, economy", quantity: 4, unitPrice: 960, cost: 3_480 },
      { id: "i2", type: "Hotel", description: "12 nights, family rooms with breakfast (2 hotels)", quantity: 1, unitPrice: 8_200, cost: 7_150 },
      { id: "i3", type: "Transfer", description: "Swiss Travel Pass, 8 days (family)", quantity: 1, unitPrice: 2_180, cost: 1_960 },
      { id: "i4", type: "Activity", description: "Jungfraujoch excursion", quantity: 4, unitPrice: 240, cost: 860 },
      { id: "i5", type: "Visa", description: "Schengen visa assistance", quantity: 4, unitPrice: 95, cost: 240 },
    ],
  },
  {
    id: "QT-3002", status: "Sent", agent: "Priya N.", created: "2026-11-10", updated: "2026-11-17", validUntil: "2026-11-30", sentAt: "2026-11-17",
    recipient: { kind: "lead", id: "LD-2053", name: "Sophie Laurent", email: "sophie.laurent@example.com", phone: "+33 6 55 55 01 21" },
    title: "Bali escape — Seminyak resort", destination: "Bali, Indonesia", departDate: "2027-01-15", returnDate: "2027-01-29", adults: 2, children: 0,
    discount: 0, taxRate: 0,
    items: [
      { id: "i1", type: "Flight", description: "Return flights CDG → DPS via SIN, economy", quantity: 2, unitPrice: 1_240, cost: 2_250 },
      { id: "i2", type: "Hotel", description: "14 nights, Deluxe Pool Villa, breakfast", quantity: 1, unitPrice: 3_650, cost: 3_120 },
      { id: "i3", type: "Transfer", description: "Private airport transfers", quantity: 1, unitPrice: 90, cost: 60 },
      { id: "i4", type: "Activity", description: "Ubud day tour with rice terraces", quantity: 2, unitPrice: 85, cost: 120 },
    ],
    notes: "Option 2 as discussed — upgrade to a beachfront villa available for +$420.",
  },
  {
    id: "QT-3001", status: "Accepted", agent: "Sara K.", created: "2026-10-02", updated: "2026-10-06", validUntil: "2026-10-16", sentAt: "2026-10-02", respondedAt: "2026-10-06",
    recipient: { kind: "customer", id: "CU-1001", name: "Amelia Hart", email: "amelia.hart@example.com", phone: "+44 7700 900123" },
    title: "Maldives anniversary", destination: "Maldives", departDate: "2026-11-14", returnDate: "2026-11-18", adults: 1, children: 0,
    discount: 0, taxRate: 0,
    items: [
      { id: "i1", type: "Flight", description: "Return flights LHR → MLE, business class", quantity: 1, unitPrice: 2_150, cost: 1_880 },
      { id: "i2", type: "Hotel", description: "4 nights, Overwater Villa, all-inclusive", quantity: 1, unitPrice: 1_080, cost: 920 },
      { id: "i3", type: "Transfer", description: "Speedboat transfer, return", quantity: 1, unitPrice: 250, cost: 190 },
    ],
  },
];
