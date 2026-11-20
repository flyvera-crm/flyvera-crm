import type { ContactMethod, CustomerTier, SeatPreference } from "@/types/crm";

// Choices offered by the customer forms. Edit these lists freely.

export const CUSTOMER_TIERS: { value: CustomerTier; hint: string }[] = [
  { value: "Standard", hint: "New or occasional" },
  { value: "Silver", hint: "Repeat traveller" },
  { value: "Gold", hint: "High value" },
  { value: "Platinum", hint: "VIP service" },
];

export const CONTACT_METHODS: ContactMethod[] = ["WhatsApp", "Email", "Phone"];

export const SEAT_PREFERENCES: SeatPreference[] = ["No preference", "Window", "Aisle", "Extra legroom"];

// Demo agents — later this will come from the Team module.
export const AGENTS = ["Sara K.", "Daniel R.", "Priya N."];

// Suggestions for the country / nationality boxes (any value can still be typed).
export const COUNTRIES = [
  "Argentina", "Australia", "Austria", "Bahrain", "Bangladesh", "Belgium", "Brazil", "Canada", "Chile", "China",
  "Colombia", "Czechia", "Denmark", "Egypt", "Finland", "France", "Germany", "Ghana", "Greece", "Hong Kong",
  "India", "Indonesia", "Ireland", "Israel", "Italy", "Japan", "Jordan", "Kenya", "Kuwait", "Lebanon",
  "Malaysia", "Maldives", "Mexico", "Morocco", "Netherlands", "New Zealand", "Nigeria", "Norway", "Oman",
  "Pakistan", "Philippines", "Poland", "Portugal", "Qatar", "Saudi Arabia", "Singapore", "South Africa",
  "South Korea", "Spain", "Sri Lanka", "Sweden", "Switzerland", "Thailand", "Turkey", "UAE", "United Kingdom",
  "United States", "Vietnam",
];
