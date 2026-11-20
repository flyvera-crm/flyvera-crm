// ⚠️ DEMO DATA ONLY — replace with a database/API call later.
// Customers (CU-…) and quotations (QT-…) match the other demo data. "Today" ≈ 20 Nov 2026.
import type { Booking } from "@/types/crm";

export const bookings: Booking[] = [
  {
    id: "FV-10483", status: "Confirmed", agent: "Sara K.", created: "2026-11-10", updated: "2026-11-10",
    customerId: "CU-1013", customerName: "Isabella García", customerPhone: "+34 91 555 0148", customerEmail: "isabella.garcia@example.com",
    title: "Maldives winter escape", destination: "Maldives", departDate: "2027-01-10", returnDate: "2027-01-17", adults: 2, children: 0,
    discount: 0, taxRate: 0, depositDue: "2026-11-17", balanceDue: "2026-12-11",
    services: [
      { id: "i1", type: "Flight", description: "Return flights MAD → MLE via DOH, economy", quantity: 2, unitPrice: 1_450, cost: 2_640, ref: "QR8KD2", supplierPaidOn: "2026-11-11" },
      { id: "i2", type: "Hotel", description: "7 nights, Beach Villa with pool, half board", quantity: 1, unitPrice: 7_800, cost: 6_780, ref: "SUN-448210" },
      { id: "i3", type: "Transfer", description: "Return seaplane transfer", quantity: 2, unitPrice: 600, cost: 1_060 },
    ],
    payments: [{ id: "p1", date: "2026-11-10", amount: 3_570, method: "Card", note: "30% deposit" }],
    history: [
      { date: "2026-11-10", text: "Booking created" },
      { date: "2026-11-10", text: "Deposit of $3,570 received (Card)" },
      { date: "2026-11-10", text: "Booking confirmed" },
    ],
  },
  {
    id: "FV-10482", status: "Completed", agent: "Sara K.", created: "2026-10-06", updated: "2026-11-19", quoteId: "QT-3001",
    customerId: "CU-1001", customerName: "Amelia Hart", customerPhone: "+44 7700 900123", customerEmail: "amelia.hart@example.com",
    title: "Maldives anniversary", destination: "Maldives", departDate: "2026-11-14", returnDate: "2026-11-18", adults: 1, children: 0,
    discount: 0, taxRate: 0, depositDue: "2026-10-13", balanceDue: "2026-10-15",
    services: [
      { id: "i1", type: "Flight", description: "Return flights LHR → MLE, business class", quantity: 1, unitPrice: 2_150, cost: 1_880, ref: "BA5TQX", supplierPaidOn: "2026-10-08" },
      { id: "i2", type: "Hotel", description: "4 nights, Overwater Villa, all-inclusive", quantity: 1, unitPrice: 1_080, cost: 920, ref: "OWV-90311", supplierPaidOn: "2026-10-08" },
      { id: "i3", type: "Transfer", description: "Speedboat transfer, return", quantity: 1, unitPrice: 250, cost: 190, ref: "SB-2214", supplierPaidOn: "2026-10-08" },
    ],
    payments: [{ id: "p1", date: "2026-10-06", amount: 3_480, method: "Card", note: "Paid in full" }],
    history: [
      { date: "2026-10-06", text: "Booking created from QT-3001" },
      { date: "2026-10-06", text: "Payment of $3,480 received (Card)" },
      { date: "2026-10-07", text: "Booking confirmed" },
      { date: "2026-10-20", text: "Tickets and vouchers issued" },
      { date: "2026-11-19", text: "Trip completed" },
    ],
  },
  {
    id: "FV-10481", status: "Confirmed", agent: "Daniel R.", created: "2026-10-22", updated: "2026-10-25",
    customerId: "CU-1002", customerName: "Omar Siddiqui", customerPhone: "+1 212 555 0147", customerEmail: "omar.s@example.com",
    title: "Dubai long weekend", destination: "Dubai, UAE", departDate: "2026-11-28", returnDate: "2026-12-03", adults: 2, children: 0,
    discount: 0, taxRate: 0, depositDue: "2026-10-29", balanceDue: "2026-11-14",
    services: [
      { id: "i1", type: "Flight", description: "Return flights JFK → DXB, economy", quantity: 2, unitPrice: 980, cost: 1_780, ref: "EK7Q2M", supplierPaidOn: "2026-10-26" },
      { id: "i2", type: "Hotel", description: "5 nights, Downtown hotel, breakfast", quantity: 1, unitPrice: 1_050, cost: 890, ref: "ADD-55190" },
      { id: "i3", type: "Activity", description: "Desert safari with BBQ dinner", quantity: 2, unitPrice: 70, cost: 100 },
    ],
    payments: [{ id: "p1", date: "2026-10-25", amount: 950, method: "Bank transfer", note: "Deposit" }],
    history: [
      { date: "2026-10-22", text: "Booking created" },
      { date: "2026-10-25", text: "Deposit of $950 received (Bank transfer)" },
      { date: "2026-10-25", text: "Booking confirmed" },
    ],
  },
  {
    id: "FV-10480", status: "Pending", agent: "Sara K.", created: "2026-11-15", updated: "2026-11-15",
    customerId: "CU-1003", customerName: "Lena Fischer", customerPhone: "+49 30 901820", customerEmail: "lena.fischer@example.com",
    title: "Bangkok & islands", destination: "Bangkok, Thailand", departDate: "2026-12-12", returnDate: "2026-12-24", adults: 1, children: 0,
    discount: 0, taxRate: 0, depositDue: "2026-11-22", balanceDue: "2026-11-28",
    services: [
      { id: "i1", type: "Flight", description: "Return flights FRA → BKK, economy", quantity: 1, unitPrice: 1_180, cost: 1_040 },
      { id: "i2", type: "Hotel", description: "11 nights split Bangkok / Koh Samui, breakfast", quantity: 1, unitPrice: 1_420, cost: 1_190 },
      { id: "i3", type: "Insurance", description: "Comprehensive travel insurance", quantity: 1, unitPrice: 180, cost: 120 },
    ],
    payments: [],
    history: [{ date: "2026-11-15", text: "Booking created — awaiting deposit" }],
  },
  {
    id: "FV-10479", status: "Ticketed", agent: "Priya N.", created: "2026-10-12", updated: "2026-11-02", quoteId: "QT-3007",
    customerId: "CU-1004", customerName: "Carlos Mendes", customerPhone: "+55 11 5555 0199", customerEmail: "carlos.mendes@example.com",
    title: "Paris city break", destination: "Paris, France", departDate: "2026-12-01", returnDate: "2026-12-08", adults: 2, children: 0,
    discount: 0, taxRate: 0, depositDue: "2026-10-19", balanceDue: "2026-11-01",
    services: [
      { id: "i1", type: "Flight", description: "Return flights GRU → CDG, economy", quantity: 2, unitPrice: 1_150, cost: 2_040, ref: "AF3LKP", supplierPaidOn: "2026-11-02" },
      { id: "i2", type: "Hotel", description: "7 nights, boutique hotel in Le Marais, breakfast", quantity: 1, unitPrice: 2_380, cost: 2_050, ref: "MRS-77812", supplierPaidOn: "2026-11-02" },
      { id: "i3", type: "Activity", description: "Seine dinner cruise", quantity: 2, unitPrice: 140, cost: 230, ref: "BM-61902", supplierPaidOn: "2026-11-02" },
    ],
    payments: [
      { id: "p1", date: "2026-10-12", amount: 1_500, method: "Card", note: "Deposit" },
      { id: "p2", date: "2026-11-01", amount: 3_460, method: "Bank transfer", note: "Balance" },
    ],
    history: [
      { date: "2026-10-12", text: "Booking created from QT-3007" },
      { date: "2026-10-12", text: "Deposit of $1,500 received (Card)" },
      { date: "2026-10-12", text: "Booking confirmed" },
      { date: "2026-11-01", text: "Balance of $3,460 received (Bank transfer)" },
      { date: "2026-11-02", text: "Tickets and vouchers issued" },
    ],
  },
  {
    id: "FV-10478", status: "Ticketed", agent: "Daniel R.", created: "2026-10-22", updated: "2026-11-05",
    customerId: "CU-1005", customerName: "Grace Liu", customerPhone: "+65 6555 0134", customerEmail: "grace.liu@example.com",
    title: "London business trip", destination: "London, UK", departDate: "2026-11-18", returnDate: "2026-11-25", adults: 1, children: 0,
    discount: 0, taxRate: 0, depositDue: "2026-10-29", balanceDue: "2026-10-29",
    services: [
      { id: "i1", type: "Flight", description: "Return flights SIN → LHR, business class", quantity: 1, unitPrice: 4_200, cost: 3_760, ref: "SQ9WRT", supplierPaidOn: "2026-10-24" },
      { id: "i2", type: "Hotel", description: "7 nights, Mayfair hotel, room only", quantity: 1, unitPrice: 1_950, cost: 1_690, ref: "MYF-31877", supplierPaidOn: "2026-10-24" },
      { id: "i3", type: "Transfer", description: "Chauffeur airport transfers", quantity: 1, unitPrice: 160, cost: 120, ref: "LC-4410", supplierPaidOn: "2026-10-24" },
    ],
    payments: [{ id: "p1", date: "2026-10-23", amount: 6_310, method: "Card", note: "Corporate card" }],
    history: [
      { date: "2026-10-22", text: "Booking created" },
      { date: "2026-10-23", text: "Payment of $6,310 received (Card)" },
      { date: "2026-10-23", text: "Booking confirmed" },
      { date: "2026-11-05", text: "Tickets and vouchers issued" },
    ],
  },
  {
    id: "FV-10477", status: "Cancelled", agent: "Priya N.", created: "2026-10-30", updated: "2026-11-09",
    customerId: "CU-1006", customerName: "Noah Bennett", customerPhone: "+1 310 555 0181", customerEmail: "noah.bennett@example.com",
    title: "Thanksgiving in New York", destination: "New York, USA", departDate: "2026-11-23", returnDate: "2026-11-27", adults: 2, children: 0,
    discount: 0, taxRate: 0, depositDue: "2026-11-06", balanceDue: "2026-11-10",
    services: [
      { id: "i1", type: "Flight", description: "Return flights LAX → JFK, economy", quantity: 2, unitPrice: 520, cost: 920 },
      { id: "i2", type: "Hotel", description: "4 nights, Times Square hotel", quantity: 1, unitPrice: 200, cost: 170 },
    ],
    payments: [{ id: "p1", date: "2026-11-02", amount: 300, method: "Card", note: "Deposit (non-refundable)" }],
    cancelReason: "Customer's plans changed",
    history: [
      { date: "2026-10-30", text: "Booking created" },
      { date: "2026-11-02", text: "Deposit of $300 received (Card)" },
      { date: "2026-11-09", text: "Booking cancelled — Customer's plans changed" },
    ],
  },
  {
    id: "FV-10476", status: "Ticketed", agent: "Daniel R.", created: "2026-09-28", updated: "2026-11-03",
    customerId: "CU-1008", customerName: "Rahul Mehta", customerPhone: "+91 98200 55501", customerEmail: "rahul.mehta@example.com",
    title: "New York family holiday", destination: "New York, USA", departDate: "2026-11-19", returnDate: "2026-11-27", adults: 2, children: 2,
    discount: 0, taxRate: 0, depositDue: "2026-10-05", balanceDue: "2026-10-20",
    services: [
      { id: "i1", type: "Flight", description: "Return flights BOM → JFK, economy", quantity: 4, unitPrice: 1_050, cost: 3_760, ref: "AI4MNB", supplierPaidOn: "2026-10-20" },
      { id: "i2", type: "Hotel", description: "8 nights, family suite near Central Park", quantity: 1, unitPrice: 3_600, cost: 3_120, ref: "CPK-20934", supplierPaidOn: "2026-10-20" },
      { id: "i3", type: "Activity", description: "Broadway show tickets (Lion King)", quantity: 4, unitPrice: 160, cost: 560, ref: "BWY-88123", supplierPaidOn: "2026-10-20" },
    ],
    payments: [
      { id: "p1", date: "2026-09-30", amount: 2_500, method: "Bank transfer", note: "Deposit" },
      { id: "p2", date: "2026-10-18", amount: 5_940, method: "Bank transfer", note: "Balance" },
    ],
    history: [
      { date: "2026-09-28", text: "Booking created" },
      { date: "2026-09-30", text: "Deposit of $2,500 received (Bank transfer)" },
      { date: "2026-09-30", text: "Booking confirmed" },
      { date: "2026-10-18", text: "Balance of $5,940 received (Bank transfer)" },
      { date: "2026-11-03", text: "Tickets and vouchers issued" },
    ],
  },
];
