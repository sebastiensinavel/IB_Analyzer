import { render } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, type AccountRecord } from "@/db/schema";
import { resetAgentState, runAgentSync, useAgentSync } from "./useAgentSync";

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

function Probe({ accountId = "beta" }: { accountId?: string }) {
  runHandle = useAgentSync(accountId).run;
  return null;
}

beforeEach(async () => {
  resetAgentState();
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.accounts.put(ACCOUNT);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useAgentSync", () => {
  it("never runs two passes of one account at once", async () => {
    const calls = mockAgent();
    render(<Probe />);
    await act(async () => {
      await Promise.all([runHandle(), runHandle()]);
    });
    expect(calls.snapshot).toBe(1);
  });
});

describe("runAgentSync", () => {
  it("syncs the account and answers the outcome", async () => {
    const calls = mockAgent();
    expect(await runAgentSync(db, "beta")).toMatchObject({ status: "ok" });
    expect(calls.snapshot).toBe(1);
  });

  it("answers null for an account already syncing, and does not call the agent twice", async () => {
    const calls = mockAgent();
    const [first, second] = await Promise.all([runAgentSync(db, "beta"), runAgentSync(db, "beta")]);
    expect([first?.status, second]).toEqual(["ok", null]);
    expect(calls.snapshot).toBe(1);
  });

  it("answers null for an unknown account", async () => {
    mockAgent();
    expect(await runAgentSync(db, "nobody")).toBeNull();
  });
});
