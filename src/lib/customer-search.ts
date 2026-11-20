// Pure search helpers (no React), so they can also run on a server later.
import type { Customer } from "@/types/crm";

/** Lower-cases and strips accents ("São" → "sao") while keeping the string length. */
export function fold(text: string) {
  return Array.from(text, (ch) => ch.normalize("NFD")[0]).join("").toLowerCase();
}

/**
 * True when every word in the query appears somewhere in the customer
 * (name, email, ID, city, country, tier, status, destination, agent) —
 * so "gold london" finds Gold-tier customers in London.
 * Phone numbers match ignoring spaces and "+" once 3+ digits are typed.
 */
export function matchesSearch(c: Customer, query: string) {
  const q = fold(query.trim());
  if (!q) return true;
  const haystack = fold(
    [c.name, c.email, c.id, c.city, c.country, c.tier, c.status, c.favouriteDestination, c.agent].join(" "),
  );
  const wordsMatch = q.split(/\s+/).every((w) => haystack.includes(w));
  const digits = q.replace(/\D/g, "");
  const phoneMatch = digits.length >= 3 && c.phone.replace(/\D/g, "").includes(digits);
  return wordsMatch || phoneMatch;
}
