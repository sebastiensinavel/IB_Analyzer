import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetQuotes } from "@/agent/quotes";
import { AGENT_POLL_MS, agentPresence, resetAgentState } from "@/agent/useAgentSync";
import { createManualAlert } from "@/db/alerts";
import { AppDatabase, db, type AccountRecord } from "@/db/schema";
import { FakeLocks } from "@/test/fakeLocks";
import { resetAnchorGuards } from "./anchors";
import { startAlertWatcher } from "./watcher";

const account = (id: string, fields: Partial<AccountRecord> = {}): AccountRecord => ({
  id,
  label: id,
  ibAccountId: "U1234567",
  createdAt: "2026-09-01T00:00:00.000Z",
  warnedDroppedKinds: [],
  ...fields,
});

// `syncAgent` checks the snapshot's single account against the account's `ibAccountId`.
const PAYLOAD = { accounts: ["U1234567"], fetchedAt: "2026-09-30T18:00:00.000Z", cashAvailable: 1, positions: [], executions: [] };

/** The most /health calls in flight at once since the last `mockAgent`: nothing but the watcher serializes them. */
let healthInFlight = 0;
let healthMost = 0;

/**
 * The agent: /health (absent unless `present`), /snapshot per port (`down` ports answer 503,
 * each answer after `snapshotDelayMs`), /quotes answering `last` for every asked symbol. Counts
 * calls by path and port (`?port=N`, as `agent/client.ts` sends it).
 */
function mockAgent({ present = true, down = [] as number[], last = 244, snapshotDelayMs = 0, healthDelayMs = 0 } = {}) {
  const calls: string[] = [];
  healthInFlight = 0;
  healthMost = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const port = url.searchParams.get("port");
    calls.push(`${url.pathname}${port ? `:${port}` : ""}`);
    if (url.pathname === "/health") {
      healthInFlight += 1;
      healthMost = Math.max(healthMost, healthInFlight);
      try {
        if (healthDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, healthDelayMs));
      } finally {
        healthInFlight -= 1;
      }
      if (!present) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ version: "0.1.0" }), { status: 200 });
    }
    if (url.pathname === "/snapshot") {
      if (snapshotDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, snapshotDelayMs));
      if (down.includes(Number(port))) return new Response("", { status: 503 });
      return new Response(JSON.stringify(PAYLOAD), { status: 200 });
    }
    if (url.pathname === "/quotes") {
      const symbols = (url.searchParams.get("symbols") ?? "").split(",").filter(Boolean);
      return new Response(
        JSON.stringify({ fetchedAt: "2026-09-30T18:00:00.000Z", quotes: symbols.map((symbol) => ({ symbol, last, close: 250 })) }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 200 });
  });
  return calls;
}

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static created: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  title: string;
  constructor(title: string) {
    this.title = title;
    FakeNotification.created.push(this);
  }
}

const snapshots = (calls: string[]) => calls.filter((c) => c.startsWith("/snapshot"));
const flush = () => vi.advanceTimersByTimeAsync(50);
const stops: (() => void)[] = [];
function start(deps: Partial<Parameters<typeof startAlertWatcher>[0]> = {}) {
  const stop = startAlertWatcher({ db, open: vi.fn(), locks: null, ...deps });
  stops.push(stop);
  return stop;
}

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-09-30T18:00:00.000Z"));
  resetAgentState();
  resetQuotes();
  resetAnchorGuards();
  FakeNotification.created = [];
  vi.stubGlobal("Notification", FakeNotification);
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

