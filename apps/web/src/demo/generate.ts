import { DEFAULT_MULTIPLIER, dayOf, packedOptionSymbol, runningBalances, type Position, type Transaction } from "@ib/ledger";
import type { CashPointRecord } from "@/db/schema";
import { DEMO_ACCOUNT_ID } from "@/demo/mode";
import { addDays, calendarDaysBetween, fridayOnOrAfter, marketDaysBefore, referenceDay } from "@/demo/calendar";
import { MAX_AGO, VOLATILITY, closeAgo, optionMark } from "@/demo/prices";
import { DEMO_SCENARIO, type DemoEvent } from "@/demo/scenario";

export const DEMO_IB_ACCOUNT = "U0000000";
export const DEMO_CURRENCIES = ["USD", "EUR"] as const;
const OPTION_COMMISSION = 0.65;
const STOCK_COMMISSION = 1;

export interface DemoWorld {
  reference: string;
  transactions: Transaction[];
  positions: Position[];
  /** Mark of the day before, by conid: the day's P&L of the simulated agent. */
  previousMarks: Map<string, number>;
  cashPoints: CashPointRecord[];
  cashAvailable: number;
}

interface OptionLeg {
  ticker: string;
  right: "C" | "P";
  strike: number;
  /** YYYY-MM-DD */
  expiry: string;
}

interface OpenOption extends OptionLeg {
  id: string;
  /** Signed: a sale is negative. */
  contracts: number;
}

type TradeFields = Omit<Transaction, "accountId" | "source" | "externalId" | "description"> & { description?: string };

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * The demo account's whole world on the visit of `now` (sub-project 41, spec §5): the scenario
 * replayed into Flex-shaped transactions, the positions snapshot they add up to, and the Cash
 * Report points that anchor them. Pure and deterministic: the same visit day, the same world.
 */
