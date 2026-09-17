/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseActivityStatement } from "./statement.ts";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../tests/fixtures");
const YEARS = ["2022", "2023", "2024"] as const;

function parseYear(year: string) {
  const html = readFileSync(path.join(dir, `statement_ca_corpus_${year}.htm`), "utf8");
  const ibAccountId = /tbl[A-Za-z]+_?([A-Z]\d+)Body/.exec(html)![1];
  return parseActivityStatement(html, { accountId: "corpus", ibAccountId });
}

describe("the anonymized corporate-action corpus", () => {
  const parsed = YEARS.map(parseYear);

  it("parses without a single error", () => {
    for (const result of parsed) expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("carries no account id but the anonymized one", () => {
    for (const year of YEARS) {
      const html = readFileSync(path.join(dir, `statement_ca_corpus_${year}.htm`), "utf8");
      // No word boundaries, deliberately: "_" and "U" are both word
      // characters, so `\b` never fires in "tblTransactions_U…Body" — the
      // section ids are exactly where a leaked account id hid once.
      const ids = new Set(html.match(/U\d{7,9}/g) ?? []);
      expect([...ids].sort()).toEqual(["U9000000"]);
    }
  });

  it("carries the four event shapes that produce corporate-action rows", () => {
    const descriptions = parsed.flatMap((r) => r.transactions.filter((t) => t.kind === "corporate_action").map((t) => t.description));
    expect(descriptions.some((d) => /CUSIP\/ISIN Change to/.test(d))).toBe(true);
    expect(descriptions.some((d) => /Split 1 for \d+/.test(d))).toBe(true);
    expect(descriptions.some((d) => /Merged\(Acquisition\)/.test(d))).toBe(true);
    expect(descriptions.some((d) => /Cash and Stock Merger/.test(d))).toBe(true);
  });

  it("keeps a mixed merger arithmetically consistent after anonymization", () => {
    const merger = parsed
      .flatMap((r) => r.transactions)
      .find((t) => t.kind === "corporate_action" && /Cash and Stock Merger/.test(t.description) && (t.quantity ?? 0) < 0)!;
    expect(merger.amount).not.toBeNull();
    expect(merger.realizedPnl).not.toBeNull();
    // The basis the cash consumed must stay positive and below the cash itself.
    const basis = merger.amount! - merger.realizedPnl!;
    expect(basis).toBeGreaterThan(0);
    expect(basis).toBeLessThan(merger.amount!);
  });

  it("keeps one conid consistent across two files: the ticker rename with no event", () => {
    const byConid = new Map<string, Set<string>>();
    for (const result of parsed) {
      for (const identity of result.identities) {
        const set = byConid.get(identity.conid) ?? new Set<string>();
        for (const ticker of identity.tickers) set.add(ticker);
        byConid.set(identity.conid, set);
      }
    }
    // At least one contract wears two different names across the corpus:
    // that is the whole point of cases E and F.
    expect([...byConid.values()].some((tickers) => tickers.size >= 2)).toBe(true);
  });

  it("reads a Cash Report in both currencies every year, the first one opening the account", () => {
    for (const result of parsed) {
      expect(Object.keys(result.cashReport!.end.balances).sort()).toEqual(["EUR", "USD"]);
    }
    expect(parsed[0].cashReport!.start.balances).toEqual({ EUR: 0, USD: 0 });
  });

  it("reads every Open Positions row of every year", () => {
    // Counts exclude subtotal/total rows: only actual position data rows.
    expect(parsed.map((result) => result.snapshot?.positions.length)).toEqual([23, 34, 41]);
    for (const result of parsed) {
      expect(result.issues.filter((i) => i.code === "row-skipped" && i.detail.startsWith("OpenPositions"))).toEqual([]);
    }
  });
});
