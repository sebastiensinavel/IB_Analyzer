import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "@/db/schema";
import { ensureDemoSeeded } from "@/demo/seed";
import { syncAgent } from "@/agent/sync";
import { fetchBars, fetchQuotes, fetchSnapshot, probeAgent } from "@/agent/client";

const NOW = new Date("2026-09-25T19:00:00Z");

beforeEach(async () => {
  await Promise.all([db.accounts.clear(), db.transactions.clear(), db.snapshots.clear(), db.cashPoints.clear(), db.sectors.clear()]);
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

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
  const outcome = await syncAgent({ db, fetchSnapshot, now: () => NOW }, (await db.accounts.get("demo"))!);
  expect(outcome.status).toBe("ok");
  expect(await db.snapshots.get("demo")).toMatchObject({ source: "agent" });
  expect((await fetchBars(7496, "AAPL")).ok).toBe(true);
  expect((await fetchQuotes(7496, ["AAPL"])).ok).toBe(true);
  expect(spy).not.toHaveBeenCalled();
});
