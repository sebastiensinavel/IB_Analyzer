import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Position, Transaction } from "@ib/ledger";
import { mergeQuotes, resetQuotes } from "@/agent/quotes";
import { refreshPresence, resetAgentState } from "@/agent/useAgentSync";
import { AccountDataProvider, useAccountAlerts } from "@/db/AccountDataProvider";
import { setActiveStrategies } from "@/db/accounts";
import { createManualAlert } from "@/db/alerts";
import { useActiveStrategies, useJournals } from "@/db/hooks";
import { db, type AccountRecord, type AlertStateRecord, type SnapshotRecord } from "@/db/schema";
import { SAMPLE_JOURNAL_TRANSACTIONS } from "@/mocks/journals";
import { useAlertEngine, type AlertsView } from "./useAlertEngine";

const account = (id: string, fields: Partial<AccountRecord> = {}): AccountRecord => ({
  id, label: id, ibAccountId: "U0000000", createdAt: "2026-09-01T00:00:00.000Z", warnedDroppedKinds: [], ...fields,
});

function trade(overrides: Partial<Transaction>): Transaction {
  return {
    accountId: "beta", externalId: "", source: "flex", kind: "trade", symbol: "", secType: "OPT", right: "", strike: null, expiry: null,
    quantity: null, price: null, amount: null, commission: -1, currency: "USD", when: "", description: "", ...overrides,
  };
}

function position(overrides: Partial<Position>): Position {
  return {
    symbol: "", secType: "OPT", right: "", strike: null, expiry: null, multiplier: 100, quantity: 0, avgPrice: null,
    marketPrice: null, marketValue: null, unrealizedPnl: null, dailyPnl: null, dayChange: null, currency: "USD", conid: "", description: "", ...overrides,
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

const CALL_SOLD = "2026-09-29T14:30:00.000Z";
/** MQZA assigned at 17, then a call 15 sold under it: a Wheel alert, its S₀ still to observe. */
const WHEEL_TRANSACTIONS: Transaction[] = [
  ...SAMPLE_JOURNAL_TRANSACTIONS.slice(0, 5),
  trade({ externalId: "flex:trade:301", symbol: "MQZA  261016C00015000", right: "C", strike: 15, expiry: "2026-10-16", quantity: -2, price: 0.4, amount: 80, when: CALL_SOLD }),
];

let writes: string[] = [];
const onCreate = (_key: unknown, obj: AlertStateRecord) => {
  writes.push(`${obj.accountId}|${obj.alertId}`);
};
const onUpdate = (_mods: unknown, _key: unknown, obj: AlertStateRecord) => {
  writes.push(`${obj.accountId}|${obj.alertId}`);
};

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static created: string[] = [];
  onclick: (() => void) | null = null;
  constructor(title: string) {
    FakeNotification.created.push(title);
  }
}

/** Routes /health; counts /bars; every other call is a 200 `{}`. */
function mockAgent() {
  const calls = { bars: 0 };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/health")) return new Response(JSON.stringify({ version: "0.1.0" }), { status: 200 });
    if (url.includes("/bars")) calls.bars += 1;
    return new Response("{}", { status: 200 });
  });
  return calls;
}

let view: AlertsView = { status: "loading" };
function AlertsProbe() {
  const current = useAccountAlerts();
  useEffect(() => {
    view = current;
  }, [current]);
  return <p>{current.status === "ready" ? `alerts ${current.alerts.length} / triggered ${current.badges.all}` : "loading"}</p>;
}

function renderProvider(accountId: string, children: ReactNode = <AlertsProbe />) {
  return render(
    <MemoryRouter>
      <AccountDataProvider accountId={accountId}>{children}</AccountDataProvider>
    </MemoryRouter>,
  );
}

/** The engine fed journals held in loading until `ready`, as the provider would during a replay. */
function Harness({ accountId, ready }: { accountId: string; ready: boolean }) {
  const strategies = useActiveStrategies(accountId);
  const journals = useJournals(accountId, strategies);
  const result = useAlertEngine(accountId, ready ? journals : { status: "loading" }, null);
  return <p>{result.status}</p>;
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 60)));
const stateOf = (accountId: string, alertId: string) => db.alertStates.get([accountId, alertId]);

beforeEach(async () => {
  resetQuotes();
  resetAgentState();
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  writes = [];
  db.alertStates.hook("creating", onCreate);
  db.alertStates.hook("updating", onUpdate);
  FakeNotification.created = [];
  vi.stubGlobal("Notification", FakeNotification);
});

afterEach(() => {
  db.alertStates.hook("creating").unsubscribe(onCreate);
  db.alertStates.hook("updating").unsubscribe(onUpdate);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetQuotes();
  resetAgentState();
});