export function generateDemo(now: Date): DemoWorld {
  const reference = referenceDay(now);
  // Every market day the prices cover, newest first: `days[ago]` is the day `ago` market days
  // before the reference, computed once rather than walked back on every lookup.
  const days = [reference];
  for (let ago = 1; ago <= MAX_AGO; ago += 1) days.push(marketDaysBefore(days[ago - 1], 1));
  const dayAt = (ago: number) => days[ago];
  // Market days between a day and the reference: the index of prices.ts.
  const agoOf = (day: string) => {
    const ago = days.findIndex((d) => d <= day);
    if (ago < 0) throw new Error(`demo: ${day} is before the price paths`);
    return ago;
  };
  const transactions: Transaction[] = [];
  const open = new Map<string, OpenOption[]>();
  let serial = 0;

  const push = (t: TradeFields, cash = false) => {
    serial += 1;
    transactions.push({
      accountId: DEMO_ACCOUNT_ID,
      source: "flex",
      externalId: `${cash ? "flex:cash" : "flex:trade"}:demo-${serial}`,
      ...t,
      description: t.description ?? "",
    });
  };

  const optionTrade = (o: OptionLeg, contracts: number, price: number, when: string, commission: number | null) =>
    push({
      kind: "trade",
      symbol: packedOptionSymbol(o.ticker, o.expiry, o.right, o.strike)!,
      secType: "OPT",
      right: o.right,
      strike: o.strike,
      expiry: o.expiry,
      quantity: contracts,
      price,
      amount: round2(-contracts * price * DEFAULT_MULTIPLIER),
      commission,
      currency: "USD",
      when,
    });

  const stockTrade = (ticker: string, quantity: number, price: number, when: string, commission: number) =>
    push({ kind: "trade", symbol: ticker, secType: "STK", right: "", strike: null, expiry: null, quantity, price, amount: round2(-quantity * price), commission, currency: "USD", when });

  const markOn = (o: OptionLeg, day: string) =>
    optionMark(closeAgo(o.ticker, agoOf(day)), o.strike, o.right, calendarDaysBetween(day, o.expiry), VOLATILITY[o.ticker]);

  // Every open option whose expiry falls before `day` expires, is assigned or is exercised at
  // 20:00, the shape the journals infer (price 0, no commission, shares at the strike).
  const settleBefore = (day: string) => {
    for (const [id, legs] of open) {
      const remaining = legs.filter((leg) => {
        if (leg.expiry >= day) return true;
        const spot = closeAgo(leg.ticker, agoOf(leg.expiry));
        const inTheMoney = leg.right === "C" ? spot > leg.strike : spot < leg.strike;
        const when = `${leg.expiry}T20:00:00.000Z`;
        if (inTheMoney && leg.ticker === "XSP") throw new Error(`demo: XSP leg ${leg.right}${leg.strike} in the money at ${leg.expiry}`);
        optionTrade(leg, -leg.contracts, 0, when, null);
        if (inTheMoney) stockTrade(leg.ticker, (leg.right === "P" ? -1 : 1) * leg.contracts * DEFAULT_MULTIPLIER, leg.strike, when, 0);
        return false;
      });
      if (remaining.length === 0) open.delete(id);
      else open.set(id, remaining);
    }
  };

  function apply(event: DemoEvent, day: string) {
    const when = `${day}T14:30:00.000Z`;
    const spot = (ticker: string) => closeAgo(ticker, agoOf(day));
    const cashRow = { symbol: "", secType: "", right: "", strike: null, expiry: null, quantity: null, price: null, commission: null, currency: "USD", when: `${day}T00:00:00.000Z` } as const;
    switch (event.type) {
      case "deposit":
        return push({ ...cashRow, kind: "transfer", amount: event.amount, description: "ELECTRONIC FUND TRANSFER" }, true);
      case "interest":
        return push({ ...cashRow, kind: "interest", amount: event.amount, description: "USD CREDIT INT" }, true);
      case "dividend":
        return push({ ...cashRow, kind: "dividend", symbol: event.ticker, secType: "STK", amount: round2(event.perShare * event.shares), description: `${event.ticker} CASH DIVIDEND` }, true);
      case "buyStock":
        return stockTrade(event.ticker, event.quantity, spot(event.ticker), when, -STOCK_COMMISSION);
      case "sellOption":
      case "buyOption": {
        const sign = event.type === "sellOption" ? -1 : 1;
        const leg: OptionLeg = { ticker: event.ticker, right: event.right, strike: event.strike, expiry: fridayOnOrAfter(addDays(day, event.dte)) };
        optionTrade(leg, sign * event.contracts, markOn(leg, day), when, round2(-OPTION_COMMISSION * event.contracts));
        open.set(event.id, [{ id: event.id, ...leg, contracts: sign * event.contracts }]);
        return;
      }
      case "buyBack": {
        for (const leg of open.get(event.id) ?? []) optionTrade(leg, -leg.contracts, markOn(leg, day), when, round2(-OPTION_COMMISSION * Math.abs(leg.contracts)));
        open.delete(event.id);
        return;
      }
      case "sellCondor": {
        const expiry = fridayOnOrAfter(addDays(day, event.dte));
        const legs: OpenOption[] = [
          { id: event.id, ticker: event.ticker, right: "P", strike: event.putLong, expiry, contracts: event.contracts },
          { id: event.id, ticker: event.ticker, right: "P", strike: event.putShort, expiry, contracts: -event.contracts },
          { id: event.id, ticker: event.ticker, right: "C", strike: event.callShort, expiry, contracts: -event.contracts },
          { id: event.id, ticker: event.ticker, right: "C", strike: event.callLong, expiry, contracts: event.contracts },
        ];
        for (const leg of legs) optionTrade(leg, leg.contracts, markOn(leg, day), when, round2(-OPTION_COMMISSION * event.contracts));
        open.set(event.id, legs);
        return;
      }
    }
  }

  const events = [...DEMO_SCENARIO].sort((a, b) => b.ago - a.ago);
  for (const event of events) {
    const day = dayAt(event.ago);
    settleBefore(day);
    apply(event, day);
  }
  settleBefore(reference);

  const { positions, previousMarks } = positionsAt(transactions, reference, dayAt(1), agoOf);
  const rows = runningBalances(transactions, DEMO_CURRENCIES);
  const first = dayOf(rows[0].transaction.when);
  const last = rows[rows.length - 1];
  const importedAt = now.toISOString();
  const cashPoints = DEMO_CURRENCIES.flatMap((currency): CashPointRecord[] => [
    { accountId: DEMO_ACCOUNT_ID, currency, kind: "start", asOf: first, amount: 0, source: "flex", importedAt },
    { accountId: DEMO_ACCOUNT_ID, currency, kind: "end", asOf: dayOf(last.transaction.when), amount: round2(last.balances[currency]), source: "flex", importedAt },
  ]);
  return { reference, transactions, positions, previousMarks, cashPoints, cashAvailable: round2(last.balances.USD) };
}

