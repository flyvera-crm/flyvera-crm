// Supabase connection settings, read from .env.local (never committed).
// Both values are safe to ship to the browser: the publishable key only
// allows what the database's Row Level Security policies allow.
//
// The names must be written out in full (process.env.NEXT_PUBLIC_…) so
// Next.js can inline them into the browser bundle.

export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Create .env.local in the project root with NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, then restart `npm run dev`.",
    );
  }
  return { url, key };
}
