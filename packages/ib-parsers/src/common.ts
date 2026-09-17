/** Raised on a value the parser cannot read; the whole import is cancelled. */
export class NormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NormalizationError";
  }
}

/** Attribute value, or `null` when the attribute is absent (an empty attribute is ""). */
export function attr(el: Element, name: string): string | null {
  return el.hasAttribute(name) ? el.getAttribute(name) : null;
}

/**
 * IB numbers: "1,200.00", "-1.94", "&nbsp;" for a blank cell. A blank is
 * unknown, never zero.
 */
export function parseNumber(text: string | null | undefined, what: string): number | null {
  if (text === null || text === undefined) return null;
  const cleaned = text.replace(/[,\s]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) throw new NormalizationError(`Unreadable number "${text}" for ${what}`);
  return value;
}

function toIso(what: string, y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): string {
  const date = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
  if (Number.isNaN(date.getTime()) || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new NormalizationError(`Unreadable date for ${what}`);
  }
  return date.toISOString();
}

// Every IB time in the ledger is New York's wall clock stamped as UTC. Flex and statement
// files carry that wall clock without a zone and are stamped without conversion (`toIso`);
// the agent reports true UTC instants, brought to the same clock by `toReportTime`. One
// clock is what lets `planImport` compare days across sources and the journals compare a
// snapshot's `asOf` with the transactions' `when`.
export const IB_REPORT_TIME_ZONE = "America/New_York";

const REPORT_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: IB_REPORT_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** A true instant ("2026-09-16T02:13:46Z") to New York's wall clock stamped UTC ("2026-09-15T22:13:46.000Z"). */
export function toReportTime(instant: string): string {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) throw new NormalizationError(`Unreadable instant "${instant}"`);
  const parts = Object.fromEntries(REPORT_CLOCK.formatToParts(at).map((part) => [part.type, part.value]));
  return new Date(
    Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second, at.getUTCMilliseconds()),
  ).toISOString();
}

/** Flex "20260814;162000" or "20260814" (midnight). */
export function parseFlexDateTime(text: string | null | undefined, what: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})(?:;(\d{2})(\d{2})(\d{2}))?$/.exec(text ?? "");
  if (!match) throw new NormalizationError(`Unreadable Flex date "${text}" for ${what}`);
  const [, y, m, d, hh, mm, ss] = match;
  return toIso(what, +y, +m, +d, +(hh ?? 0), +(mm ?? 0), +(ss ?? 0));
}

/** Flex "20260220" -> "2026-02-20"; blank -> null. */
export function flexDateToIsoDay(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (!match) throw new NormalizationError(`Unreadable Flex day "${text}"`);
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** Statement "2025-01-02, 09:30:00" or "2025-01-02" (midnight). */
export function parseStatementDateTime(text: string | null | undefined, what: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:,\s*(\d{2}):(\d{2}):(\d{2}))?$/.exec((text ?? "").trim());
  if (!match) throw new NormalizationError(`Unreadable statement date "${text}" for ${what}`);
  const [, y, m, d, hh, mm, ss] = match;
  return toIso(what, +y, +m, +d, +(hh ?? 0), +(mm ?? 0), +(ss ?? 0));
}

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

const OPTION_SYMBOL_RE =
  /^(?<symbol>\S+)\s+(?<day>\d{2})(?<month>[A-Z]{3})(?<year>\d{2})\s+(?<strike>[\d.]+)\s+(?<right>[CP])$/;

export interface OptionParts {
  symbol: string;
  expiry: string | null;
  strike: number | null;
  right: "C" | "P" | "";
}

/** "AANZ 26SEP25 24 P" -> { AANZ, 2025-09-26, 24, P }; a plain stock passes through. */
export function splitOptionSymbol(text: string): OptionParts {
  const match = OPTION_SYMBOL_RE.exec(text.trim());
  if (!match?.groups) return { symbol: text.trim(), expiry: null, strike: null, right: "" };
  const { symbol, day, month, year, strike, right } = match.groups;
  const monthNumber = MONTHS[month];
  if (!monthNumber) return { symbol: text.trim(), expiry: null, strike: null, right: "" };
  const expiry = `20${year}-${String(monthNumber).padStart(2, "0")}-${day}`;
  return { symbol, expiry, strike: Number(strike), right: right as "C" | "P" };
}

/** "TESTX(US0000000000) Cash Dividend…" -> "TESTX"; "" when there is no leading ticker. */
export function symbolFromDescription(description: string): string {
  const match = /^([A-Za-z0-9.]+)\s*\(/.exec(description);
  return match ? match[1] : "";
}

/** One leg of a corporate action: the ticker and ISIN the row actually concerns. */
export interface CorporateActionLeg {
  ticker: string;
  isin: string;
}

/**
 * A statement's corporate action description names the *event* first and the
 * *leg* last: "ZXAJ(...) CUSIP/ISIN Change to (...) (ZXAH, EXAMPLE AUTOMATION
 * INC, US...)". Both rows of one event share the prefix and differ only by
 * this trailing "(TICKER, NAME, ISIN)" triple, so the prefix pairs them
 * (journals/corporate.ts) and the triple tells each row what it holds.
 *
 * `null` when there is no triple to read: the caller falls back on the
 * prefix, which is what the parser did for every row before.
 */
export function legFromDescription(description: string): CorporateActionLeg | null {
  const match = /\(([^()]+)\)\s*$/.exec(description.trim());
  if (!match) return null;
  const parts = match[1].split(",").map((part) => part.trim());
  if (parts.length < 2) return null;
  const ticker = parts[0];
  const isin = parts[parts.length - 1];
  if (!/^[A-Za-z0-9.]+$/.test(ticker)) return null;
  return { ticker, isin };
}
