import { render, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_URL } from "@/agent/client";
import { refreshPresence, resetAgentState } from "@/agent/useAgentSync";
import { SessionProvider } from "@/api/session";
import { AppDatabase, db, type AccountRecord } from "@/db/schema";
import { FLEX_SYNC_STALE_MS } from "./stale";
import { resetFlexAutoSyncState, useFlexAutoSync } from "./useFlexAutoSync";
import { syncAccount } from "./sync";

vi.mock("./sync", () => ({
  syncAccount: vi.fn(async (deps: { sendRequest: (input: { token: string; queryId: string }) => Promise<unknown> }) => {
    await deps.sendRequest({ token: "tok", queryId: "123" });
    return { status: "ok", report: {} };
  }),
}));

// A controllable stand-in for `useDb()`'s context value, used by exactly one test below (the
// one reproducing `DbProvider`'s post-login profile switch — see db/DbProvider.tsx and
// db/profile.ts). `vi.hoisted` so the plain store is available inside the (hoisted) `vi.mock`
// factory; every other test calls `testDb.set(db)` via `seed()` so it behaves exactly like the
// real, provider-less default context for them.
const testDb = vi.hoisted(() => {
  let current: unknown = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (next: unknown) => {
      current = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock("@/db/DbProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/DbProvider")>();
  const { useSyncExternalStore } = await import("react");
  return {
    ...actual,
    useDb: () => useSyncExternalStore(testDb.subscribe, testDb.get) as ReturnType<typeof actual.useDb>,
  };
});

const NOW = Date.now();
const BASE: AccountRecord = {
  id: "beta",
  label: "Beta",
  ibAccountId: "U1234567",
  createdAt: "2026-09-01T00:00:00.000Z",
  warnedDroppedKinds: [],
  flexToken: "tok",
  flexQueryId: "123",
};

let runHandle: () => Promise<void>;

function Probe() {
  const { run } = useFlexAutoSync("beta");
  runHandle = run;
  return null;
}

/** Session `authenticated`/`anonymous`, agent present or absent; every Flex call answers `<x/>`. */
function mockWorld({ loggedIn, agent }: { loggedIn: boolean; agent: boolean }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/auth/session")) {
      return loggedIn
        ? new Response(JSON.stringify({ data: { user: { id: 7, email: "a@example.com" } } }), { status: 200 })
        : new Response("{}", { status: 401 });
    }
    if (url === `${AGENT_URL}/health`) {
      if (!agent) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ version: "0.1.0" }), { status: 200 });
    }
    return new Response("<x/>", { status: 200 });
  });
}

function flexCalls(spy: ReturnType<typeof mockWorld>): string[] {
  return spy.mock.calls
    .map(([input]) => String(input instanceof Request ? input.url : input))
    .filter((url) => url.includes("/flex/"));
}

async function seed(overrides: Partial<AccountRecord>) {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.accounts.put({ ...BASE, ...overrides });
  testDb.set(db);
}

// No real <DbProvider> here on purpose: it would exercise its own profile-adoption dance
// (db/profile.ts) once `session` turns "authenticated" — an async database switch that is
// this hook's concern to *react to* (whatever `useDb()` returns), not to *drive*, and that
// dance already has its own dedicated coverage in DbProvider.test.tsx. `useDb()` is mocked
// above to read `testDb` instead, which every test but the last one points at the same `db`
// singleton `seed()` writes to (via `testDb.set(db)` inside `seed()`) — so, for them, it
// behaves exactly like the real provider-less default context.
function renderProbe() {
  render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
}

beforeEach(() => {
  vi.mocked(syncAccount).mockClear();
  resetAgentState();
  resetFlexAutoSyncState();
});
afterEach(() => vi.restoreAllMocks());

