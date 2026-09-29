import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "@/db/schema";
import { positionSuggestions } from "@ib/coverage";
import { ACTIVABLE_STRATEGIES, buildJournals } from "@ib/ledger";
import { generateDemo } from "@/demo/generate";
import { ensureDemoSeeded } from "@/demo/seed";
import { syncAgent } from "@/agent/sync";
import { fetchBars, fetchQuotes, fetchSnapshot, probeAgent } from "@/agent/client";

const NOW = new Date("2026-09-25T19:00:00Z");

beforeEach(async () => {
  await Promise.all([db.accounts.clear(), db.transactions.clear(), db.snapshots.clear(), db.cashPoints.clear(), db.contracts.clear(), db.sectors.clear()]);
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// A Thursday and the Friday after: two reference days, a Friday expiry between them.
const DAY = new Date("2026-09-24T19:00:00Z");
const NEXT_DAY = new Date("2026-09-25T19:00:00Z");

/** An agent pass through the real transport, which passes no `now`: the demo agent reads the clock. */
async function agentPass(): Promise<void> {
  const outcome = await syncAgent({ db, fetchSnapshot, now: () => new Date() }, (await db.accounts.get("demo"))!);
  expect(outcome.status).toBe("ok");
}

async function reconciliation() {
  const snapshot = (await db.snapshots.get("demo"))!;
  expect(snapshot.source).toBe("agent");
  const transactions = await db.transactions.where("accountId").equals("demo").toArray();
  return buildJournals(transactions, { asOf: snapshot.asOf, positions: snapshot.positions }, undefined, ACTIVABLE_STRATEGIES).reconciliation;
}

it("seeds the demo account once", async () => {
  await ensureDemoSeeded(db, NOW);
  await ensureDemoSeeded(db, NOW);
  const account = await db.accounts.get("demo");
  expect(account).toMatchObject({ label: "Démo", ibAccountId: "U0000000", twsPort: 7496, strategies: ["wheel", "leaps", "condors"] });
  expect(await db.snapshots.get("demo")).toMatchObject({ source: "flex" });
  const count = await db.transactions.where("accountId").equals("demo").count();
  expect(count).toBeGreaterThan(30);
  await ensureDemoSeeded(db, NOW);
  expect(await db.transactions.where("accountId").equals("demo").count()).toBe(count);
});

it("never calls the real agent in the demo, and a full pass goes through the real pipeline", async () => {
  window.sessionStorage.setItem("ib2:demo", "1");
  const spy = vi.spyOn(globalThis, "fetch");
  await ensureDemoSeeded(db, NOW);
  expect(await probeAgent()).toEqual({ version: "demo" });
  // The transport passes no `now`: the demo agent builds the seed's world whatever the clock says
  // (the two tests below hold that), so only the source is asserted here.
  const outcome = await syncAgent({ db, fetchSnapshot, now: () => NOW }, (await db.accounts.get("demo"))!);
  expect(outcome.status).toBe("ok");
  expect(await db.snapshots.get("demo")).toMatchObject({ source: "agent" });
  expect((await fetchBars(7496, "AAPL")).ok).toBe(true);
  expect((await fetchQuotes(7496, ["AAPL"])).ok).toBe(true);
  expect(spy).not.toHaveBeenCalled();
});

it("gives the demo sector table short English sectors, every row on, so the dashboard has suggestions", async () => {
  await ensureDemoSeeded(db, NOW);
  const rows = await db.sectors.toArray();
  expect(rows.map((r) => [r.ticker, r.category, r.status]).sort()).toEqual([
    ["AAPL", "Tech", "on"],
    ["AMD", "Semis", "on"],
    ["DIS", "Media", "on"],
    ["JPM", "Financials", "on"],
    ["KO", "Staples", "on"],
    ["MSFT", "Tech", "on"],
    ["NVDA", "Semis", "on"],
    ["XSP", "Index", "on"],
  ]);
  expect(positionSuggestions(rows, null).map((s) => s.ticker)).toEqual(expect.arrayContaining(["AAPL", "MSFT", "XSP", "JPM"]));
});

it("reseeds on another visit day, and the next agent pass reconciles with the new ledger", async () => {
  window.sessionStorage.setItem("ib2:demo", "1");
  await ensureDemoSeeded(db, DAY);
  vi.useFakeTimers({ toFake: ["Date"], now: DAY });
  await agentPass();
  // The tab is restored the next visit day: startup seeds again.
  vi.setSystemTime(NEXT_DAY);
  await ensureDemoSeeded(db);
  expect((await db.accounts.get("demo"))!.createdAt).toBe(NEXT_DAY.toISOString());
  const ids = (await db.transactions.where("accountId").equals("demo").toArray()).map((t) => t.externalId).sort();
  expect(ids).toEqual(generateDemo(NEXT_DAY).transactions.map((t) => t.externalId).sort());
  await agentPass();
  const rec = await reconciliation();
  expect(rec.differences).toEqual([]);
  expect(rec.orphans).toEqual([]);
});

it("keeps the seed's world in a tab left open past the visit day: the agent never reads the clock alone", async () => {
  window.sessionStorage.setItem("ib2:demo", "1");
  await ensureDemoSeeded(db, DAY);
  vi.useFakeTimers({ toFake: ["Date"], now: NEXT_DAY });
  await agentPass();
  const rec = await reconciliation();
  expect(rec.differences).toEqual([]);
  expect(rec.orphans).toEqual([]);
});
