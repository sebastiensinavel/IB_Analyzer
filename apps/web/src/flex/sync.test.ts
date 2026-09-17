import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, type AccountRecord } from "@/db/schema";
import type { ProxyResult } from "./proxy";
import { syncAccount, type FlexSyncDeps } from "./sync";

// `syncAccount`'s contract is the retry loop and the state it writes to the
// account, not parsing: a fixture-driven `importFile` would make these seven
// loop tests fragile and would shift what they actually bite on. The real
// parser -> import path is already covered by `db/importFile.test.ts`, and
// task 20's end-to-end test exercises the whole chain again.
vi.mock("@/db/importFile", () => ({
  importFile: vi.fn(async () => ({
    status: "ok" as const,
    fileName: "flex-2026-09-04.xml",
    source: "flex" as const,
    period: { start: "2025-09-04", end: "2026-09-03" },
    imported: 0,
    skipped: 0,
    dropped: [],
    issues: [],
    positions: null,
    cashAvailable: null,
    staleSnapshot: false,
  })),
}));

const ACCOUNT: AccountRecord = {
  id: "beta",
  label: "Beta",
  ibAccountId: "U1234567",
  createdAt: "2026-09-01T00:00:00.000Z",
  warnedDroppedKinds: [],
  flexToken: "tok",
  flexQueryId: "123",
};

const SENT = `<FlexStatementResponse><Status>Success</Status><ReferenceCode>REF1</ReferenceCode></FlexStatementResponse>`;
const inProgress = (code: string) =>
  `<FlexStatementResponse><Status>Fail</Status><ErrorCode>${code}</ErrorCode><ErrorMessage>wait</ErrorMessage></FlexStatementResponse>`;
const STATEMENT = `<FlexQueryResponse queryName="Activity" type="AF"><FlexStatements count="1">` +
  `<FlexStatement accountId="U1234567" fromDate="20250904" toDate="20260903" whenGenerated="20260904;080000">` +
  `<Trades></Trades></FlexStatement></FlexStatements></FlexQueryResponse>`;