describe("useAlertEngine", () => {
  it("triggers a manual alert crossed by the quote, notifies once, and writes nothing on the next pass", async () => {
    await db.accounts.add(account("beta"));
    const aapl = await createManualAlert(db, "beta", { ticker: "AAPL", price: 245, direction: "below" });
    const msft = await createManualAlert(db, "beta", { ticker: "MSFT", price: 400, direction: "above" });
    renderProvider("beta");
    await screen.findByText("alerts 2 / triggered 0");

    act(() => mergeQuotes(new Map([["AAPL", { last: 244, change: null }]])));
    await screen.findByText("alerts 2 / triggered 1");
    const first = await stateOf("beta", aapl);
    expect(first?.triggeredAt).not.toBeNull();
    expect(writes).toEqual([`beta|${aapl}`]);

    // A second pass: AAPL still under its threshold, MSFT now over its own. Only MSFT is written.
    act(() => mergeQuotes(new Map([["AAPL", { last: 243, change: null }], ["MSFT", { last: 401, change: null }]])));
    await screen.findByText("alerts 2 / triggered 2");
    await settle();
    expect(writes).toEqual([`beta|${aapl}`, `beta|${msft}`]);
    expect((await stateOf("beta", aapl))?.triggeredAt).toBe(first?.triggeredAt);
    expect(FakeNotification.created).toEqual(["AAPL ↓ 245.00", "MSFT ↑ 400.00"]);
  });

  it("triggers an open condor whose underlying enters the zone, counted in the Condors badge", async () => {
    await db.accounts.add(account("beta"));
    await setActiveStrategies(db, "beta", ["wheel", "condors"]);
    await db.transactions.bulkAdd(CONDOR_TRANSACTIONS);
    renderProvider("beta");
    await screen.findByText("alerts 1 / triggered 0");
    act(() => mergeQuotes(new Map([["QQQ", { last: 612, change: null }]])));
    await screen.findByText("alerts 1 / triggered 1");
    if (view.status !== "ready") throw new Error("not ready");
    expect(view.badges).toEqual({ all: 1, wheel: 0, leaps: 0, condors: 1, others: 0 });
    expect(view.alerts[0]).toMatchObject({ status: "triggered", price: { price: 612, realtime: false } });
    // 612 is past the 616 threshold by 4, as a fraction of the price: negative, since crossed.
    expect(view.alerts[0].distance).toBeCloseTo(-4 / 612, 6);
  });

  it("never purges an orphan state while the journals load, and purges it once they are ready", async () => {
    await db.accounts.add(account("beta"));
    await db.alertStates.put({ accountId: "beta", alertId: "wheel:gone", triggeredAt: null, acknowledgedAt: null, disabled: false, armed: true, anchor: null, override: null });
    const { rerender } = render(
      <MemoryRouter>
        <Harness accountId="beta" ready={false} />
      </MemoryRouter>,
    );
    await settle();
    expect(await stateOf("beta", "wheel:gone")).toBeDefined();
    rerender(
      <MemoryRouter>
        <Harness accountId="beta" ready />
      </MemoryRouter>,
    );
    await waitFor(async () => expect(await stateOf("beta", "wheel:gone")).toBeUndefined());
  });

  it("never purges another account's states", async () => {
    await db.accounts.bulkAdd([account("alpha"), account("beta")]);
    const orphan = { triggeredAt: null, acknowledgedAt: null, disabled: false, armed: true, anchor: null, override: null };
    await db.alertStates.bulkPut([
      { accountId: "alpha", alertId: "wheel:gone", ...orphan },
      { accountId: "beta", alertId: "wheel:kept", ...orphan },
    ]);
    renderProvider("alpha");
    await waitFor(async () => expect(await stateOf("alpha", "wheel:gone")).toBeUndefined());
    await settle();
    expect(await stateOf("beta", "wheel:kept")).toBeDefined();
  });

  it("never purges the next account's states on the previous account's journals, right after a switch", async () => {
    await db.accounts.bulkAdd([account("alpha"), account("beta")]);
    await db.transactions.bulkAdd(WHEEL_TRANSACTIONS);
    const id = "wheel:MQZA|OPT|C|15|2026-10-16|USD";
    const anchor = { price: 14, source: "live" as const, observedAt: "2026-09-29T18:35:00.000Z" };
    await db.alertStates.put({ accountId: "beta", alertId: id, triggeredAt: null, acknowledgedAt: null, disabled: false, armed: true, anchor, override: null });
    const { rerender } = renderProvider("alpha");
    await screen.findByText("alerts 0 / triggered 0");
    rerender(
      <MemoryRouter>
        <AccountDataProvider accountId="beta">
          <AlertsProbe />
        </AccountDataProvider>
      </MemoryRouter>,
    );
    await screen.findByText("alerts 1 / triggered 0");
    await settle();
    expect((await stateOf("beta", id))?.anchor).toEqual(anchor);
  });

  it("observes S₀ on the agent snapshot taken five minutes after the sale, once, without asking for bars", async () => {
    const calls = mockAgent();
    await refreshPresence();
    await db.accounts.add(account("beta", { twsPort: 7502, lastAgentSyncAt: "2026-09-29T18:35:00.000Z" }));
    await db.transactions.bulkAdd(WHEEL_TRANSACTIONS);
    const snapshot: SnapshotRecord = {
      accountId: "beta", source: "agent", asOf: "2026-09-29T14:35:00.000Z", importedAt: "2026-09-29T18:35:00.000Z", cashAvailable: null,
      positions: [
        position({ symbol: "MQZA", secType: "STK", multiplier: 1, quantity: 200, marketPrice: 14 }),
        position({ symbol: "MQZA", right: "C", strike: 15, expiry: "2026-10-16", quantity: -2, marketPrice: 0.3 }),
      ],
    };
    await db.snapshots.put(snapshot);
    renderProvider("beta");
    await screen.findByText("alerts 1 / triggered 0");
    const id = "wheel:MQZA|OPT|C|15|2026-10-16|USD";
    await waitFor(async () => expect((await stateOf("beta", id))?.anchor).toMatchObject({ price: 14, source: "live" }));
    await settle();
    expect(writes).toEqual([`beta|${id}`]);
    expect(calls.bars).toBe(0);
    if (view.status !== "ready" || view.alerts[0].alert.kind !== "wheel") throw new Error("no wheel alert");
    // 14 + (15 − 14) × 0.7
    expect(view.alerts[0].alert.thresholds).toEqual([{ price: 14.7, direction: "above" }]);
  });
});
