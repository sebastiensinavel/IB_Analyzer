import { beforeEach, describe, expect, it } from "vitest";
import { alertStatus, autoAlerts, evaluateAlerts, manualAlerts, type Alert, type AlertState, INITIAL_STATE } from "@ib/alerts";
import { ACTIVABLE_STRATEGIES, buildJournals } from "@ib/ledger";
import type { AgentQuote } from "@ib/ib-parsers";
import { alertPriceOf } from "@/alerts/prices";
import { db } from "@/db/schema";
import { alertMargins } from "@/lib/alertMargins";
import { DEMO_TICKERS, closeAgo } from "@/demo/prices";
import { ensureDemoSeeded } from "@/demo/seed";

// Every weekday the reference day can fall on, and a Saturday (as generate.test.ts).
const VISITS = [
  "2026-09-28T12:00:00Z",
  "2026-09-25T23:30:00Z",
  "2026-09-26T15:00:00Z",
  "2026-11-18T19:00:00Z",
  "2026-09-29T15:00:00Z",
  "2026-10-01T18:00:00Z",
];

beforeEach(async () => {
  await Promise.all([db.accounts.clear(), db.transactions.clear(), db.snapshots.clear(), db.cashPoints.clear(), db.contracts.clear(), db.sectors.clear(), db.alerts.clear(), db.alertStates.clear()]);
});

describe.each(VISITS)("the demo alerts seen on %s", (visit) => {
  it("shows a triggered alert, an active one and the open XSP condor active", async () => {
    await ensureDemoSeeded(db, new Date(visit));
    const snapshot = (await db.snapshots.get("demo"))!;
    const account = (await db.accounts.get("demo"))!;
    const transactions = await db.transactions.where("accountId").equals("demo").toArray();
    const journals = buildJournals(transactions, { asOf: snapshot.asOf, positions: snapshot.positions }, undefined, ACTIVABLE_STRATEGIES);
    const defs = await db.alerts.where("accountId").equals("demo").toArray();
    const states = new Map<string, AlertState>();
    const alerts: Alert[] = [...manualAlerts(defs), ...autoAlerts(journals.rows, alertMargins(account), states)];
    // The price the engine really sees: the agent's snapshot for a held stock, /quotes otherwise.
    const quotes = new Map<string, AgentQuote>(DEMO_TICKERS.map((t) => [t, { last: closeAgo(t, 0), change: 0 }]));
    const priceOf = alertPriceOf({ ...snapshot, source: "agent" }, quotes);
    for (const { alertId, patch } of evaluateAlerts(alerts, states, priceOf, "2026-09-30T15:00:00.000Z")) {
      states.set(alertId, { alertId, ...INITIAL_STATE, ...states.get(alertId), ...patch });
    }
    const status = (a: Alert) => alertStatus(a, states.get(a.id) ?? { alertId: a.id, ...INITIAL_STATE });
    expect(status(alerts.find((a) => a.id === "manual:demo-nvda")!)).toBe("triggered");
    expect(status(alerts.find((a) => a.id === "manual:demo-msft")!)).toBe("active");
    const condor = alerts.find((a) => a.kind === "condor" && a.ticker === "XSP");
    expect(condor).toBeDefined();
    expect(status(condor!)).toBe("active");
  });
});

it("seeding the same day twice, or another day after, never duplicates an alert", async () => {
  await ensureDemoSeeded(db, new Date(VISITS[0]));
  await ensureDemoSeeded(db, new Date(VISITS[0]));
  expect((await db.alerts.where("accountId").equals("demo").toArray()).map((a) => a.id).sort()).toEqual(["manual:demo-msft", "manual:demo-nvda"]);
  await db.alertStates.put({ accountId: "demo", alertId: "manual:demo-nvda", ...INITIAL_STATE, triggeredAt: "x" });
  await ensureDemoSeeded(db, new Date(VISITS[4]));
  expect(await db.alerts.where("accountId").equals("demo").count()).toBe(2);
  expect(await db.alertStates.where("accountId").equals("demo").count()).toBe(0);
});
