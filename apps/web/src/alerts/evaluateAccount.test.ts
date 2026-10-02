import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "@ib/ledger";
import type { QuoteMap } from "@/agent/quotes";
import { setActiveStrategies } from "@/db/accounts";
import { createManualAlert } from "@/db/alerts";
import { db, type AccountRecord } from "@/db/schema";
import { resetAnchorGuards } from "./anchors";
import { evaluateAccountAlerts, type EvaluateAccountDeps } from "./evaluateAccount";


const account = (id: string, fields: Partial<AccountRecord> = {}): AccountRecord => ({
  id, label: id, ibAccountId: "U0000000", createdAt: "2026-09-01T00:00:00.000Z", warnedDroppedKinds: [], ...fields,
});

function trade(overrides: Partial<Transaction>): Transaction {
  return {
    accountId: "beta", externalId: "", source: "flex", kind: "trade", symbol: "", secType: "OPT", right: "", strike: null, expiry: null,
    quantity: null, price: null, amount: null, commission: -1, currency: "USD", when: "", description: "", ...overrides,
  };
}

const QQQ = (right: "C" | "P", strike: number) => ({ symbol: `QQQ   261016${right}00${strike}000`, right, strike, expiry: "2026-10-16" });
const CONDOR_OPEN = "2026-09-15T14:30:00.000Z";
/** A QQQ condor 600/610/650/660, open: at 15 %, X = 6 — alert under 616, over 644. */
const CONDOR_TRANSACTIONS: Transaction[] = [
  trade({ externalId: "flex:trade:201", ...QQQ("P", 600), quantity: 1, price: 1, amount: -100, when: CONDOR_OPEN }),
  trade({ externalId: "flex:trade:202", ...QQQ("P", 610), quantity: -1, price: 2, amount: 200, when: CONDOR_OPEN }),
  trade({ externalId: "flex:trade:203", ...QQQ("C", 650), quantity: -1, price: 2, amount: 200, when: CONDOR_OPEN }),
  trade({ externalId: "flex:trade:204", ...QQQ("C", 660), quantity: 1, price: 1, amount: -100, when: CONDOR_OPEN }),
];

const quoteTable = (entries: Record<string, number>): QuoteMap =>
  new Map(Object.entries(entries).map(([ticker, last]) => [ticker, { last, change: null }]));

function deps(fields: Partial<EvaluateAccountDeps> = {}): EvaluateAccountDeps {
  return {
    fresh: true,
    quote: vi.fn(async () => {}),
    quotes: () => quoteTable({}),
    fetchBars: vi.fn(async () => ({ ok: false as const, code: "tws-unreachable" as const })),
    now: () => new Date("2026-09-30T18:00:00.000Z"),
    ...fields,
  };
}

const emptyState = (accountId: string, alertId: string) => ({
  accountId, alertId, triggeredAt: null, acknowledgedAt: null, disabled: false, armed: true, anchor: null, override: null,
});

beforeEach(async () => {
  resetAnchorGuards();
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe("evaluateAccountAlerts", () => {
  it("triggers a manual alert on its quote, once", async () => {
    await db.accounts.add(account("beta", { twsPort: 7502 }));
    await createManualAlert(db, "beta", { ticker: "AAPL", price: 245, direction: "below" });
    const d = deps({ quotes: () => quoteTable({ AAPL: 244 }) });
    const first = await evaluateAccountAlerts(db, "beta", d);
    expect(first.map((t) => [t.alert.ticker, t.price])).toEqual([["AAPL", 244]]);
    expect(await evaluateAccountAlerts(db, "beta", d)).toEqual([]);
    expect(d.quote).toHaveBeenCalledWith(7502, ["AAPL"]);
  });

  it("triggers a condor alert from the account's own journals", async () => {
    await db.accounts.add(account("beta", { twsPort: 7502 }));
    await setActiveStrategies(db, "beta", ["wheel", "condors"]);
    await db.transactions.bulkAdd(CONDOR_TRANSACTIONS);
    const triggered = await evaluateAccountAlerts(db, "beta", deps({ quotes: () => quoteTable({ QQQ: 615 }) }));
    expect(triggered.map((t) => t.alert.kind)).toEqual(["condor"]);
  });

  it("purges but never triggers when the agent pass failed", async () => {
    await db.accounts.add(account("beta", { twsPort: 7502 }));
    await createManualAlert(db, "beta", { ticker: "AAPL", price: 245, direction: "below" });
    await db.alertStates.put(emptyState("beta", "wheel:gone"));
    const d = deps({ fresh: false, quotes: () => quoteTable({ AAPL: 244 }) });
    expect(await evaluateAccountAlerts(db, "beta", d)).toEqual([]);
    expect(d.quote).not.toHaveBeenCalled();
    expect(await db.alertStates.get(["beta", "wheel:gone"])).toBeUndefined();
  });

  it("never touches another account's states", async () => {
    await db.accounts.bulkAdd([account("alpha", { twsPort: 7501 }), account("beta", { twsPort: 7502 })]);
    await db.alertStates.put(emptyState("alpha", "wheel:x"));
    await evaluateAccountAlerts(db, "beta", deps());
    expect(await db.alertStates.get(["alpha", "wheel:x"])).toBeDefined();
  });

  it("answers nothing for an unknown account", async () => {
    expect(await evaluateAccountAlerts(db, "nobody", deps())).toEqual([]);
  });
});
