/** IB day (New York) of a `when` stamped UTC (see ib-parsers' common.ts). */
export function dayOf(when: string): string {
  return when.slice(0, 10);
}

const MARKET_DAY_START_HOUR = 4;

/**
 * The market day a `when` belongs to. IB books an expiration's assignments in the night that
 * follows it, stamped at the hour it got to them — 01:02 on a Saturday for the Friday 16:20
 * that Flex reports. Those hours are the previous session's business, so anything before
 * 04:00 (the pre-market open) counts as the day before, and a day that lands on a weekend
 * walks back to the Friday. No holiday calendar: a weekday holiday is not covered, and
 * nothing has ever needed it. No time-zone maths either — every ledger `when` is already New
 * York's wall clock stamped UTC (ib-parsers' `toReportTime`).
 */
export function marketDayOf(when: string): string {
  const at = new Date(`${dayOf(when)}T00:00:00.000Z`);
  if (Number(when.slice(11, 13)) < MARKET_DAY_START_HOUR) at.setUTCDate(at.getUTCDate() - 1);
  while (at.getUTCDay() === 0 || at.getUTCDay() === 6) at.setUTCDate(at.getUTCDate() - 1);
  return at.toISOString().slice(0, 10);
}
