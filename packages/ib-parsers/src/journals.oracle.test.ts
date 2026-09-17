/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildJournals, NO_IDENTITIES } from "@ib/ledger";
import { parseFlexXml } from "./flex.ts";

const FIXTURE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "../tests/fixtures/flex_journals_corpus.xml");
const TARGET = { accountId: "beta", ibAccountId: "U0000001" };

// Counted on the real file when the corpus was made: 13 price-0 closes, 7 with a
// share delivery at the strike (assignments or exercises), 6 without (expiries).
const SETTLED_CLOSES = 7;
const EXPIRED_CLOSES = 6;

// Rows by strategy, read off the engine on this corpus: a regression that classified
// every opening as "others" — nothing here would otherwise catch that, since the three
// checks above only look at reconciliation and event kind, never at classification —
// would leave this pinned distribution silently wrong. Quantities were left real (see
// scripts/anonymize-flex.mjs, "7."), so this distribution is the account's actual mix of
// strategies over the covered year, not a synthetic one. Every row of this account falls
// into a strategy: "others" is absent, and a single row landing there is a regression.
// Fills of one order fold into one line (`journals/fills.ts`), which is why this is
// lower than the row count of the raw ledger: 171 rows before folding, 137 after,
// with openNet, closeNet, pnl and the three strategy totals unchanged to the cent.
const STRATEGY_DISTRIBUTION = { wheel: 78, leaps: 55, condors: 4 };

/** Distinct closing transactions carrying the event: a close serving two lots makes two rows but is one transaction. */
function closes(rows: { event: string | null; closeIds: string[] }[], events: string[]): number {
  return new Set(rows.filter((r) => r.event !== null && events.includes(r.event)).flatMap((r) => r.closeIds)).size;
}

describe("the journals engine on the full anonymized Flex of beta", () => {
  const result = parseFlexXml(readFileSync(FIXTURE_PATH, "utf8"), TARGET);
  const report = buildJournals(result.transactions, result.snapshot ?? undefined);

  it("parses cleanly", () => {
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.snapshot?.positions).toHaveLength(30);
  });

  it("replays the ledger back to the snapshot: zero difference, zero orphan", () => {
    expect(report.reconciliation.differences).toEqual([]);
    expect(report.reconciliation.orphans).toEqual([]);
  });

  it("carries no identity hint, and reports exactly what it always reported", () => {
    expect(report).toEqual(buildJournals(result.transactions, result.snapshot ?? undefined, NO_IDENTITIES));
  });

  it("reads every assignment and every expiry the file holds", () => {
    expect(closes(report.rows, ["assigned", "exercised"])).toBe(SETTLED_CLOSES);
    expect(closes(report.rows, ["expired"])).toBe(EXPIRED_CLOSES);
  });

  it("never emits a row without a strategy, a ticker, or a label", () => {
    for (const row of report.rows) {
      expect(["wheel", "leaps", "condors", "others"]).toContain(row.strategy);
      expect(row.ticker).not.toBe("");
      expect(row.label).not.toBe("");
    }
  });

  it("classifies the account's actual rows into the expected mix of strategies", () => {
    const distribution: Record<string, number> = {};
    for (const row of report.rows) distribution[row.strategy] = (distribution[row.strategy] ?? 0) + 1;
    expect(distribution).toEqual(STRATEGY_DISTRIBUTION);
  });
});
