// Reusable browser storage for a list of records with an `id` (demo stand-in for a database).
// Keeps: records you created, and changed copies of the built-in demo records.
// Swap a collection for real API calls later without touching the UI.

export type Stored<T> = {
  added: T[]; // created in this browser, newest first
  edited: Record<string, T>; // changed versions of demo records, by id
};

export function createLocalCollection<T extends { id: string }>(storageKey: string) {
  const EMPTY: Stored<T> = { added: [], edited: {} };
  const listeners = new Set<() => void>();
  let cache: Stored<T> | null = null;

  function read(): Stored<T> {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      return {
        added: Array.isArray(parsed?.added) ? parsed.added : [],
        edited: parsed?.edited && typeof parsed.edited === "object" ? parsed.edited : {},
      };
    } catch {
      return EMPTY;
    }
  }

  function write(next: Stored<T>) {
    cache = next;
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Storage full or blocked (private mode): keep it in memory for this visit.
    }
    listeners.forEach((l) => l());
  }

  function getSnapshot(): Stored<T> {
    if (cache === null) cache = read();
    return cache;
  }

  return {
    /** For useSyncExternalStore (browser). */
    getSnapshot,
    /** For useSyncExternalStore (server): demo data only. */
    getServerSnapshot(): Stored<T> {
      return EMPTY;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      const onStorage = (e: StorageEvent) => {
        if (e.key === storageKey) {
          cache = null;
          listener();
        }
      };
      window.addEventListener("storage", onStorage); // keep open tabs in sync
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
      };
    },
    add(record: T) {
      const s = getSnapshot();
      write({ ...s, added: [record, ...s.added] });
    },
    update(record: T) {
      const s = getSnapshot();
      if (s.added.some((r) => r.id === record.id)) {
        write({ ...s, added: s.added.map((r) => (r.id === record.id ? record : r)) });
      } else {
        write({ ...s, edited: { ...s.edited, [record.id]: record } });
      }
    },
    clear() {
      cache = EMPTY;
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
      listeners.forEach((l) => l());
    },
    /** Demo records (with edits applied) plus records created in this browser. */
    merge(demo: T[], stored: Stored<T>): T[] {
      return [...stored.added, ...demo.map((r) => stored.edited[r.id] ?? r)];
    },
  };
}