afterEach(() => {
  while (stops.length > 0) stops.pop()?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("startAlertWatcher", () => {
  it("triggers and notifies another account's alert with no account page mounted", async () => {
    mockAgent({ last: 244 });
    await db.accounts.bulkAdd([account("alpha", { twsPort: 7501 }), account("beta", { twsPort: 7502 })]);
    await createManualAlert(db, "beta", { ticker: "AAPL", price: 245, direction: "below", note: null });
    const open = vi.fn();
    start({ open });
    await vi.waitFor(() => expect(FakeNotification.created.map((n) => n.title)).toEqual(["beta · AAPL ↓ 245,00"]));
    FakeNotification.created[0].onclick?.();
    expect(open).toHaveBeenCalledWith("/accounts/beta/alerts");
  });

  it("never calls the agent for an account without a TWS port", async () => {
    const calls = mockAgent();
    await db.accounts.bulkAdd([account("alpha"), account("beta", { twsPort: 7502 })]);
    start();
    await vi.waitFor(() => expect(snapshots(calls)).toEqual(["/snapshot:7502"]));
  });

  it("writes nothing when the agent is absent", async () => {
    mockAgent({ present: false });
    await db.accounts.add(account("beta", { twsPort: 7502 }));
    await createManualAlert(db, "beta", { ticker: "AAPL", price: 245, direction: "below", note: null });
    start();
    await flush();
    expect(await db.alertStates.count()).toBe(0);
    expect((await db.accounts.get("beta"))?.lastAgentSyncAt).toBeUndefined();
  });

  it("still evaluates beta when alpha's TWS is unreachable", async () => {
    mockAgent({ down: [7501], last: 244 });
    await db.accounts.bulkAdd([account("alpha", { twsPort: 7501 }), account("beta", { twsPort: 7502 })]);
    await createManualAlert(db, "alpha", { ticker: "AAPL", price: 245, direction: "below", note: null });
    await createManualAlert(db, "beta", { ticker: "AAPL", price: 245, direction: "below", note: null });
    start();
    await vi.waitFor(() => expect(FakeNotification.created.map((n) => n.title)).toEqual(["beta · AAPL ↓ 245,00"]));
  });

  it("passes every five minutes with its tab hidden", async () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    try {
      const calls = mockAgent();
      await db.accounts.add(account("beta", { twsPort: 7502 }));
      start();
      await vi.waitFor(() => expect(snapshots(calls)).toHaveLength(1));
      await vi.advanceTimersByTimeAsync(AGENT_POLL_MS);
      await vi.waitFor(() => expect(snapshots(calls)).toHaveLength(2));
    } finally {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    }
  });

  it("never runs two passes at once, and arms the next one at the end of a pass", async () => {
    let inFlight = 0;
    let most = 0;
    const calls = mockAgent({ snapshotDelayMs: AGENT_POLL_MS * 2 });
    const mocked = vi.mocked(globalThis.fetch);
    const answer = mocked.getMockImplementation()!;
    mocked.mockImplementation(async (input, init) => {
      const isSnapshot = String(input instanceof Request ? input.url : input).includes("/snapshot");
      if (isSnapshot) {
        inFlight += 1;
        most = Math.max(most, inFlight);
      }
      try {
        return await answer(input, init);
      } finally {
        if (isSnapshot) inFlight -= 1;
      }
    });
    await db.accounts.add(account("beta", { twsPort: 7502 }));
    const stop = start();
    await vi.advanceTimersByTimeAsync(AGENT_POLL_MS * 5);
    // A pass's base writes run on real time (fake-indexeddb): keep the clock going until a second pass started.
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_POLL_MS);
      expect(snapshots(calls).length).toBeGreaterThan(1);
    });
    expect(most).toBe(1);
    // Lets the pass in flight answer: its delayed /snapshot holds the TWS queue, which the next tests share.
    stop();
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_POLL_MS);
      expect(inFlight).toBe(0);
    });
    await flush();
  });

  it("passes at once when an account gains a TWS port", async () => {
    const calls = mockAgent();
    await db.accounts.add(account("beta"));
    start();
    await flush();
    expect(snapshots(calls)).toEqual([]);
    await db.accounts.update("beta", { twsPort: 7502 });
    await vi.waitFor(() => expect(snapshots(calls)).toEqual(["/snapshot:7502"]));
  });

  it("never probes the agent while no account has a TWS port", async () => {
    const calls = mockAgent();
    await db.accounts.bulkAdd([account("alpha"), account("beta")]);
    start();
    await flush();
    await vi.advanceTimersByTimeAsync(AGENT_POLL_MS);
    await flush();
    expect(calls.filter((c) => c === "/health")).toEqual([]);
  });

  it("never starts a pass while another runs, even when one is asked for", async () => {
    // /health opens each pass and nothing else serializes it: two passes at once would overlap there.
    const calls = mockAgent({ healthDelayMs: 30_000 });
    await db.accounts.bulkAdd([account("alpha"), account("beta", { twsPort: 7502 })]);
    const stop = start();
    await vi.waitFor(() => expect(calls.filter((c) => c === "/health")).toHaveLength(1));
    await db.accounts.update("alpha", { twsPort: 7501 });
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
      expect(snapshots(calls)).toEqual(["/snapshot:7502", "/snapshot:7501", "/snapshot:7502"]);
    });
    expect(healthMost).toBe(1);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
  });

  it("plays a pass asked for during another right after it", async () => {
    const calls = mockAgent({ snapshotDelayMs: 60_000 });
    await db.accounts.bulkAdd([account("alpha"), account("beta", { twsPort: 7502 })]);
    const stop = start();
    await vi.waitFor(() => expect(snapshots(calls)).toHaveLength(1));
    // alpha gains a port while beta's pass waits on TWS: the next pass runs both, after this one.
    await db.accounts.update("alpha", { twsPort: 7501 });
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
      expect(snapshots(calls)).toEqual(["/snapshot:7502", "/snapshot:7501", "/snapshot:7502"]);
    });
    // Drains the pass in flight: its delayed /snapshot holds the TWS queue, which the next tests share.
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    await flush();
  });

  it("passes in one tab only, and the other takes over when the first stops", async () => {
    const calls = mockAgent();
    await db.accounts.add(account("beta", { twsPort: 7502 }));
    const locks = new FakeLocks();
    const first = start({ locks });
    start({ locks });
    await vi.waitFor(() => expect(snapshots(calls)).toHaveLength(1));
    await flush();
    expect(snapshots(calls)).toHaveLength(1);
    first();
    await vi.waitFor(() => expect(snapshots(calls)).toHaveLength(2));
  });

  it("a tab that does not lead still probes the agent", async () => {
    mockAgent();
    await db.accounts.add(account("beta", { twsPort: 7502 }));
    const locks = new FakeLocks();
    // Another tab holds the lock forever — never awaited: it never settles.
    void locks.request("ib2:watcher:" + db.name, () => new Promise(() => {}));
    start({ locks });
    await vi.waitFor(() => expect(agentPresence().status).toBe("present"));
  });

  it("releases its lock when stopped, and a watcher stopped while waiting never passes", async () => {
    const calls = mockAgent();
    await db.accounts.add(account("beta", { twsPort: 7502 }));
    const locks = new FakeLocks();
    const first = start({ locks });
    const second = start({ locks });
    second();
    await vi.waitFor(() => expect(locks.held("ib2:watcher:" + db.name)).toBe(true));
    first();
    await flush();
    expect(locks.held("ib2:watcher:" + db.name)).toBe(false);
    expect(snapshots(calls)).toHaveLength(1);
  });

  it("takes one lock per base: the demo base's watcher does not wait behind the real one's", async () => {
    mockAgent();
    const demo = new AppDatabase("ib-analyzer-demo-locktest");
    await demo.open();
    const locks = new FakeLocks();
    try {
      start({ locks });
      start({ db: demo, locks });
      await vi.waitFor(() => {
        expect(locks.held("ib2:watcher:" + db.name)).toBe(true);
        expect(locks.held("ib2:watcher:ib-analyzer-demo-locktest")).toBe(true);
      });
    } finally {
      while (stops.length > 0) stops.pop()?.();
      demo.close();
      await AppDatabase.delete("ib-analyzer-demo-locktest");
    }
  });
});
