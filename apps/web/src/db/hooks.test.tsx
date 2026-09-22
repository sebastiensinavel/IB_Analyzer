import { beforeEach, describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { JournalsReport, Transaction } from "@ib/ledger";
import { db, type AccountRecord } from "@/db/schema";
import { useAccount, useImports, useJournals, useLedger, useNeverFed, useRiskReport, useSectors, useSnapshot, useStatements } from "@/db/hooks";
import { SAMPLE_TRANSACTIONS } from "@/mocks/ledger";
import { SAMPLE_SECTORS, SAMPLE_SNAPSHOT } from "@/mocks/positions";

beforeEach(async () => {
  await Promise.all([
    db.accounts.clear(),
    db.transactions.clear(),
    db.imports.clear(),
    db.snapshots.clear(),
    db.sectors.clear(),
    db.statements.clear(),
    db.contracts.clear(),
  ]);
});

/** A fresh account per call: several tests seed transactions/contracts scoped to it. */
async function seedAccount(): Promise<AccountRecord> {
  const account: AccountRecord = {
    id: `test-${crypto.randomUUID()}`,
    label: "Test",
    ibAccountId: "U0000001",
    createdAt: "",
    warnedDroppedKinds: [],
  };
  await db.accounts.add(account);
  return account;
}

/** A unique `externalId` per call, so several rows can be `bulkPut` together. */
function tx(overrides: Partial<Transaction>): Transaction {
  return {
    accountId: "test",
    externalId: `flex:trade:${crypto.randomUUID()}`,
    source: "flex",
    kind: "trade",
    symbol: "AAPL",
    secType: "STK",
    right: "",
    strike: null,
    expiry: null,
    quantity: 1,
    price: 10,
    amount: -10,
    commission: -1,
    currency: "USD",
    when: "2026-01-01T00:00:00.000Z",
    description: "",
    ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

describe("useAccount", () => {
  it("resolves to null for an unknown account and to the record for a known one", async () => {
    await db.accounts.add({ id: "alpha", label: "alpha", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [] });
    const unknown = renderHook(() => useAccount("nope"));
    await waitFor(() => expect(unknown.result.current).toBeNull());
    const known = renderHook(() => useAccount("alpha"));
    await waitFor(() => expect(known.result.current).toMatchObject({ label: "alpha" }));
  });
});

describe("useLedger", () => {
  it("returns only the account's rows, in reference order, and follows writes", async () => {
    await db.transactions.bulkAdd(SAMPLE_TRANSACTIONS);
    await db.transactions.add({ ...SAMPLE_TRANSACTIONS[0], accountId: "other", externalId: "flex:trade:other" });
    const { result } = renderHook(() => useLedger("alpha"));
    await waitFor(() => expect(result.current).toHaveLength(SAMPLE_TRANSACTIONS.length));
    expect(result.current!.map((t) => t.symbol)).toEqual(["", "TSLA", "MSFT", "AAPL"]);

    await db.transactions.add({ ...SAMPLE_TRANSACTIONS[0], externalId: "flex:trade:new", when: "2026-09-01T00:00:00.000Z", symbol: "NEW" });
    await waitFor(() => expect(result.current!.at(-1)?.symbol).toBe("NEW"));
  });
});

describe("useStatements", () => {
  it("returns only the account's statements, oldest declared period first", async () => {
    const base = { fileName: "s.htm", importedAt: "", text: "<html/>", bytes: 7 };
    await db.statements.bulkAdd([
      { ...base, id: "alpha|2025-01-01|2025-12-31", accountId: "alpha", period: { start: "2025-01-01", end: "2025-12-31" } },
      { ...base, id: "alpha|2023-01-01|2023-12-31", accountId: "alpha", period: { start: "2023-01-01", end: "2023-12-31" } },
      { ...base, id: "alpha|2024-01-01|2024-12-31", accountId: "alpha", period: { start: "2024-01-01", end: "2024-12-31" } },
      { ...base, id: "other|2024-01-01|2024-12-31", accountId: "other", period: { start: "2024-01-01", end: "2024-12-31" } },
    ]);
    const { result } = renderHook(() => useStatements("alpha"));
    await waitFor(() => expect(result.current).toHaveLength(3));
    expect(result.current!.map((s) => s.period.start)).toEqual(["2023-01-01", "2024-01-01", "2025-01-01"]);
  });
});

describe("useImports", () => {
  it("returns only the account's imports, newest first", async () => {
    // Insertion order is deliberately not `at` order: the hook relies on
    // Dexie's `reverse().sortBy("at")` to sort, not on insertion order.
    await db.imports.bulkAdd([
      { accountId: "alpha", source: "flex", at: "2026-08-01T00:00:00.000Z", fileName: "a", period: null, imported: 1, skipped: 0, dropped: [], issues: [] },
      { accountId: "alpha", source: "flex", at: "2026-08-03T00:00:00.000Z", fileName: "c", period: null, imported: 1, skipped: 0, dropped: [], issues: [] },
      { accountId: "alpha", source: "flex", at: "2026-08-02T00:00:00.000Z", fileName: "b", period: null, imported: 1, skipped: 0, dropped: [], issues: [] },
      { accountId: "other", source: "flex", at: "2026-08-04T00:00:00.000Z", fileName: "d", period: null, imported: 1, skipped: 0, dropped: [], issues: [] },
    ]);
    const { result } = renderHook(() => useImports("alpha"));
    await waitFor(() => expect(result.current).toHaveLength(3));
    expect(result.current!.map((r) => r.fileName)).toEqual(["c", "b", "a"]);
  });
});

describe("useSnapshot", () => {
  it("resolves to null without a snapshot and to the account's own one otherwise", async () => {
    await db.snapshots.put({ ...SAMPLE_SNAPSHOT, accountId: "beta" });
    const none = renderHook(() => useSnapshot("alpha"));
    await waitFor(() => expect(none.result.current).toBeNull());
    await db.snapshots.put(SAMPLE_SNAPSHOT);
    await waitFor(() => expect(none.result.current?.positions).toHaveLength(SAMPLE_SNAPSHOT.positions.length));
  });
});

describe("useSectors", () => {
  it("maps tickers to their record and follows writes", async () => {
    await db.sectors.bulkPut(SAMPLE_SECTORS);
    const { result } = renderHook(() => useSectors());
    await waitFor(() => expect(result.current?.get("AAPL")?.category).toBe("Tech"));
    await db.sectors.clear();
    await waitFor(() => expect(result.current?.size).toBe(0));
  });
});

describe("useRiskReport", () => {
  it("is undefined while loading, null without a snapshot, and a computed report with sectors otherwise", async () => {
    const { result } = renderHook(() => useRiskReport("alpha"));
    expect(result.current.report).toBeUndefined();
    await waitFor(() => expect(result.current.report).toBeNull());

    await db.snapshots.put(SAMPLE_SNAPSHOT);
    await db.sectors.bulkPut(SAMPLE_SECTORS);
    await waitFor(() => expect(result.current.report?.positions).toHaveLength(SAMPLE_SNAPSHOT.positions.length));
    expect(result.current.report?.cashAvailable).toBe(42000);
    expect(result.current.report?.structures.map((s) => s.kind)).toEqual(["iron condor"]);
    await waitFor(() => expect(result.current.sectorOf("AAPL")).toBe("Tech"));
    expect(result.current.sectorOf("XYZ")).toBeNull();
  });
});

describe("useJournals", () => {
  it("resolves a renamed ticker so the journals show one position, not two", async () => {
    const account = await seedAccount();
    await db.transactions.bulkPut([
      tx({ accountId: account.id, symbol: "ZXAB", quantity: 220, price: 1.51, when: "2022-10-20T13:30:00.000Z" }),
      tx({ accountId: account.id, symbol: "ZXABQ", quantity: -220, price: 0.029, when: "2023-05-26T15:50:21.000Z" }),
    ]);
    await db.contracts.put({
      accountId: account.id, conid: "1", isin: "", secType: "STK", currency: "USD", description: "",
      aliases: [
        { ticker: "ZXAB", firstSeen: "2022-01-01", lastSeen: "2022-12-31" },
        { ticker: "ZXABQ", firstSeen: "2023-01-01", lastSeen: "2023-12-31" },
      ],
      updatedAt: "2026-09-09T10:00:00.000Z",
    });

    const { result } = renderHook(() => useJournals(account.id), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const view = result.current as { status: "ready"; report: JournalsReport };
    expect(view.report.rows.filter((r) => r.ongoing)).toEqual([]);
  });

  it("stays in loading until the contracts store has answered", async () => {
    const account = await seedAccount();
    const { result } = renderHook(() => useJournals(account.id), { wrapper });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });
});

/**
 * The criterion behind the « Première étape » card: a statement import and a Flex sync both
 * write an ImportRecord, the agent writes none but stamps `lastAgentSyncAt`. A refused import
 * counts — the user acted, and the import report answers them from then on.
 */
describe("useNeverFed", () => {
  // The account exists and the answer is knowable: what is asserted is that the hook says
  // `undefined` on the first synchronous render, before Dexie answers, and only then settles.
  // An account id that does not exist would leave it `undefined` for ever and would pass
  // against an implementation that never resolves at all.
  it("is undefined on the first render, before the queries answer, then settles", async () => {
    const account = await seedAccount();
    const { result } = renderHook(() => useNeverFed(account.id), { wrapper });
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBe(true));
  });

  // A deleted account, or one the URL invents: `useAccount` answers `null`, not `undefined`,
  // so the hook does settle — on `true`, nothing having fed an account that is not there. That
  // is the optional chaining in `account?.lastAgentSyncAt`; drop it and this throws.
  it("settles on true for an account that does not exist", async () => {
    const { result } = renderHook(() => useNeverFed("nope"), { wrapper });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("is true on an account nothing has ever fed", async () => {
    const account = await seedAccount();
    const { result } = renderHook(() => useNeverFed(account.id), { wrapper });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("is false once an import has been recorded, even a refused one", async () => {
    const account = await seedAccount();
    await db.imports.add({
      accountId: account.id,
      source: "statement_html",
      at: "2026-09-01T10:00:00.000Z",
      fileName: "refused.htm",
      period: null,
      imported: 0,
      skipped: 0,
      dropped: [],
      issues: [{ severity: "error", code: "normalization", detail: "nope" }],
    });
    const { result } = renderHook(() => useNeverFed(account.id), { wrapper });
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("is false once the agent has passed, which writes no import record", async () => {
    const account = await seedAccount();
    await db.accounts.update(account.id, { lastAgentSyncAt: "2026-09-22T12:00:00.000Z" });
    const { result } = renderHook(() => useNeverFed(account.id), { wrapper });
    await waitFor(() => expect(result.current).toBe(false));
  });
});
