/// <reference types="node" />
// The real Flex of beta, on the author's machine only. The account id is read from the file
// itself, never written here, and no amount is: the check is a gap, and it must be nil.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { anchoredBalances, planImport, type CashPoint } from "@ib/ledger";
import { parseFlexXml } from "./flex.ts";
import { betaFlex } from "./privateFiles.ts";

const PRIVATE_PATH = betaFlex()?.path ?? "";

// Vitest still runs a skipped describe's factory body: every read happens inside the it().
describe.skipIf(PRIVATE_PATH === "")("the cash of beta, from its Flex alone", () => {
  it("comes back to its Starting Cash to the cent, the response reaching the account's opening", () => {
    const xml = readFileSync(PRIVATE_PATH, "utf8");
    const ibAccountId = /accountId="([^"]+)"/.exec(xml)?.[1] ?? "";
    const result = parseFlexXml(xml, { accountId: "beta", ibAccountId });
    const period = { start: result.statement!.fromDate, end: result.statement!.toDate };
    // What importFile writes: planImport leaves out a late adjustment dated before the window.
    const { upsert } = planImport([], { source: "flex", transactions: result.transactions, period });
    const report = result.cashReport!;
    const points: CashPoint[] = [
      { currency: "USD", kind: "start", asOf: report.start.asOf, amount: report.start.balances.USD },
      { currency: "USD", kind: "end", asOf: report.end.asOf, amount: report.end.balances.USD },
    ];
    const { rows, checks } = anchoredBalances(upsert, ["USD"], points);
    const [usd] = checks;
    expect(usd.start?.gap).toBe(0);
    expect(rows[rows.length - 1].balances.USD).toBeCloseTo(report.end.balances.USD, 2);
  });
});
