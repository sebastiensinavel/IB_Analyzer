import { beforeEach, describe, expect, it } from "vitest";
import type { AgentSnapshotPayload } from "@ib/ib-parsers";
import { buildJournals, type Transaction } from "@ib/ledger";
import { db, type AccountRecord } from "@/db/schema";
import type { AgentFetchResult } from "./client";
import { syncAgent } from "./sync";

const NOW = new Date("2026-09-06T13:05:00.000Z");
const ACCOUNT: AccountRecord = {
  id: "beta",
  label: "Beta",
  ibAccountId: "U1234567",
  createdAt: "2026-09-01T00:00:00.000Z",
  warnedDroppedKinds: [],
  twsPort: 7502,
};

const CONTRACT = {
  conId: 265598, symbol: "SYMA", localSymbol: "SYMA", secType: "STK", right: "", strike: 0,
  lastTradeDateOrContractMonth: "", multiplier: "", currency: "USD",
};

function payload(overrides: Partial<AgentSnapshotPayload> = {}): AgentSnapshotPayload {
  return {
    accounts: ["U1234567"],
    fetchedAt: "2026-09-06T13:02:11.482Z",
    cashAvailable: 16284.37,
    positions: [{ ...CONTRACT, position: 100, averageCost: 150.25, marketPrice: 172.1, marketValue: 17210, unrealizedPNL: 2185 }],
    executions: [
      {
        execId: "e1", time: "2026-09-06T14:31:02+00:00", acctNumber: "U1234567", side: "BOT", shares: 10, price: 172,
        cumQty: 10, avgPrice: 172, orderRef: "", contract: CONTRACT, commission: null, commissionCurrency: null,
      },
    ],
    ...overrides,
  };
}

const answer = (result: AgentFetchResult) => ({ db, fetchSnapshot: async () => result, now: () => NOW });
const ok = (body: AgentSnapshotPayload) => answer({ ok: true, payload: body });

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.accounts.put(ACCOUNT);
});