describe("useFlexAutoSync", () => {
  it("syncs on entering an account whose last sync is older than twelve hours", async () => {
    await seed({ lastFlexSyncAt: new Date(NOW - FLEX_SYNC_STALE_MS - 1000).toISOString(), flexRelay: "agent-and-server" });
    mockWorld({ loggedIn: true, agent: false });
    renderProbe();
    await waitFor(() => expect(syncAccount).toHaveBeenCalledTimes(1));
  });

  it("does not sync when the last sync is fresh", async () => {
    await seed({ lastFlexSyncAt: new Date(NOW - 60_000).toISOString(), flexRelay: "agent-and-server" });
    mockWorld({ loggedIn: true, agent: false });
    renderProbe();
    await waitFor(() => expect(syncAccount).not.toHaveBeenCalled());
  });

  it("does not sync in agent-and-server mode when nobody is logged in and the agent is absent", async () => {
    await seed({ lastFlexSyncAt: undefined, flexRelay: "agent-and-server" });
    mockWorld({ loggedIn: false, agent: false });
    renderProbe();
    await waitFor(() => expect(syncAccount).not.toHaveBeenCalled());
  });

  it("does not sync when the account has no token", async () => {
    await seed({ flexToken: undefined, lastFlexSyncAt: undefined, flexRelay: "agent-and-server" });
    mockWorld({ loggedIn: true, agent: false });
    renderProbe();
    await waitFor(() => expect(syncAccount).not.toHaveBeenCalled());
  });

  it("run() syncs whatever the staleness, once logged in", async () => {
    await seed({ lastFlexSyncAt: new Date(NOW - 60_000).toISOString(), flexRelay: "agent-and-server" });
    mockWorld({ loggedIn: true, agent: false });
    renderProbe();
    await waitFor(() => expect(runHandle).toBeDefined());
    await act(async () => {
      await runHandle();
    });
    expect(syncAccount).toHaveBeenCalledTimes(1);
  });

  it("only calls syncAccount once when two hook instances auto-trigger for the same account", async () => {
    // AppLayout and SourcesPage each call useFlexAutoSync(accountId) for the same account —
    // two independent hook instances, each with its own auto-trigger effect. The module-level
    // lock (not a per-instance useRef) is what has to keep them from both winning the race.
    await seed({ lastFlexSyncAt: new Date(NOW - FLEX_SYNC_STALE_MS - 1000).toISOString(), flexRelay: "agent-and-server" });
    mockWorld({ loggedIn: true, agent: false });

    function TwoProbes() {
      useFlexAutoSync("beta");
      useFlexAutoSync("beta");
      return null;
    }

    render(
      <SessionProvider>
        <TwoProbes />
      </SessionProvider>,
    );

    await waitFor(() => expect(syncAccount).toHaveBeenCalledTimes(1));
  });

  it("auto-triggers at most once per account even when useDb()'s instance identity changes afterwards", async () => {
    // Reproduces DbProvider's real post-login sequence (db/DbProvider.tsx, db/profile.ts):
    // once a session turns "authenticated", DbProvider adopts the default profile and later
    // swaps `useDb()`'s return value from the default `db` singleton to a fresh per-user
    // `AppDatabase` instance — same account data, different object identity. That swap alone,
    // with nothing about the account or the twelve-hour staleness actually changing, must
    // never be read as "the user entered a different account" and cause a second automatic
    // attempt: each one burns a real Flex `send-request` round trip against IB's own quota
    // (stale.ts's whole reason to exist).
    await seed({ lastFlexSyncAt: new Date(NOW - FLEX_SYNC_STALE_MS - 1000).toISOString(), flexRelay: "agent-and-server" });
    mockWorld({ loggedIn: true, agent: false });
    renderProbe();

    await waitFor(() => expect(syncAccount).toHaveBeenCalledTimes(1));

    const migrated = await db.accounts.get("beta");
    if (!migrated) throw new Error("expected the seeded account to still be there");
    const secondProfile = new AppDatabase("useFlexAutoSync-test-second-profile");
    await secondProfile.open();
    await secondProfile.accounts.put(migrated);
    testDb.set(secondProfile);

    // Give a wrongly-retriggered effect real time to fire and call the (instantly-resolving)
    // mock a second time before asserting it never did.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(syncAccount).toHaveBeenCalledTimes(1);

    await secondProfile.delete();
  });

  it("relays through the agent with no session at all, in the default mode, and never calls the server", async () => {
    await seed({ lastFlexSyncAt: undefined });
    const spy = mockWorld({ loggedIn: false, agent: true });
    renderProbe();
    await waitFor(() => expect(syncAccount).toHaveBeenCalledTimes(1));
    expect(vi.mocked(syncAccount).mock.calls[0]?.[0].relay).toBe("agent");
    await waitFor(() => expect(flexCalls(spy)).toEqual([`${AGENT_URL}/flex/send-request`]));
  });

  it("does not sync in the default mode when the agent is absent, even logged in, and records nothing", async () => {
    await seed({ lastFlexSyncAt: undefined });
    const spy = mockWorld({ loggedIn: true, agent: false });
    renderProbe();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(syncAccount).not.toHaveBeenCalled();
    expect(flexCalls(spy)).toEqual([]);
    expect((await db.accounts.get("beta"))?.lastFlexSyncStatus).toBeUndefined();
  });

  it("falls back on the server in agent-and-server mode when the agent is absent and a session is open", async () => {
    await seed({ lastFlexSyncAt: undefined, flexRelay: "agent-and-server" });
    const spy = mockWorld({ loggedIn: true, agent: false });
    renderProbe();
    await waitFor(() => expect(syncAccount).toHaveBeenCalledTimes(1));
    expect(vi.mocked(syncAccount).mock.calls[0]?.[0].relay).toBe("server");
    await waitFor(() => expect(flexCalls(spy)).toEqual([`${window.location.origin}/api/ib/flex/send-request`]));
  });

  it("prefers the agent in agent-and-server mode, session or not", async () => {
    await seed({ lastFlexSyncAt: undefined, flexRelay: "agent-and-server" });
    const spy = mockWorld({ loggedIn: true, agent: true });
    renderProbe();
    await waitFor(() => expect(syncAccount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(flexCalls(spy)).toEqual([`${AGENT_URL}/flex/send-request`]));
  });

  it("syncs once the agent shows up after the tab opened", async () => {
    await seed({ lastFlexSyncAt: undefined });
    let agentUp = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === `${AGENT_URL}/health`) {
        if (!agentUp) throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ version: "0.1.0" }), { status: 200 });
      }
      if (url.includes("/auth/session")) return new Response("{}", { status: 401 });
      return new Response("<x/>", { status: 200 });
    });
    renderProbe();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(syncAccount).not.toHaveBeenCalled();

    agentUp = true;
    await act(async () => {
      await refreshPresence(); // what useAgentPolling or the Sources page does
    });
    await waitFor(() => expect(syncAccount).toHaveBeenCalledTimes(1));
  });

  it("waits for the session to settle before an automatic attempt, even with the agent present", async () => {
    await seed({ lastFlexSyncAt: undefined });
    let settleSession: (() => void) | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/auth/session")) {
        return new Promise<Response>((resolve) => {
          settleSession = () => resolve(new Response("{}", { status: 401 }));
        });
      }
      if (url === `${AGENT_URL}/health`) return new Response(JSON.stringify({ version: "0.1.0" }), { status: 200 });
      return new Response("<x/>", { status: 200 });
    });
    renderProbe();
    await act(async () => {
      await refreshPresence();
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(syncAccount).not.toHaveBeenCalled();

    await act(async () => settleSession?.());
    await waitFor(() => expect(syncAccount).toHaveBeenCalledTimes(1));
  });

  it("does not sync a fresh account even with the agent present", async () => {
    await seed({ lastFlexSyncAt: new Date(NOW - 60_000).toISOString() });
    mockWorld({ loggedIn: false, agent: true });
    renderProbe();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(syncAccount).not.toHaveBeenCalled();
  });

  it("retries an attempt that left the account stale once the account is entered again", async () => {
    // The mocked syncAccount never writes `lastFlexSyncAt`, like a failed pass: presence and
    // session changes in the same visit must not repeat it, a new visit must.
    await seed({ lastFlexSyncAt: undefined });
    mockWorld({ loggedIn: false, agent: true });
    const view = render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(syncAccount).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(syncAccount).toHaveBeenCalledTimes(1);

    view.unmount();
    renderProbe();
    await waitFor(() => expect(syncAccount).toHaveBeenCalledTimes(2));
  });

  it("keeps the attempt while another instance stays on the account", async () => {
    // AppLayout's instance stays mounted while the Sources page's comes and goes: leaving the
    // Sources page must not forget the failed pass, nor let a later presence change repeat it.
    await seed({ lastFlexSyncAt: undefined });
    let agentUp = true;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === `${AGENT_URL}/health`) {
        if (!agentUp) throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ version: "0.1.0" }), { status: 200 });
      }
      if (url.includes("/auth/session")) return new Response("{}", { status: 401 });
      return new Response("<x/>", { status: 200 });
    });

    function SecondProbe() {
      useFlexAutoSync("beta");
      return null;
    }

    const view = render(
      <SessionProvider>
        <Probe />
        <SecondProbe />
      </SessionProvider>,
    );
    await waitFor(() => expect(syncAccount).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 100));

    view.rerender(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    // AppLayout's polling ticks see the agent vanish, then come back: its live instance
    // re-evaluates the auto-trigger on each flip.
    agentUp = false;
    await act(async () => {
      await refreshPresence();
    });
    agentUp = true;
    await act(async () => {
      await refreshPresence();
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(syncAccount).toHaveBeenCalledTimes(1);

    view.rerender(
      <SessionProvider>
        <Probe />
        <SecondProbe />
      </SessionProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(syncAccount).toHaveBeenCalledTimes(1);
  });

  it("does not record an attempt whose account was left while the agent was being pinged", async () => {
    await seed({ lastFlexSyncAt: undefined });
    let answerPing: (() => void) | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === `${AGENT_URL}/health`) {
        if (!answerPing) {
          await new Promise<void>((resolve) => {
            answerPing = resolve;
          });
        }
        return new Response(JSON.stringify({ version: "0.1.0" }), { status: 200 });
      }
      if (url.includes("/auth/session")) return new Response("{}", { status: 401 });
      return new Response("<x/>", { status: 200 });
    });
    const view = render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(answerPing).toBeDefined());
    view.unmount();
    answerPing?.();
    await waitFor(() => expect(syncAccount).toHaveBeenCalledTimes(1));

    renderProbe();
    await waitFor(() => expect(syncAccount).toHaveBeenCalledTimes(2));
  });
});
