import { tx } from "../fixtures.ts";
import type { Transaction } from "../types.ts";

let next = 1;

export function resetIds(): void {
  next = 1;
}

function nextId(): string {
  return `flex:trade:${next++}`;
}

export interface OptionSpec {
  id?: string;
  ticker?: string;
  right: "C" | "P";
  strike: number;
  expiry: string;
  /** Signed like the broker: a sale is negative. */
  quantity: number;
  price: number;
  when: string;
  /** One dollar unless said otherwise; `null` is "unknown". */
  commission?: number | null;
  currency?: string;
}

/** An option trade priced per share, 100 shares per contract. */
export function option(spec: OptionSpec): Transaction {
  return tx({
    externalId: spec.id ?? nextId(),
    symbol: spec.ticker ?? "MQZA",
    secType: "OPT",
    right: spec.right,
    strike: spec.strike,
    expiry: spec.expiry,
    quantity: spec.quantity,
    price: spec.price,
    // `0`, never `-0`: a settlement leg's proceeds are plain zero.
    amount: spec.price === 0 ? 0 : -spec.quantity * spec.price * 100,
    commission: spec.commission === undefined ? -1 : spec.commission,
    currency: spec.currency ?? "USD",
    when: spec.when,
  });
}

export interface StockSpec {
  id?: string;
  ticker?: string;
  quantity: number;
  price: number;
  when: string;
  commission?: number | null;
  currency?: string;
}

export function stock(spec: StockSpec): Transaction {
  return tx({
    externalId: spec.id ?? nextId(),
    symbol: spec.ticker ?? "MQZA",
    secType: "STK",
    quantity: spec.quantity,
    price: spec.price,
    amount: -spec.quantity * spec.price,
    commission: spec.commission === undefined ? -1 : spec.commission,
    currency: spec.currency ?? "USD",
    when: spec.when,
  });
}

type SettlementLeg = Omit<OptionSpec, "price" | "when" | "commission"> & { when?: string };

/** The option leg of an expiry: `quantity` signed like the closing trade, price 0, no commission, 20:00 UTC on the expiry day. */
export function expire(spec: SettlementLeg): Transaction {
  return option({ ...spec, price: 0, commission: null, when: spec.when ?? `${spec.expiry}T20:00:00.000Z` });
}

/** An assignment or exercise: the option leg at price 0 plus the delivery at the strike, same instant, 100 shares per contract, uncharged. */
export function deliver(spec: SettlementLeg): [Transaction, Transaction] {
  const when = spec.when ?? `${spec.expiry}T20:00:00.000Z`;
  const leg = expire({ ...spec, when });
  const lotSign = -Math.sign(spec.quantity);
  const sign = (spec.right === "P" ? -1 : 1) * lotSign;
  const shares = stock({ ticker: spec.ticker, quantity: sign * Math.abs(spec.quantity) * 100, price: spec.strike, when, commission: 0, currency: spec.currency });
  return [leg, shares];
}

/** An OptionCashSettlement row: the cash of a cash-settled index option, no quantity, stamped at midnight like the statement does. */
export function settlement(spec: { id?: string; ticker: string; right: "C" | "P"; strike: number; expiry: string; amount: number; when: string }): Transaction {
  return tx({
    externalId: spec.id ?? `html:${next++}`,
    source: "statement_html",
    symbol: spec.ticker,
    secType: "OPT",
    right: spec.right,
    strike: spec.strike,
    expiry: spec.expiry,
    quantity: null,
    price: null,
    amount: spec.amount,
    commission: null,
    when: spec.when,
  });
}
