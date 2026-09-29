/**
 * The story of the demo account (sub-project 41, spec §5), in market days before the reference
 * day. Strikes are absolute: the price paths of prices.ts are fixed relative to that day, so
 * each outcome — assignment, call-away, expiry — is known when the scenario is written, and
 * generate.test.ts checks it on several visit days.
 */
export type DemoEvent =
  | { type: "deposit"; ago: number; amount: number }
  | { type: "interest"; ago: number; amount: number }
  | { type: "dividend"; ago: number; ticker: string; perShare: number; shares: number }
  | { type: "buyStock"; ago: number; ticker: string; quantity: number }
  | { type: "sellOption"; id: string; ago: number; ticker: string; right: "C" | "P"; strike: number; dte: number; contracts: number }
  | { type: "buyOption"; id: string; ago: number; ticker: string; right: "C" | "P"; strike: number; dte: number; contracts: number }
  /** Closes the position opened under `id`, whatever its side: buys back a sale, sells a purchase. */
  | { type: "buyBack"; id: string; ago: number }
  | { type: "sellCondor"; id: string; ago: number; ticker: string; putShort: number; putLong: number; callShort: number; callLong: number; dte: number; contracts: number };

export const DEMO_SCENARIO: readonly DemoEvent[] = [
  { type: "deposit", ago: 390, amount: 150_000 },
  // Wheel, AAPL: a whole cycle — put assigned, a call expires, the next call calls the shares away.
  { type: "sellOption", id: "aapl-put", ago: 360, ticker: "AAPL", right: "P", strike: 170, dte: 30, contracts: 2 },
  { type: "sellOption", id: "aapl-call-1", ago: 330, ticker: "AAPL", right: "C", strike: 175, dte: 45, contracts: 2 },
  { type: "dividend", ago: 300, ticker: "AAPL", perShare: 0.25, shares: 200 },
  { type: "sellOption", id: "aapl-call-2", ago: 290, ticker: "AAPL", right: "C", strike: 175, dte: 75, contracts: 2 },
  // Wheel, AMD: assigned, a call expires, a call still open on the shares held.
  { type: "sellOption", id: "amd-put", ago: 320, ticker: "AMD", right: "P", strike: 135, dte: 30, contracts: 1 },
  { type: "sellOption", id: "amd-call-1", ago: 200, ticker: "AMD", right: "C", strike: 140, dte: 45, contracts: 1 },
  { type: "sellOption", id: "amd-call-2", ago: 20, ticker: "AMD", right: "C", strike: 145, dte: 35, contracts: 1 },
  // Others, KO: shares bought at the market, two lots of which a covered call takes into the Wheel.
  { type: "buyStock", ago: 250, ticker: "KO", quantity: 300 },
  { type: "dividend", ago: 180, ticker: "KO", perShare: 0.485, shares: 300 },
  { type: "sellOption", id: "ko-call-1", ago: 60, ticker: "KO", right: "C", strike: 68, dte: 45, contracts: 2 },
  { type: "sellOption", id: "ko-call-2", ago: 15, ticker: "KO", right: "C", strike: 69, dte: 40, contracts: 2 },
  // Wheel, MSFT: a put bought back early, a put to buy back now.
  { type: "sellOption", id: "msft-put-1", ago: 150, ticker: "MSFT", right: "P", strike: 390, dte: 45, contracts: 1 },
  { type: "buyBack", id: "msft-put-1", ago: 130 },
  { type: "sellOption", id: "msft-put-2", ago: 20, ticker: "MSFT", right: "P", strike: 430, dte: 30, contracts: 1 },
  { type: "sellOption", id: "aapl-put-2", ago: 10, ticker: "AAPL", right: "P", strike: 215, dte: 30, contracts: 1 },
  // LEAPS: NVDA with a call sold against it, JPM alone; an older NVDA LEAPS sold at a profit.
  { type: "buyOption", id: "nvda-leaps", ago: 300, ticker: "NVDA", right: "C", strike: 120, dte: 540, contracts: 2 },
  { type: "sellOption", id: "nvda-call", ago: 12, ticker: "NVDA", right: "C", strike: 190, dte: 30, contracts: 1 },
  { type: "buyOption", id: "jpm-leaps", ago: 200, ticker: "JPM", right: "C", strike: 200, dte: 600, contracts: 1 },
  { type: "buyOption", id: "nvda-leaps-old", ago: 380, ticker: "NVDA", right: "C", strike: 110, dte: 400, contracts: 1 },
  { type: "buyBack", id: "nvda-leaps-old", ago: 140 },
  // Condors on XSP: one expired out of the money, one open.
  { type: "sellCondor", id: "xsp-1", ago: 100, ticker: "XSP", putShort: 520, putLong: 510, callShort: 600, callLong: 610, dte: 30, contracts: 2 },
  { type: "sellCondor", id: "xsp-2", ago: 10, ticker: "XSP", putShort: 560, putLong: 550, callShort: 615, callLong: 625, dte: 35, contracts: 2 },
  // Others: a naked call, the one uncovered position of the title bar.
  { type: "sellOption", id: "dis-call", ago: 8, ticker: "DIS", right: "C", strike: 125, dte: 30, contracts: 1 },
  { type: "interest", ago: 350, amount: 45.1 },
  { type: "interest", ago: 250, amount: 61.3 },
  { type: "interest", ago: 150, amount: 55.8 },
  { type: "interest", ago: 50, amount: 70.2 },
];
