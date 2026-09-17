import type { Position, Transaction } from "../types.ts";

/** What identifies a contract across sources; `secType` is "STK" or "OPT" here. */
export interface ContractKey {
  ticker: string;
  secType: string;
  right: "C" | "P" | "";
  strike: number | null;
  /** YYYY-MM-DD */
  expiry: string | null;
  currency: string;
}

/**
 * Fixed-width OSI option symbol: 6-character root (space-padded on the
 * right), 6-digit expiry, `C`/`P`, 8-digit strike. A root shorter than 6
 * characters leaves a separating space the naive first-token split can use;
 * a root that is exactly 6 characters long leaves none, so it must be
 * recognised by this fixed layout instead.
 */
const OSI_SYMBOL = /^.{6}\d{6}[CP]\d{8}$/;

/**
 * Flex packs the OCC symbol into an option trade's `symbol`
 * ("SYMB  260320P00020000"); statements and the agent give the underlying.
 * The first token is the underlying in every case, except a packed symbol
 * whose 6-character root has no padding space to split on.
 */
export function tickerOf(symbol: string): string {
  const trimmed = symbol.trim();
  if (OSI_SYMBOL.test(trimmed)) return trimmed.slice(0, 6).trim();
  return trimmed.split(/\s+/)[0] ?? "";
}

/**
 * True of a spelling that names an option contract itself, not the stock it
 * is written on: only the packed OSI form does. TWS names an option by its
 * underlying, so this is what tells an option's own alias from the ticker of
 * every other option on the same stock (`identities.ts`, rule 7).
 */
export function isPackedOptionSymbol(symbol: string): boolean {
  return OSI_SYMBOL.test(symbol.trim());
}

/** An OSI root: up to six letters or digits, nothing else. */
const OSI_ROOT = /^[A-Za-z0-9]{1,6}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The packed OSI spelling of an option described the way a statement or the
 * agent describes it — its underlying in `symbol`, its terms in their own
 * fields — or `null` when the description cannot produce one.
 *
 * Rebuilding a name is not inventing an alias: the identity table is still
 * fed by the sources alone (spec §3.1). This only gives the engine the key
 * those sources never write.
 */
export function packedOptionSymbol(
  ticker: string,
  expiry: string | null,
  right: "C" | "P" | "",
  strike: number | null,
): string | null {
  const root = ticker.trim();
  if (!OSI_ROOT.test(root)) return null;
  if (right !== "C" && right !== "P") return null;
  if (expiry === null || !ISO_DAY.test(expiry)) return null;
  if (strike === null || !Number.isFinite(strike) || strike <= 0) return null;
  const thousandths = Math.round(strike * 1000);
  // A strike finer than a thousandth has no OSI spelling; rounding it would
  // name another contract.
  if (Math.abs(strike * 1000 - thousandths) > 1e-6 || thousandths > 99_999_999) return null;
  const [year, month, day] = expiry.split("-");
  return `${root.padEnd(6, " ")}${year.slice(2)}${month}${day}${right}${String(thousandths).padStart(8, "0")}`;
}

/**
 * Everything a packed spelling says after its root: expiry, right and
 * strike. Unguarded: it assumes `symbol` is already a packed OSI spelling
 * and merely slices off the first six characters, so every caller must
 * establish that itself — `isPackedOptionSymbol` first, or a value already
 * known to be packed.
 */
export function optionTerms(symbol: string): string {
  return symbol.slice(6);
}

/** "TSTC  270115C00002500" -> "2027-01-15"; `null` when the spelling is not packed. */
export function expiryOfPacked(symbol: string): string | null {
  if (!isPackedOptionSymbol(symbol)) return null;
  const terms = optionTerms(symbol);
  return `20${terms.slice(0, 2)}-${terms.slice(2, 4)}-${terms.slice(4, 6)}`;
}

/** The same option terms under another root; `null` when either side has no OSI form. */
export function respellPackedOption(symbol: string, root: string): string | null {
  const trimmed = root.trim();
  if (!isPackedOptionSymbol(symbol) || !OSI_ROOT.test(trimmed)) return null;
  return `${trimmed.padEnd(6, " ")}${optionTerms(symbol)}`;
}

type ContractSource = Pick<Transaction | Position, "symbol" | "secType" | "right" | "strike" | "expiry" | "currency">;

export function contractOf(source: ContractSource): ContractKey {
  return {
    ticker: tickerOf(source.symbol),
    secType: source.secType,
    right: source.right,
    strike: source.strike,
    expiry: source.expiry,
    currency: source.currency,
  };
}

export function sharesContract(ticker: string, currency: string): ContractKey {
  return { ticker, secType: "STK", right: "", strike: null, expiry: null, currency };
}

export function contractId(key: ContractKey): string {
  return [key.ticker, key.secType, key.right, key.strike ?? "", key.expiry ?? "", key.currency].join("|");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-02" -> "Oct02'26" */
export function formatExpiry(expiry: string): string {
  const [year, month, day] = expiry.split("-");
  return `${MONTHS[Number(month) - 1]}${day}'${year.slice(2)}`;
}

/** 17 -> "17", 17.5 -> "17.5": Number's own spelling drops trailing zeros. */
export function formatStrike(strike: number): string {
  return String(strike);
}

/** English whatever the language, as the positions are. */
export function formatContractLabel(key: ContractKey): string {
  if (key.secType !== "OPT" || key.expiry === null || key.strike === null || key.right === "") return key.ticker;
  return `${key.ticker} ${formatExpiry(key.expiry)} ${formatStrike(key.strike)} ${key.right === "C" ? "Call" : "Put"}`;
}

export function formatCondorLabel(ticker: string, expiry: string, strikes: readonly number[]): string {
  return `${ticker} ${formatExpiry(expiry)} IC ${strikes.map(formatStrike).join("/")}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** True when `expiry` falls on or after `day` plus `months` calendar months, the day clamped to the target month's length. */
export function isAtLeastMonthsAway(day: string, expiry: string, months: number): boolean {
  const [y, m, d] = day.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const threshold = `${targetYear}-${pad(targetMonth)}-${pad(Math.min(d, lastDay))}`;
  return expiry >= threshold;
}