/**
 * The positions the transactions add up to on the reference day, marked on prices.ts, and the
 * marks of the day before. The average price follows each contract's book: adding in the
 * current direction raises the cost, reducing scales it, crossing zero restarts it.
 */
function positionsAt(transactions: readonly Transaction[], reference: string, previousDay: string, agoOf: (day: string) => number) {
  interface Book {
    ticker: string;
    secType: "STK" | "OPT";
    right: "C" | "P" | "";
    strike: number | null;
    expiry: string | null;
    quantity: number;
    cost: number;
  }
  const books = new Map<string, Book>();
  for (const t of transactions) {
    if (t.kind !== "trade" || t.quantity === null || t.price === null) continue;
    const ticker = t.secType === "OPT" ? t.symbol.slice(0, 6).trim() : t.symbol;
    const key = [ticker, t.secType, t.right, t.strike ?? "", t.expiry ?? ""].join("|");
    const book = books.get(key) ?? { ticker, secType: t.secType as "STK" | "OPT", right: t.right, strike: t.strike, expiry: t.expiry, quantity: 0, cost: 0 };
    const next = book.quantity + t.quantity;
    if (book.quantity === 0 || Math.sign(t.quantity) === Math.sign(book.quantity)) book.cost += t.quantity * t.price;
    else book.cost = Math.sign(next) === Math.sign(book.quantity) ? book.cost * (next / book.quantity) : next * t.price;
    book.quantity = next;
    if (next === 0) book.cost = 0;
    books.set(key, book);
  }
  const positions: Position[] = [];
  const previousMarks = new Map<string, number>();
  for (const [key, b] of books) {
    if (b.quantity === 0) continue;
    const multiplier = b.secType === "OPT" ? DEFAULT_MULTIPLIER : 1;
    const markAt = (day: string) =>
      b.secType === "OPT"
        ? optionMark(closeAgo(b.ticker, agoOf(day)), b.strike!, b.right as "C" | "P", calendarDaysBetween(day, b.expiry!), VOLATILITY[b.ticker])
        : closeAgo(b.ticker, agoOf(day));
    const mark = markAt(reference);
    const avg = round2(b.cost / b.quantity);
    const conid = String(conidOf(key));
    previousMarks.set(conid, markAt(previousDay));
    positions.push({
      symbol: b.ticker,
      secType: b.secType,
      right: b.right,
      strike: b.strike,
      expiry: b.expiry,
      multiplier: b.secType === "OPT" ? DEFAULT_MULTIPLIER : null,
      quantity: b.quantity,
      avgPrice: avg,
      marketPrice: mark,
      marketValue: round2(b.quantity * mark * multiplier),
      unrealizedPnl: round2((mark - avg) * b.quantity * multiplier),
      dailyPnl: null,
      dayChange: null,
      currency: "USD",
      conid,
      description: b.secType === "OPT" ? `${b.ticker} ${b.expiry} ${b.strike} ${b.right}` : b.ticker,
    });
  }
  return { positions, previousMarks };
}

/** A stable positive integer per contract key: TWS's conId of the simulated agent. */
export function conidOf(key: string): number {
  let h = 5381;
  for (const c of key) h = (Math.imul(h, 33) ^ c.charCodeAt(0)) >>> 0;
  return (h % 900_000_000) + 100_000_000;
}
