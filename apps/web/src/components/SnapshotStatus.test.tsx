import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { refreshPresence, resetAgentState } from "@/agent/useAgentSync";
import { SnapshotStatus } from "@/components/SnapshotStatus";
import { db, type AccountRecord, type SnapshotRecord } from "@/db/schema";
import { formatClockTime } from "@/lib/format";

const ACCOUNT: AccountRecord = { id: "alpha", label: "alpha", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [], twsPort: 7502 };
const flexSnapshot: SnapshotRecord = { accountId: "alpha", source: "flex", asOf: "2026-09-05", importedAt: "", positions: [], cashAvailable: null };
// `asOf` is New York's wall clock stamped UTC; `lastAgentSyncAt` is the true instant of the
// same pass, four hours later on the UTC scale in September.
const agentSnapshot: SnapshotRecord = { ...flexSnapshot, source: "agent", asOf: "2026-09-06T09:02:00.000Z" };
const LAST_AGENT_SYNC_AT = "2026-09-06T13:02:01.000Z";

function mockAgent(present: boolean) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/health")) {
      return present ? new Response(JSON.stringify({ version: "0.1.0" }), { status: 200 }) : Promise.reject(new TypeError("Failed to fetch"));
    }
    return new Response(JSON.stringify({ accounts: ["U0000001"], fetchedAt: "2026-09-06T13:10:00.000Z", cashAvailable: 1, positions: [], executions: [] }), { status: 200 });
  });
}

function renderStatus() {
  return render(
    <MemoryRouter>
      <SnapshotStatus accountId="alpha" />
    </MemoryRouter>,
  );
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

describe("SnapshotStatus", () => {
  it("dates a Flex snapshot, in the warning tone, like before", async () => {
    await db.snapshots.put(flexSnapshot);
    renderStatus();
    const badge = await screen.findByText("Données du 2026-09-05");
    expect(badge).toBeInTheDocument();
    // The tone, not just the text: swapping warning/success between the two
    // branches must fail this test, not just the "live" one below.
    expect(badge).toHaveClass("text-warning");
  });

  it("dates a statement snapshot exactly like a Flex one", async () => {
    await db.snapshots.put({ ...flexSnapshot, source: "statement_html", asOf: "2025-12-31" });
    renderStatus();
    const badge = await screen.findByText("Données du 2025-12-31");
    expect(badge).toHaveClass("text-warning");
  });

  it("says live with the wall-clock time of the last agent pass, never the snapshot's New York time", async () => {
    await db.snapshots.put(agentSnapshot);
    await db.accounts.update("alpha", { lastAgentSyncAt: LAST_AGENT_SYNC_AT });
    renderStatus();
    const badge = await screen.findByText(`En direct, ${formatClockTime(LAST_AGENT_SYNC_AT)}`);
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass("text-success");
    expect(screen.queryByText(`En direct, ${formatClockTime(agentSnapshot.asOf)}`)).not.toBeInTheDocument();
  });

  it("says live with a dash when no agent pass time is known", async () => {
    await db.snapshots.put(agentSnapshot);
    renderStatus();
    expect(await screen.findByText("En direct, —")).toBeInTheDocument();
  });

  it("shows no button while the agent is not detected", async () => {
    mockAgent(false);
    await refreshPresence();
    renderStatus();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Actualiser" })).not.toBeInTheDocument());
  });

  it("shows no button without a port even when the agent is there", async () => {
    mockAgent(true);
    await refreshPresence();
    await db.accounts.update("alpha", { twsPort: undefined });
    renderStatus();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Actualiser" })).not.toBeInTheDocument());
  });

  it("shows the button once the agent is present, and a click runs a pass", async () => {
    mockAgent(true);
    await refreshPresence();
    renderStatus();
    const button = await screen.findByRole("button", { name: "Actualiser" });
    await userEvent.setup().click(button);
    await waitFor(async () => expect((await db.snapshots.get("alpha"))?.source).toBe("agent"));
    const syncedAt = (await db.accounts.get("alpha"))?.lastAgentSyncAt;
    expect(await screen.findByText(`En direct, ${formatClockTime(syncedAt!)}`)).toBeInTheDocument();
  });

  it("names the cause of the last failed pass, and drops it once a pass succeeds", async () => {
    await db.accounts.update("alpha", { lastAgentSyncStatus: { at: "", ok: false, code: "tws-unreachable" } });
    renderStatus();
    expect(await screen.findByText("TWS injoignable")).toBeInTheDocument();
    await db.accounts.update("alpha", { lastAgentSyncStatus: { at: "", ok: true } });
    await waitFor(() => expect(screen.queryByText("TWS injoignable")).not.toBeInTheDocument());
  });
});
