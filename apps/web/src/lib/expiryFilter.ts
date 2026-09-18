import { formatExpiry } from "@ib/ledger";
import { IB_REPORT_TIME_ZONE } from "@ib/ib-parsers";

/** How many expiry buttons the Positions page offers: enough to hold one line. */
export const MAX_EXPIRY_BUTTONS = 6;

export interface ExpiryChoice {
  /** `YYYY-MM-DD`, as a position carries it. */
  expiry: string;
  /** `Oct16'26`: the very text the Position column holds, so it doubles as the criterion. */
  label: string;
}

const DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: IB_REPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Today as IB counts it, `YYYY-MM-DD`. An expiry belongs to the market's calendar, so the day the
 * browser sits in — hours ahead in Europe — would retire an expiry while it is still trading.
 */
export function reportToday(now: Date = new Date()): string {
  return DAY_FORMATTER.format(now);
}

/**
 * The expiries worth a button: those of the options given, from `today` on, nearest first, capped
 * at MAX_EXPIRY_BUTTONS. Anything without an expiry — shares — never shows up.
 */
export function expiryChoices(positions: readonly { expiry: string | null }[], today: string): ExpiryChoice[] {
  const expiries = new Set<string>();
  for (const position of positions) {
    if (position.expiry !== null && position.expiry >= today) expiries.add(position.expiry);
  }
  return [...expiries]
    .sort()
    .slice(0, MAX_EXPIRY_BUTTONS)
    .map((expiry) => ({ expiry, label: formatExpiry(expiry) }));
}