describe("syncAgent", () => {
  it("skips an account without a port and touches nothing", async () => {
    const calls: number[] = [];
    const deps = { db, fetchSnapshot: async (port: number) => (calls.push(port), { ok: false as const, code: "agent-error" as const }), now: () => NOW };
    expect(await syncAgent(deps, { ...ACCOUNT, twsPort: undefined })).toEqual({ status: "skipped", code: "no-port" });
    expect(calls).toEqual([]);
    expect((await db.accounts.get("beta"))?.lastAgentSyncStatus).toBeUndefined();
  });

  it("asks the agent for the account's port", async () => {
    const calls: number[] = [];
    const deps = { db, fetchSnapshot: async (port: number) => (calls.push(port), { ok: true as const, payload: payload() }), now: () => NOW };
    await syncAgent(deps, ACCOUNT);
    expect(calls).toEqual([7502]);
  });

  it("writes the transactions, the live snapshot and the account state in one go", async () => {
    const outcome = await syncAgent(ok(payload()), ACCOUNT);
    expect(outcome).toEqual({ status: "ok", transactions: 1, positions: 1 });

    const rows = await db.transactions.where("accountId").equals("beta").toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ externalId: "agent:e1", source: "agent", quantity: 10, amount: -1720, commission: null });

    const snapshot = await db.snapshots.get("beta");
    expect(snapshot).toMatchObject({ source: "agent", asOf: "2026-09-06T09:02:11.482Z", importedAt: NOW.toISOString(), cashAvailable: 16284.37 });
    expect(snapshot?.positions).toHaveLength(1);

    expect(await db.accounts.get("beta")).toMatchObject({
      lastAgentSyncAt: NOW.toISOString(),
      lastAgentSyncStatus: { at: NOW.toISOString(), ok: true },
    });
    expect(await db.imports.count()).toBe(0);
  });

  it("writes only after Flex's newest row", async () => {
    await db.transactions.put({
      accountId: "beta", externalId: "flex:trade:1", source: "flex", kind: "trade", symbol: "SYMA", secType: "STK", right: "",
      strike: null, expiry: null, quantity: 1, price: 1, amount: -1, commission: null, currency: "USD",
      when: "2026-09-06T15:00:00.000Z", description: "",
    });
    const outcome = await syncAgent(ok(payload()), ACCOUNT);
    expect(outcome).toEqual({ status: "ok", transactions: 0, positions: 1 });
    expect(await db.transactions.where("accountId").equals("beta").count()).toBe(1);
  });

  it("replaces a Flex snapshot of the same day", async () => {
    await db.snapshots.put({ accountId: "beta", source: "flex", asOf: "2026-09-06", importedAt: "", positions: [], cashAvailable: null });
    await syncAgent(ok(payload()), ACCOUNT);
    expect((await db.snapshots.get("beta"))?.source).toBe("agent");
  });

  it("refuses a TWS that manages another account, and writes nothing but the failure", async () => {
    await db.snapshots.put({ accountId: "beta", source: "flex", asOf: "2026-09-05", importedAt: "", positions: [], cashAvailable: null });
    const outcome = await syncAgent(ok(payload({ accounts: ["U7654321"] })), ACCOUNT);
    expect(outcome).toEqual({ status: "failed", code: "account-mismatch" });
    expect(await db.transactions.count()).toBe(0);
    expect((await db.snapshots.get("beta"))?.source).toBe("flex");
    expect(await db.accounts.get("beta")).toMatchObject({ lastAgentSyncStatus: { at: NOW.toISOString(), ok: false, code: "account-mismatch" } });
    expect((await db.accounts.get("beta"))?.lastAgentSyncAt).toBeUndefined();
  });

  it("refuses a multi-account TWS even when this account is among the ones it manages, and writes nothing", async () => {
    // ib_async's portfolio(""), accountValues("") and fills() merge every managed account's
    // data when TWS handles more than one; `includes` would let this through and silently
    // combine two accounts. Only an exact single-account match may write.
    await db.snapshots.put({ accountId: "beta", source: "flex", asOf: "2026-09-05", importedAt: "", positions: [], cashAvailable: null });
    const outcome = await syncAgent(ok(payload({ accounts: ["U1234567", "U7654321"] })), ACCOUNT);
    expect(outcome).toEqual({ status: "failed", code: "account-mismatch" });
    expect(await db.transactions.count()).toBe(0);
    expect((await db.snapshots.get("beta"))?.source).toBe("flex");
  });

  it("records the agent's own failure codes", async () => {
    expect(await syncAgent(answer({ ok: false, code: "tws-unreachable" }), ACCOUNT)).toEqual({ status: "failed", code: "tws-unreachable" });
    expect((await db.accounts.get("beta"))?.lastAgentSyncStatus).toEqual({ at: NOW.toISOString(), ok: false, code: "tws-unreachable" });
  });

  it("records an unreadable payload as parse-error", async () => {
    expect(await syncAgent(answer({ ok: true, payload: { nope: 1 } }), ACCOUNT)).toEqual({ status: "failed", code: "parse-error" });
    expect((await db.accounts.get("beta"))?.lastAgentSyncStatus?.code).toBe("parse-error");
  });

  it("keeps lastAgentSyncAt from the last success when a later pass fails", async () => {
    await syncAgent(ok(payload()), ACCOUNT);
    await syncAgent(answer({ ok: false, code: "agent-unreachable" }), ACCOUNT);
    expect(await db.accounts.get("beta")).toMatchObject({
      lastAgentSyncAt: NOW.toISOString(),
      lastAgentSyncStatus: { ok: false, code: "agent-unreachable" },
    });
  });

  it("is idempotent, and a later pass fills in a commission", async () => {
    await syncAgent(ok(payload()), ACCOUNT);
    const withCommission = payload();
    withCommission.executions[0].commission = 1.5;
    withCommission.executions[0].commissionCurrency = "USD";
    await syncAgent(ok(withCommission), ACCOUNT);
    const rows = await db.transactions.where("accountId").equals("beta").toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].commission).toBe(-1.5);
  });

  it("records the contracts a pass saw, dated by the day of the pass", async () => {
    await syncAgent(ok(payload()), ACCOUNT);
    const records = await db.contracts.where("accountId").equals("beta").toArray();
    expect(records.length).toBeGreaterThan(0);
    expect(records[0].aliases[0].firstSeen).toBe(records[0].aliases[0].lastSeen);
  });

  it("adds the tickers of the pass to the sector table and leaves a known row alone", async () => {
    const known = { ticker: "SYMB", name: "Mine", category: "Tech", score: 8, status: "on", updatedAt: "2026-01-01T00:00:00.000Z" };
    await db.sectors.put(known);
    const other = { ...CONTRACT, conId: 1, symbol: "SYMB", localSymbol: "SYMB" };
    const body = payload();
    await syncAgent(
      ok({ ...body, positions: [...body.positions, { ...other, position: 5, averageCost: 10, marketPrice: 11, marketValue: 55, unrealizedPNL: 5 }] }),
      ACCOUNT,
    );
    // TWS describes a share by its ticker: there is no company name to take.
    expect(await db.sectors.get("SYMA")).toEqual({ ticker: "SYMA", name: "", category: "", score: null, status: "", updatedAt: NOW.toISOString() });
    expect(await db.sectors.get("SYMB")).toEqual(known);
  });

  it("adds nothing to the sector table when the pass is refused", async () => {
    await syncAgent(ok(payload({ accounts: ["U7654321"] })), ACCOUNT);
    expect(await db.sectors.count()).toBe(0);
  });
});

