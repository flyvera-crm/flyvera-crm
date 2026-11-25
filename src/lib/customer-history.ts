// Date helper shared by bookings, payments and quotations.
// (The generated demo trip history that used to live here has been removed:
// customer profiles now show their real bookings from the database.)

export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
