import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { db, type AccountRecord } from "@/db/schema";
import { SAMPLE_JOURNAL_TRANSACTIONS } from "@/mocks/journals";
import { useActiveStrategies, useJournals, type JournalsView } from "./hooks";
import { loadAccountJournals } from "./journals";

const account = (id: string): AccountRecord => ({ id, label: id, ibAccountId: "U0000000", createdAt: "2026-09-01T00:00:00.000Z", warnedDroppedKinds: [] });

const seen: JournalsView[] = [];
function Probe({ accountId }: { accountId: string }) {
  const journals = useJournals(accountId, useActiveStrategies(accountId));
  useEffect(() => {
    if (journals.status === "ready") seen.push(journals);
  }, [journals]);
  return null;
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 80)));

beforeEach(async () => {
  seen.length = 0;
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe("loadAccountJournals", () => {
  it("builds the very journals useJournals shows", async () => {
    await db.accounts.add(account("beta"));
    await db.transactions.bulkAdd(SAMPLE_JOURNAL_TRANSACTIONS.map((t) => ({ ...t, accountId: "beta" })));
    render(<Probe accountId="beta" />);
    await settle();
    const loaded = await loadAccountJournals(db, "beta");
    expect(loaded?.journals).toEqual(seen.at(-1));
    expect(loaded?.snapshot).toBeNull();
  });

  it("answers null for an unknown account", async () => {
    expect(await loadAccountJournals(db, "nobody")).toBeNull();
  });
});

describe("useJournals across accounts", () => {
  it("does not rebuild alpha's journals when beta's snapshot is written", async () => {
    await db.accounts.bulkAdd([account("alpha"), account("beta")]);
    await db.transactions.bulkAdd(SAMPLE_JOURNAL_TRANSACTIONS.map((t) => ({ ...t, accountId: "alpha" })));
    render(<Probe accountId="alpha" />);
    await settle();
    const before = seen.length;
    await db.snapshots.put({ accountId: "beta", source: "agent", asOf: "2026-09-30T14:00:00.000Z", importedAt: "2026-09-30T18:00:00.000Z", cashAvailable: null, positions: [] });
    await settle();
    expect(seen.length).toBe(before);
  });
});