describe("syncAgent over an assignment Flex already reported", () => {
  const IQZA = {
    conId: 1, symbol: "IQZA", localSymbol: "IQZA", secType: "STK", right: "", strike: 0,
    lastTradeDateOrContractMonth: "", multiplier: "", currency: "USD",
  };
  const IREN_PUT = {
    conId: 2, symbol: "IQZA", localSymbol: "IQZA  260918P00060000", secType: "OPT", right: "P", strike: 60,
    lastTradeDateOrContractMonth: "20260918", multiplier: "100", currency: "USD",
  };
  const put: Pick<Transaction, "symbol" | "secType" | "right" | "strike" | "expiry"> = {
    symbol: "IQZA  260918P00060000", secType: "OPT", right: "P", strike: 60, expiry: "2026-09-18",
  };
  const flexRow = (id: string, when: string, fields: Partial<Transaction>): Transaction => ({
    accountId: "beta", externalId: `flex:trade:${id}`, source: "flex", kind: "trade", symbol: "IQZA", secType: "STK",
    right: "", strike: null, expiry: null, quantity: 0, price: 0, amount: 0, commission: 0, currency: "USD", when,
    description: "", ...fields,
  });
  // Flex dates the assignment 16:20 on the expiry day; TWS reports it at 02:13:46 UTC the next
  // morning, 22:13:46 in New York the same evening.
  const flexLedger = [
    flexRow("open", "2026-09-01T10:00:00.000Z", { ...put, quantity: -1, price: 1.5, amount: 150, commission: -1.05 }),
    flexRow("put", "2026-09-15T16:20:00.000Z", { ...put, quantity: 1 }),
    flexRow("stk", "2026-09-15T16:20:00.000Z", { quantity: 100, price: 60, amount: -6000 }),
  ];
  const execution = (execId: string, contract: typeof IQZA, shares: number, price: number, time: string) => ({
    execId, time, acctNumber: "U1234567", side: "BOT", shares, price, cumQty: shares, avgPrice: price, orderRef: "",
    contract, commission: null, commissionCurrency: null,
  });
  const assignmentPass = payload({
    fetchedAt: "2026-09-16T15:04:26.000Z",
    positions: [{ ...IQZA, position: 100, averageCost: 60, marketPrice: 61, marketValue: 6100, unrealizedPNL: 100 }],
    executions: [
      execution("put", IREN_PUT, 1, 0, "2026-09-16T02:13:46+00:00"),
      execution("stk", IQZA, 100, 60, "2026-09-16T02:13:46+00:00"),
    ],
  });

  it("writes none of it, and the ledger reconciles with the live snapshot", async () => {
    await db.transactions.bulkPut(flexLedger);
    const outcome = await syncAgent(ok(assignmentPass), ACCOUNT);
    expect(outcome).toEqual({ status: "ok", transactions: 0, positions: 1 });

    const ledger = await db.transactions.where("accountId").equals("beta").toArray();
    expect(ledger.map((row) => row.externalId).sort()).toEqual(["flex:trade:open", "flex:trade:put", "flex:trade:stk"]);
    const snapshot = await db.snapshots.get("beta");
    expect(snapshot?.asOf).toBe("2026-09-16T11:04:26.000Z");
    const report = buildJournals(ledger, { asOf: snapshot!.asOf, positions: snapshot!.positions });
    expect(report.reconciliation.differences).toEqual([]);
  });

  it("still writes a fill of the next New York day, at New York's hour", async () => {
    await db.transactions.bulkPut(flexLedger);
    const nextDay = payload({ executions: [execution("buy", IQZA, 10, 61, "2026-09-16T14:00:00+00:00")] });
    const outcome = await syncAgent(ok(nextDay), ACCOUNT);
    expect(outcome).toMatchObject({ status: "ok", transactions: 1 });
    expect((await db.transactions.get(["beta", "agent:buy"]))?.when).toBe("2026-09-16T10:00:00.000Z");
  });
});
