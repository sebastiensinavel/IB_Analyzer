const NY_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

/** The New York calendar day (YYYY-MM-DD) of an instant, whatever the machine's time zone. */
export function nyDay(now: Date): string {
  return NY_DAY.format(now);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isWeekend(day: string): boolean {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/** The New York day of `now`, rolled back to Friday on a weekend. */
export function referenceDay(now: Date): string {
  let day = nyDay(now);
  while (isWeekend(day)) day = addDays(day, -1);
  return day;
}

/** The n-th market day before `reference` (n = 0 gives the reference itself). */
export function marketDaysBefore(reference: string, n: number): string {
  let day = reference;
  for (let left = n; left > 0; ) {
    day = addDays(day, -1);
    if (!isWeekend(day)) left -= 1;
  }
  return day;
}

export function fridayOnOrAfter(day: string): string {
  let d = day;
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 5) d = addDays(d, 1);
  return d;
}

export function calendarDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
