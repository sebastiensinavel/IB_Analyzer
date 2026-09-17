import { render, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, type AccountRecord } from "@/db/schema";
import { AGENT_POLL_MS, resetAgentState, useAgentPolling, useAgentSync } from "./useAgentSync";

const ACCOUNT: AccountRecord = {
  id: "beta",
  label: "Beta",
  ibAccountId: "U1234567",
  createdAt: "2026-09-01T00:00:00.000Z",
  warnedDroppedKinds: [],
  twsPort: 7502,
};

const PAYLOAD = { accounts: ["U1234567"], fetchedAt: "2026-09-06T13:02:11.482Z", cashAvailable: 1, positions: [], executions: [] };

/** Routes the two agent URLs; every other call is a 200 `{}`. */
function mockAgent(present = true) {
  const calls = { health: 0, snapshot: 0 };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/health")) {
      calls.health += 1;
      return present ? new Response(JSON.stringify({ version: "0.1.0" }), { status: 200 }) : Promise.reject(new TypeError("Failed to fetch"));
    }
    if (url.includes("/snapshot")) {
      calls.snapshot += 1;
      return new Response(JSON.stringify(PAYLOAD), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  return calls;
}

let runHandle: () => Promise<void>;
let lastPresence: string;

function Probe({ accountId = "beta" }: { accountId?: string }) {
  useAgentPolling(accountId);
  const { run, presence } = useAgentSync(accountId);
  runHandle = run;
  lastPresence = presence.status;
  return null;
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(async () => {
  // `shouldAdvanceTime`: Testing Library's `waitFor` polls with the (faked) timers and would
  // otherwise never tick; letting the fake clock follow real time keeps `waitFor` alive while
  // `advanceTimersByTimeAsync` still jumps the five-minute cadence at will.
  //
  // `toFake` deliberately excludes `setImmediate`: fake-indexeddb schedules an IDBTransaction's
  // auto-commit with it (see its lib/scheduling.ts), and faking it too lets that auto-commit
  // race ahead of Dexie's own awaited calls inside `db.transaction(...)`, throwing
  // `TransactionInactiveError` from `syncAgent` on every run — reproduced with a bare
  // `syncAgent()` call, no React involved, so it is not this hook's bug. `setTimeout`,
  // `clearTimeout` and `Date` are the only globals this hook and these assertions ever touch.
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout", "Date"] });
  resetAgentState();
  setVisibility("visible");
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.accounts.put(ACCOUNT);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("useAgentPolling", () => {
  it("probes at account open and passes at once when the agent is present and a port is set", async () => {
    const calls = mockAgent();
    render(<Probe />);
    await waitFor(() => expect(calls.snapshot).toBe(1));
    expect(calls.health).toBe(1);
    expect(lastPresence).toBe("present");
    expect((await db.accounts.get("beta"))?.lastAgentSyncStatus?.ok).toBe(true);
  });

  it("does nothing at all without a port", async () => {
    await db.accounts.update("beta", { twsPort: undefined });
    const calls = mockAgent();
    render(<Probe />);
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_POLL_MS);
    });
    expect(calls).toEqual({ health: 0, snapshot: 0 });
    expect(lastPresence).toBe("unknown");
  });

  it("marks the agent absent, never passes, and probes again at the next tick", async () => {
    const calls = mockAgent(false);
    render(<Probe />);
    await waitFor(() => expect(lastPresence).toBe("absent"));
    expect(calls.snapshot).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_POLL_MS);
    });
    expect(calls.health).toBe(2);
    expect(calls.snapshot).toBe(0);
  });

  it("passes every five minutes while the tab is visible", async () => {
    const calls = mockAgent();
    // The margin is computed, not guessed: `shouldAdvanceTime` nudges the fake clock to follow
    // real time in 20 ms steps, so `waitFor` always consumes tens of milliseconds of fake clock
    // before it can observe anything — and more on a slower machine. Anchoring on the clock
    // reading from before the render makes the total advance exactly AGENT_POLL_MS - 1 however
    // long the first pass really took, and the timer is armed strictly after that reading, so it
    // cannot have fired yet.
    const startedAt = Date.now();
    render(<Probe />);
    await waitFor(() => expect(calls.snapshot).toBe(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_POLL_MS - (Date.now() - startedAt) - 1);
    });
    expect(calls.snapshot).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_POLL_MS);
    });
    await waitFor(() => expect(calls.snapshot).toBe(2));
  });

  it("skips ticks while the tab is hidden and passes at once when it comes back after more than five minutes", async () => {
    const calls = mockAgent();
    render(<Probe />);
    await waitFor(() => expect(calls.snapshot).toBe(1));
    setVisibility("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_POLL_MS * 2);
    });
    expect(calls.snapshot).toBe(1);
    setVisibility("visible");
    await waitFor(() => expect(calls.snapshot).toBe(2));
  });

  it("does not pass on a short absence", async () => {
    const calls = mockAgent();
    render(<Probe />);
    await waitFor(() => expect(calls.snapshot).toBe(1));
    setVisibility("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    setVisibility("visible");
    await settle();
    expect(calls.snapshot).toBe(1);
  });

  it("a manual run resets the five-minute countdown", async () => {
    const calls = mockAgent();
    render(<Probe />);
    await waitFor(() => expect(calls.snapshot).toBe(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_POLL_MS / 2);
    });
    await act(async () => {
      await runHandle();
    });
    expect(calls.snapshot).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_POLL_MS / 2);
    });
    expect(calls.snapshot).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_POLL_MS / 2);
    });
    await waitFor(() => expect(calls.snapshot).toBe(3));
  });

  it("starts as soon as a port is saved", async () => {
    await db.accounts.update("beta", { twsPort: undefined });
    const calls = mockAgent();
    render(<Probe />);
    await settle();
    expect(calls.snapshot).toBe(0);
    await db.accounts.update("beta", { twsPort: 7502 });
    await waitFor(() => expect(calls.snapshot).toBe(1));
  });

  it("stops polling the previous account on a switch", async () => {
    await db.accounts.put({ ...ACCOUNT, id: "alpha", ibAccountId: "U7654321", twsPort: undefined });
    const calls = mockAgent();
    const view = render(<Probe />);
    await waitFor(() => expect(calls.snapshot).toBe(1));
    view.rerender(<Probe accountId="alpha" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_POLL_MS * 2);
    });
    expect(calls.snapshot).toBe(1);
  });
});

describe("useAgentSync", () => {
  it("never runs two passes of one account at once", async () => {
    const calls = mockAgent();
    render(<Probe />);
    await waitFor(() => expect(calls.snapshot).toBe(1));
    await act(async () => {
      await Promise.all([runHandle(), runHandle()]);
    });
    expect(calls.snapshot).toBe(2);
  });
});
