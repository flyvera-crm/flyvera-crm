// Temporary storage for customers you add or edit in the CRM.
// Saved in this browser's localStorage (survives refresh, not shared between devices).
// When a real backend exists, replace saveCustomer() / updateCustomer() with API calls.
import type { Customer } from "@/types/crm";

const KEY = "flyvera.customers.v2";
const LEGACY_KEY = "flyvera.addedCustomers.v1"; // older format: just the added list

export type StoredCustomers = {
  added: Customer[]; // brand-new customers, newest first
  edited: Record<string, Customer>; // edited versions of demo customers, by id
};

const EMPTY: StoredCustomers = { added: [], edited: {} };
const listeners = new Set<() => void>();
let cache: StoredCustomers | null = null;

function read(): StoredCustomers {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        added: Array.isArray(parsed?.added) ? parsed.added : [],
        edited: parsed?.edited && typeof parsed.edited === "object" ? parsed.edited : {},
      };
    }
    // Carry over customers saved by the previous version of the form.
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "[]");
    return { added: Array.isArray(legacy) ? legacy : [], edited: {} };
  } catch {
    return EMPTY;
  }
}

function write(next: StoredCustomers) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Storage full or blocked (e.g. private mode): keep it in memory for this visit.
  }
  listeners.forEach((l) => l());
}

export function getStoredCustomers(): StoredCustomers {
  if (cache === null) cache = read();
  return cache;
}

// The server has no localStorage, so it always renders the demo data only.
export function getServerStoredCustomers(): StoredCustomers {
  return EMPTY;
}

export function subscribeStoredCustomers(listener: () => void) {
  listeners.add(listener);
  // Keep multiple open tabs in sync.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function saveCustomer(customer: Customer) {
  const s = getStoredCustomers();
  write({ ...s, added: [customer, ...s.added] });
}

/** Saves changes to an existing customer (one you added, or a demo customer). */
export function updateCustomer(customer: Customer) {
  const s = getStoredCustomers();
  if (s.added.some((c) => c.id === customer.id)) {
    write({ ...s, added: s.added.map((c) => (c.id === customer.id ? customer : c)) });
  } else {
    write({ ...s, edited: { ...s.edited, [customer.id]: customer } });
  }
}

/** Removes everything you added or edited; the demo data comes back unchanged. */
export function clearStoredCustomers() {
  cache = EMPTY;
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}
