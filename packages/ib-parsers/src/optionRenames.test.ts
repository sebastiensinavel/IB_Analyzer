/// <reference types="node" />
// Two hand-written statements, a few kilobytes each and not one real figure:
// the two shapes a renamed option takes when Flex is absent (spec §7.1 of
// docs/specs/2026-09-16-identite-options-design.md).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildIdentities, buildJournals, pairCorporateActions, type IdentityInput } from "@ib/ledger";
import { mergeIdentities } from "./identity.ts";
import { parseActivityStatement } from "./statement.ts";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../tests/fixtures");
const TARGET = { accountId: "opt", ibAccountId: "U0000002" };
const OPTION_OLD = "TSTB  270115C00002500";
const OPTION_NEW = "TSTC  270115C00002500";
const LATE = "9999-12-31T23:59:59.999Z";

const read = (name: string) => readFileSync(path.join(dir, name), "utf8");
const html2025 = read("statement_opt_2025.htm");
const html2026 = read("statement_opt_2026.htm");

/** Rewrites one cell of the single row that contains `marker`. */
function editRow(html: string, marker: string, from: string, to: string): string {
  const row = (html.match(/<tr[\s\S]*?<\/tr>/g) ?? []).find((candidate) => candidate.includes(marker));
  expect(row, `a row containing ${marker}`).toBeDefined();
  const edited = row!.replace(from, to);
  expect(edited, `${from} inside the row containing ${marker}`).not.toBe(row);
  return html.replace(row!, edited);
}

/**
 * The identity table and the journals `useJournals` would build from these
 * statements: every alias of a file is stamped with that file's own window,
 * exactly as `mergeContractRecords` does (apps/web/src/db/contracts.ts, read
 * as a reference — this package cannot import apps/web).
 */
function replay(htmls: readonly string[]) {
  const parsed = htmls.map((html) => parseActivityStatement(html, TARGET));
  const windows = new Map<string, { firstSeen: string; lastSeen: string }>();
  for (const p of parsed) {
    const { periodStart: start, periodEnd: end } = p.statement!;
    for (const identity of p.identities) {
      for (const ticker of identity.tickers) {
        const key = `${identity.conid}|${ticker}`;
        const seen = windows.get(key);
        if (!seen) windows.set(key, { firstSeen: start, lastSeen: end });
        else {
          if (start < seen.firstSeen) seen.firstSeen = start;
          if (end > seen.lastSeen) seen.lastSeen = end;
        }
      }
    }
  }
  const inputs: IdentityInput[] = mergeIdentities(parsed.map((p) => p.identities)).map((identity) => ({
    conid: identity.conid,
    secType: identity.secType,
    isin: identity.isin,
    aliases: identity.tickers.map((ticker) => ({ ticker, ...windows.get(`${identity.conid}|${ticker}`)! })),
  }));
  const transactions = parsed.flatMap((p) => p.transactions);
  const { events } = pairCorporateActions(transactions);
  const identities = buildIdentities(inputs, events);
  const snapshot = parsed[parsed.length - 1].snapshot!;
  return {
    parsed,
    inputs,
    events,
    identities,
    report: buildJournals(transactions, { asOf: snapshot.asOf, positions: snapshot.positions }, identities),
  };
}

describe("two statements, no Flex, two options IB renamed", () => {
  it("parses both files without a single issue", () => {
    for (const { issues } of replay([html2025, html2026]).parsed) expect(issues).toEqual([]);
  });

  it("reconstructs the last statement's positions exactly", () => {
    const { report, identities } = replay([html2025, html2026]);
    expect(report.reconciliation.differences).toEqual([]);
    expect(report.reconciliation.orphans).toEqual([]);
    expect(identities.issues).toEqual([]);
  });

  it("files each option under the one name it wears today", () => {
    const labels = replay([html2025, html2026]).report.rows.map((row) => row.label);
    // The adjusted option, closed under its new spelling; the converted one,
    // bought under the old ticker and sold under the new.
    expect(labels).toContain("TSTA1 Jan16'26 12.5 Call");
    expect(labels).toContain("TSTC Jan15'27 2.5 Call");
    expect(labels).not.toContain("TSTA Jan16'26 12.5 Call");
    expect(labels).not.toContain("TSTB Jan15'27 2.5 Call");
  });

  it("owes the converted option's name to the event alone (rule 9)", () => {
    const { inputs, events } = replay([html2025, html2026]);
    expect(buildIdentities(inputs, events).canonical(OPTION_OLD, LATE)).toBe(OPTION_NEW);
    expect(buildIdentities(inputs).canonical(OPTION_OLD, LATE)).toBe(OPTION_OLD);
  });

  it("refuses the graft when the event's ratio is not 1", () => {
    const edited = editRow(html2026, "(TSTC, TEST C CORP,", ">975<", ">100<");
    expect(replay([html2025, edited]).identities.canonical(OPTION_OLD, LATE)).toBe(OPTION_OLD);
  });

  it("refuses the graft when the event pays cash", () => {
    const edited = editRow(html2026, "(TSTB.OLD, TEST B INC,", ">0.00</td>", ">1,290.40</td>");
    expect(replay([html2025, edited]).identities.canonical(OPTION_OLD, LATE)).toBe(OPTION_OLD);
  });

  it("refuses the graft on an option that had already expired", () => {
    const edited = editRow(html2026, "TSTC  270115C00002500", "270115", "260101");
    expect(replay([html2025, edited]).identities.canonical(OPTION_OLD, LATE)).toBe(OPTION_OLD);
  });
});
