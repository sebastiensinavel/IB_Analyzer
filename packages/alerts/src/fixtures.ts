import type { ContractKey, JournalRow } from "@ib/ledger";

/** Construit une ligne de journal ouverte ; les champs non utiles aux alertes prennent une valeur neutre. */
export function row(overrides: Partial<JournalRow> & Pick<JournalRow, "id" | "strategy" | "kind" | "ticker">): JournalRow {
  const contract: ContractKey = { ticker: overrides.ticker, secType: "STK", right: "", strike: null, expiry: null, currency: "USD" };
  return {
    label: overrides.ticker, currency: "USD", contract, startWhen: "2026-09-01T15:00:00.000Z", quantity: 100,
    strike: null, openPrice: null, openTotal: null, openCommission: null, openNet: null, assigned: false,
    endWhen: null, closePrice: null, closeTotal: null, closeCommission: null, closeNet: null, pnl: null,
    ongoing: true, event: null, orphan: false, note: null, openIds: [], closeIds: [],
    ...overrides,
  };
}

export function call(id: string, ticker: string, strike: number, extra: Partial<JournalRow> = {}): JournalRow {
  return row({
    id, strategy: "wheel", kind: "short_call", ticker, quantity: -1, strike,
    contract: { ticker, secType: "OPT", right: "C", strike, expiry: "2026-10-16", currency: "USD" }, ...extra,
  });
}

export function shares(ticker: string, price: number | null): JournalRow {
  return row({ id: `s-${ticker}`, strategy: "wheel", kind: "shares", ticker, quantity: 100, openPrice: price });
}

export function condor(id: string, [lp, sp, sc, lc]: [number, number, number, number], closed: { put?: boolean; call?: boolean } = {}): JournalRow {
  const leg = (strike: number, right: "P" | "C", qty: number, isClosed: boolean) =>
    row({
      id: `${id}-${strike}`, strategy: "condors", kind: "short_call", ticker: "XSP", quantity: qty, strike,
      contract: { ticker: "XSP", secType: "OPT", right, strike, expiry: "2026-10-16", currency: "USD" },
      endWhen: isClosed ? "2026-09-20T15:00:00.000Z" : null,
    });
  return row({
    id, strategy: "condors", kind: "condor", ticker: "XSP", quantity: -1,
    contract: { ticker: "XSP", secType: "OPT", right: "", strike: null, expiry: "2026-10-16", currency: "USD" },
    legs: [leg(lp, "P", 1, false), leg(sp, "P", -1, closed.put === true), leg(sc, "C", -1, closed.call === true), leg(lc, "C", 1, false)],
  });
}
