import { dayOf } from "./filter.ts";
import { sortTransactions } from "./order.ts";
import type { Transaction } from "./types.ts";

/** A currency conversion is recognised by its symbol, never by `secType`. */
export const CURRENCY_PAIR_RE = /^[A-Z]{3}\.[A-Z]{3}$/;

export function isCurrencyPair(symbol: string): boolean {
  return CURRENCY_PAIR_RE.test(symbol);
}

/** "EUR.USD" -> "EUR": the currency `quantity` and `commission` are denominated in. */
export function baseCurrencyOf(pairSymbol: string): string {
  return pairSymbol.slice(0, 3);
}

/**
 * Signed impact of one row on the balance of its `currency`. Broker signs
 * need no handling: proceeds are negative on a buy, commissions are always
 * negative, a withdrawal is negative. On a conversion the commission is
 * charged in the base currency, so it is left out here and counted by
 * `runningBalances` on the base side instead.
 */
export function cashImpact(tx: Transaction): number | null {
  if (tx.amount === null) return null;
  if (isCurrencyPair(tx.symbol)) return tx.amount;
  return tx.amount + (tx.commission ?? 0);
}

export interface LedgerRow {
  transaction: Transaction;
  /** This row's own impact, `null` when unknown. */
  cash: number | null;
  /** Balance of each requested currency once this row has settled. */
  balances: Record<string, number>;
}

/**
 * Running balances over the whole ledger of one account, in reference
 * order. Always feed it every transaction of the account, never a filtered
 * page: a balance is only meaningful from the oldest row on record.
 */
export function runningBalances(
  transactions: readonly Transaction[],
  currencies: readonly string[],
): LedgerRow[] {
  const totals: Record<string, number> = {};
  for (const currency of currencies) totals[currency] = 0;
  const add = (currency: string, value: number) => {
    if (currency in totals) totals[currency] += value;
  };

  return sortTransactions(transactions).map((transaction) => {
    const cash = cashImpact(transaction);
    if (cash !== null) add(transaction.currency, cash);
    if (isCurrencyPair(transaction.symbol)) {
      // `?? 0`, not left as `null`: a running total is always a number, and
      // there is no "unknown balance" to represent downstream. Consistent
      // with the design (§ "Unknown is never zero" is about a *field*, not
      // a *running total*): an unknown base amount contributes nothing to
      // this one balance rather than making every later row's balance
      // unknown too.
      add(
        baseCurrencyOf(transaction.symbol),
        (transaction.quantity ?? 0) + (transaction.commission ?? 0),
      );
    }
    return { transaction, cash, balances: { ...totals } };
  });
}

/**
 * Largest gap, in the currency itself, still read as "the history comes back to the Starting
 * Cash". HTML statements round every amount to the cent, and a year of them was measured drifting
 * by up to 0.13; Flex amounts are exact. Set to 10 so that a small residual gap, below what a
 * missing transaction would leave, still reads as consistent. Defined here only.
 */
export const CASH_CHECK_TOLERANCE = 10;

/** One point of a Cash Report: Starting Cash at the start of a file's period, Ending Cash at its end. */
export interface CashPoint {
  currency: string;
  kind: "start" | "end";
  /** YYYY-MM-DD */
  asOf: string;
  amount: number;
}

export interface CashCheck {
  currency: string;
  /** Added to every raw balance of this currency; 0 without an end point. */
  offset: number;
  end: { asOf: string; amount: number } | null;
  /** `balance` is the anchored balance at the close of the day before `asOf`; `gap` is rounded to the cent. */
  start: { asOf: string; amount: number; balance: number; gap: number } | null;
}

/** Raw balance of one currency after the last row whose day passes `accept`, rows in reference order. */
function rawBalanceUpTo(rows: readonly LedgerRow[], currency: string, accept: (day: string) => boolean): number {
  let balance = 0;
  for (const row of rows) {
    if (!accept(dayOf(row.transaction.when))) break;
    balance = row.balances[currency];
  }
  return balance;
}

/** Rounded to the cent; `+ 0` turns a rounded -0 into 0. */
function toCents(value: number): number {
  return Math.round(value * 100) / 100 + 0;
}

/**
 * Running balances anchored on the Cash Reports of the files: each currency is shifted so that
 * its balance at the close of the end point's day is that point's Ending Cash, then checked
 * against the start point's Starting Cash at the close of the day before it. A gap left over is
 * what the history misses or has too much of. Currencies without an end point stay raw.
 *
 * Pure: the points come from the caller, never from a store.
 */
export function anchoredBalances(
  transactions: readonly Transaction[],
  currencies: readonly string[],
  points: readonly CashPoint[],
): { rows: LedgerRow[]; checks: CashCheck[] } {
  const raw = runningBalances(transactions, currencies);
  const checks = currencies.map((currency): CashCheck => {
    const endPoint = points.find((point) => point.currency === currency && point.kind === "end");
    const startPoint = points.find((point) => point.currency === currency && point.kind === "start");
    const offset = endPoint ? endPoint.amount - rawBalanceUpTo(raw, currency, (day) => day <= endPoint.asOf) : 0;
    let start: CashCheck["start"] = null;
    if (startPoint) {
      const balance = rawBalanceUpTo(raw, currency, (day) => day < startPoint.asOf) + offset;
      start = { asOf: startPoint.asOf, amount: startPoint.amount, balance, gap: toCents(balance - startPoint.amount) };
    }
    return { currency, offset, end: endPoint ? { asOf: endPoint.asOf, amount: endPoint.amount } : null, start };
  });
  const offsets = new Map(checks.map((check) => [check.currency, check.offset]));
  const rows = raw.map((row) => ({
    ...row,
    balances: Object.fromEntries(Object.entries(row.balances).map(([currency, value]) => [currency, value + (offsets.get(currency) ?? 0)])),
  }));
  return { rows, checks };
}

/** `null` without a start point to check against; otherwise whether the gap stays within the tolerance. */
export function isCashCheckOk(check: CashCheck): boolean | null {
  if (check.start === null) return null;
  return Math.abs(check.start.gap) <= CASH_CHECK_TOLERANCE;
}
