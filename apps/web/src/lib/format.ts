import { formatContractLabel, tickerOf } from "@ib/ledger";

const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatMoney(value: number | null): string {
  return value === null ? "—" : USD_FORMATTER.format(value);
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

const RATE_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** A return: one decimal, where `formatPercent` rounds a gauge to the whole percent. */
export function formatRate(ratio: number): string {
  return RATE_FORMATTER.format(ratio);
}

const DAY_CHANGE_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

/**
 * The day's move of a position: one decimal and always its sign, so a column of them reads at a
 * glance. `formatRate` is the return of a month and never signs a gain. Measured rather than
 * guessed: `signDisplay: "exceptZero"` never signs zero — `-0.0004` also formats "0.0%" rather
 * than the misleading "-0.0%" — so zero reads unsigned here too.
 */
export function formatDayChange(ratio: number | null): string {
  return ratio === null ? "—" : DAY_CHANGE_FORMATTER.format(ratio);
}

// The history table carries its own currency column, so its money cells are
// formatted as bare numbers: a "$" glued to a EUR row would be a lie.
const AMOUNT_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatAmount(value: number): string {
  return AMOUNT_FORMATTER.format(value);
}

const PRICE_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

export function formatPrice(value: number | null): string {
  return value === null ? "—" : PRICE_FORMATTER.format(value);
}

// Every timestamp in the application reads "2026-08-24 15:55:58": ISO day, a space, a 24-hour
// clock with its seconds. No locale enters into it, so a row reads the same in fr and in en, and
// it sorts as it displays. The zone stays UTC: every IB time — Flex, statements, and the
// agent's after `toReportTime` — is New York's wall clock stamped UTC (see ib-parsers'
// common.ts), so converting here would move them.
export function formatDateTime(isoString: string): string {
  const at = new Date(isoString);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toISOString().slice(0, 19).replace("T", " ");
}

/** A snapshot's `asOf`: a file's day as is, an agent's instant to the second. */
export function formatSnapshotDate(asOf: string): string {
  return asOf.length === 10 ? asOf : formatDateTime(asOf);
}

/** A timeline month key, "2024-03", in the reader's language: "mars 2024", "March 2024". UTC, like the key. */
export function formatMonth(month: string, locale: string): string {
  const [year, index] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, index - 1, 1)),
  );
}

export function formatPeriod(period: { start: string; end: string } | null): string {
  if (!period) return "—";
  return period.start === period.end ? period.start : `${period.start} → ${period.end}`;
}

// Unlike every other formatter here, this one is in the *viewer's* zone: it reads an app
// instant, the true UTC time of the last agent pass (`lastAgentSyncAt`), and "live, 15:02"
// must read as the clock on the wall. IB times are New York's wall clock stamped UTC and are
// shown by `formatDateTime`.
const CLOCK_FORMATTER = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function formatClockTime(isoString: string): string {
  return CLOCK_FORMATTER.format(new Date(isoString));
}

/**
 * The journals' spelling of a contract — "OQZA Oct16'26 12 Call" — from anything that
 * carries the option fields: a `Transaction`, a `Position`, an `AnalyzedPosition`. The
 * formatter itself lives in `@ib/ledger` so the three pages spell a contract identically.
 *
 * `AnalyzedPosition` flattens "no expiry" to "" and "no strike" to 0; both sentinels come
 * back to a missing expiry here, which is what makes the shared formatter fall back to the
 * bare ticker. A row with no security at all (a deposit, a fee) yields "": the caller
 * decides what to show instead.
 */
export function formatContract(source: {
  symbol: string;
  secType: string;
  right: string;
  strike: number | null;
  expiry: string | null;
}): string {
  return formatContractLabel({
    ticker: tickerOf(source.symbol),
    secType: source.secType,
    right: source.right === "C" || source.right === "P" ? source.right : "",
    strike: source.strike,
    expiry: source.expiry || null,
    currency: "",
  });
}

const BYTES = new TextEncoder();

/** UTF-8 weight of a text. Measured once at write time, never on a render. */
export function byteLength(text: string): number {
  return BYTES.encode(text).length;
}

/** The weight of a kept statement, so the user can see what this browser is holding. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
