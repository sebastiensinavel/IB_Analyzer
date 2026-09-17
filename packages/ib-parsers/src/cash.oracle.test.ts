/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { anchoredBalances, isCashCheckOk, planImport, type CashPoint, type Transaction } from "@ib/ledger";
import type { CashReport } from "./snapshot.ts";
import { parseActivityStatement } from "./statement.ts";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../tests/fixtures");
const YEARS = ["2022", "2023", "2024"] as const;

/**
 * The corpus replayed as `importFile` would, anchored on its own Cash Reports. USD only: the
 * anonymizer rewrites EUR amounts of the ledger without rewriting the Cash Report the same way
 * (spec of sub-project 9, §2.3), so an EUR check here would test the anonymizer.
 */
describe("the anonymized corpus, anchored on its own Cash Reports", () => {
  it("comes back to the Starting Cash of the account's opening in USD, within the tolerance", () => {
    const ledger = new Map<string, Transaction>();
    const reports: CashReport[] = [];
    for (const year of YEARS) {
      const html = readFileSync(path.join(dir, `statement_ca_corpus_${year}.htm`), "utf8");
      const ibAccountId = /tbl[A-Za-z]+_?([A-Z]\d+)Body/.exec(html)![1];
      const parsed = parseActivityStatement(html, { accountId: "corpus", ibAccountId });
      const period = { start: parsed.statement!.periodStart, end: parsed.statement!.periodEnd };
      const plan = planImport([...ledger.values()], { source: "statement_html", transactions: parsed.transactions, period });
      for (const externalId of plan.delete) ledger.delete(externalId);
      for (const tx of plan.upsert) ledger.set(tx.externalId, tx);
      reports.push(parsed.cashReport!);
    }
    const points: CashPoint[] = [
      { currency: "USD", kind: "start", asOf: reports[0].start.asOf, amount: reports[0].start.balances.USD },
      { currency: "USD", kind: "end", asOf: reports[2].end.asOf, amount: reports[2].end.balances.USD },
    ];
    const { rows, checks } = anchoredBalances([...ledger.values()], ["USD"], points);
    const [usd] = checks;
    expect(usd.start?.amount).toBe(0);
    expect(isCashCheckOk(usd)).toBe(true);
    expect(rows[rows.length - 1].balances.USD).toBeCloseTo(reports[2].end.balances.USD, 2);
  });
});