function deps(overrides: Partial<FlexSyncDeps> = {}): FlexSyncDeps {
  return {
    db,
    relay: "server" as const,
    sendRequest: vi.fn(async () => ({ ok: true as const, xml: SENT })),
    getStatement: vi.fn(async () => ({ ok: true as const, xml: STATEMENT })),
    sleep: vi.fn(async (_ms: number) => {}),
    now: () => new Date("2026-09-04T12:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
  await db.accounts.put(ACCOUNT);
});

describe("syncAccount", () => {
  it("does nothing at all without credentials", async () => {
    const d = deps();
    const outcome = await syncAccount(d, { ...ACCOUNT, flexToken: undefined });
    expect(outcome).toEqual({ status: "skipped", code: "no-credentials" });
    expect(d.sendRequest).not.toHaveBeenCalled();
  });

  // These waits were 5000/5000/10000 until the final review: IB's 5 s is a floor it imposes,
  // and our own proxy's 10-per-minute rule (apps/api/ib/throttling.py) needs more room than
  // that, so 1009 and 1019 now wait 7 s. 1018's 10 s already cleared the budget and is
  // unchanged. The 1500 leading every list is the pause between `send-request` and the first
  // `get-statement`, which the "one per second" rule makes mandatory.
  it("pauses before the first statement, then waits seven seconds on 1019 and ten on 1018", async () => {
    const answers = [inProgress("1019"), inProgress("1018"), STATEMENT];
    const getStatement = vi.fn(async () => ({ ok: true as const, xml: answers.shift()! }));
    const sleep = vi.fn(async (_ms: number) => {});
    const outcome = await syncAccount(deps({ getStatement, sleep }), ACCOUNT);

    expect(outcome.status).toBe("ok");
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1500, 7000, 10000]);
    expect(getStatement).toHaveBeenCalledTimes(3);
  });

  it("waits seven seconds on 1009 too", async () => {
    const answers = [inProgress("1009"), STATEMENT];
    const sleep = vi.fn(async (_ms: number) => {});
    await syncAccount(deps({ getStatement: vi.fn(async () => ({ ok: true as const, xml: answers.shift()! })), sleep }), ACCOUNT);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1500, 7000]);
  });

  it("never asks for the statement in the same second as send-request", async () => {
    const order: string[] = [];
    const d = deps({
      sendRequest: vi.fn(async () => {
        order.push("send");
        return { ok: true as const, xml: SENT };
      }),
      getStatement: vi.fn(async () => {
        order.push("get");
        return { ok: true as const, xml: STATEMENT };
      }),
      sleep: vi.fn(async (ms: number) => {
        order.push(`sleep:${ms}`);
      }),
    });
    await syncAccount(d, ACCOUNT);
    // The proxy counts both endpoints in one bucket: back-to-back "send" then "get" is a
    // guaranteed 429 whenever IB answers SendRequest in under a second.
    expect(order).toEqual(["send", "sleep:1500", "get"]);
  });

  it("waits out a 429 on send-request and retries instead of failing", async () => {
    const answers: ProxyResult[] = [
      { ok: false, code: "rate-limited", retryAfterMs: 3000 },
      { ok: true, xml: SENT },
    ];
    const sendRequest = vi.fn(async () => answers.shift()!);
    const sleep = vi.fn(async (_ms: number) => {});
    const outcome = await syncAccount(deps({ sendRequest, sleep }), ACCOUNT);

    expect(outcome.status).toBe("ok");
    expect(sendRequest).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([3000, 1500]);
  });

  it("waits out a 429 on get-statement, and falls back to two seconds without Retry-After", async () => {
    const answers: ProxyResult[] = [
      { ok: false, code: "rate-limited" },
      { ok: true, xml: STATEMENT },
    ];
    const getStatement = vi.fn(async () => answers.shift()!);
    const sleep = vi.fn(async (_ms: number) => {});
    const outcome = await syncAccount(deps({ getStatement, sleep }), ACCOUNT);

    expect(outcome.status).toBe("ok");
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1500, 2000]);
  });

  it("stops waiting on 429 once the throttle budget is spent", async () => {
    const sendRequest = vi.fn(async () => ({ ok: false as const, code: "rate-limited" as const, retryAfterMs: 1000 }));
    const sleep = vi.fn(async (_ms: number) => {});
    const outcome = await syncAccount(deps({ sendRequest, sleep }), ACCOUNT);

    expect(outcome).toEqual({ status: "failed", code: "rate-limited" });
    // Four waits, five calls: the budget bounds the whole run, it is not per call.
    expect(sendRequest).toHaveBeenCalledTimes(5);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 1000, 1000, 1000]);
  });

  it("gives up on an error code that is not a retry, without waiting for IB", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const outcome = await syncAccount(
      deps({ getStatement: vi.fn(async () => ({ ok: true as const, xml: inProgress("1003") })), sleep }),
      ACCOUNT,
    );
    expect(outcome).toEqual({ status: "failed", code: "1003" });
    // Only the mandatory pause before the first statement call; no retry wait on top of it.
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1500]);
  });

  it("gives up after the attempt ceiling rather than looping for ever", async () => {
    const getStatement = vi.fn(async () => ({ ok: true as const, xml: inProgress("1019") }));
    const outcome = await syncAccount(deps({ getStatement }), ACCOUNT);
    expect(outcome).toEqual({ status: "failed", code: "flex-retry-exhausted" });
    expect(getStatement.mock.calls.length).toBeLessThanOrEqual(12);
  });

  it("stops on a send-request failure without ever asking for the statement", async () => {
    const getStatement = vi.fn();
    const outcome = await syncAccount(
      deps({ sendRequest: vi.fn(async () => ({ ok: false as const, code: "unauthenticated" as const })), getStatement }),
      ACCOUNT,
    );
    expect(outcome).toEqual({ status: "failed", code: "unauthenticated" });
    expect(getStatement).not.toHaveBeenCalled();
  });

  it("records the outcome on the account, success or failure", async () => {
    await syncAccount(deps(), ACCOUNT);
    const ok = await db.accounts.get("beta");
    expect(ok?.lastFlexSyncAt).toBe("2026-09-04T12:00:00.000Z");
    expect(ok?.lastFlexSyncStatus).toEqual({ at: "2026-09-04T12:00:00.000Z", ok: true, relay: "server" });

    // A distinct, later clock for the failing attempt: if `record()` ever
    // stopped guarding `lastFlexSyncAt` and overwrote it unconditionally, this
    // second timestamp would leak into `lastFlexSyncAt` below and the
    // assertion would visibly fail instead of coincidentally matching (both
    // calls shared the same fixed clock before this fix, so the guard could
    // be silently dropped without any test noticing).
    await syncAccount(
      deps({
        sendRequest: vi.fn(async () => ({ ok: false as const, code: "flex-unreachable" as const })),
        now: () => new Date("2026-09-04T18:00:00.000Z"),
      }),
      ACCOUNT,
    );
    const failed = await db.accounts.get("beta");
    expect(failed?.lastFlexSyncStatus).toEqual({
      at: "2026-09-04T18:00:00.000Z",
      ok: false,
      code: "flex-unreachable",
      relay: "server",
    });
    // A failed attempt never moves the "last successful sync" mark.
    expect(failed?.lastFlexSyncAt).toBe("2026-09-04T12:00:00.000Z");
  });

  it("records which relay carried the sync", async () => {
    await syncAccount(deps({ relay: "agent" }), ACCOUNT);
    expect((await db.accounts.get("beta"))?.lastFlexSyncStatus).toEqual({
      at: "2026-09-04T12:00:00.000Z",
      ok: true,
      relay: "agent",
    });
  });
});
