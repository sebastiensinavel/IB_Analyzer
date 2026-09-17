/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildIdentities, buildJournals, pairCorporateActions, type IdentityInput } from "@ib/ledger";
import { mergeIdentities } from "./identity.ts";
import { parseActivityStatement } from "./statement.ts";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../tests/fixtures");
const YEARS = ["2022", "2023", "2024"] as const;

/**
 * The Open Positions of a statement, read here with a deliberately naive reader rather than
 * `parseActivityStatement`'s own snapshot: an oracle must not share the code it checks.
 * A fixture we generate ourselves needs no tolerance.
 */
function openStockPositions(html: string): Map<string, number> {
  const body = /id="tblOpenPositions_[^"]+Body"([\s\S]*?)<div[^>]*id="sec/.exec(html)?.[1] ?? "";
  const out = new Map<string, number>();
  let category = "";
  for (const row of body.match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
    if (/class="header-asset"/.test(row)) category = row.replace(/<[^>]+>/g, "").trim();
    if (/class="(subtotal|total)"/.test(row) || category !== "Stocks") continue;
    const cells = [...(row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) ?? [])].map((c) => c.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim());
    if (cells.length < 2 || cells[0] === "" || cells[0] === "Symbol") continue;
    const quantity = Number(cells[1].replace(/,/g, ""));
    if (!Number.isFinite(quantity)) continue;
    out.set(cells[0], (out.get(cells[0]) ?? 0) + quantity);
  }
  return out;
}

describe("the corporate-action corpus, replayed", () => {
  const files = YEARS.map((year) => readFileSync(path.join(dir, `statement_ca_corpus_${year}.htm`), "utf8"));
  const ibAccountId = /tbl[A-Za-z]+_?([A-Z]\d+)Body/.exec(files[0])![1];
  const parsed = files.map((html) => parseActivityStatement(html, { accountId: "corpus", ibAccountId }));
  const transactions = parsed.flatMap((p) => p.transactions);

  // Each alias's window is dated by the file(s) that actually showed it, the
  // shape `mergeContractRecords` stores in apps/web/src/db/contracts.ts (read
  // as a reference, never imported: packages/ib-parsers cannot depend on
  // apps/web). Two files can report the same ticker for the same conid; the
  // window only ever widens, never moves to an arbitrary file-order bound.
  const windowsByConid = new Map<string, Map<string, { firstSeen: string; lastSeen: string }>>();
  for (const p of parsed) {
    if (!p.statement) continue;
    const { periodStart: start, periodEnd: end } = p.statement;
    for (const identity of p.identities) {
      if (identity.conid === "") continue;
      const byTicker = windowsByConid.get(identity.conid) ?? new Map<string, { firstSeen: string; lastSeen: string }>();
      windowsByConid.set(identity.conid, byTicker);
      for (const ticker of identity.tickers) {
        const window = byTicker.get(ticker);
        if (!window) byTicker.set(ticker, { firstSeen: start, lastSeen: end });
        else {
          if (start < window.firstSeen) window.firstSeen = start;
          if (end > window.lastSeen) window.lastSeen = end;
        }
      }
    }
  }

  const inputs: IdentityInput[] = mergeIdentities(parsed.map((p) => p.identities)).map((identity) => ({
    conid: identity.conid,
    secType: identity.secType,
    isin: identity.isin,
    aliases: identity.tickers.map((ticker) => ({ ticker, ...windowsByConid.get(identity.conid)!.get(ticker)! })),
  }));

  const { events } = pairCorporateActions(transactions);

  it("reconstructs the last statement's stock positions, share for share", () => {
    const report = buildJournals(transactions, undefined, buildIdentities(inputs, events));
    const ledger = new Map<string, number>();
    for (const row of report.rows) {
      if (!row.ongoing || row.kind !== "shares") continue;
      ledger.set(row.label, (ledger.get(row.label) ?? 0) + (row.quantity ?? 0));
    }
    const expected = openStockPositions(files[2]);
    for (const [ticker, quantity] of expected) {
      expect.soft(ledger.get(ticker) ?? 0).toBeCloseTo(quantity, 3);
    }
    for (const [ticker, quantity] of ledger) {
      if (!expected.has(ticker)) expect.soft(`${ticker}=${quantity}`).toBe("not held");
    }
  });

  it("opens not one ghost short on a converted ticker", () => {
    const report = buildJournals(transactions, undefined, buildIdentities(inputs, events));
    expect(report.rows.filter((r) => r.ongoing && r.kind === "short_shares")).toEqual([]);
  });

  it("dates the corpus's discriminating ambiguous ticker to two different names, and only when the linking event is supplied", () => {
    // A ticker two conids claim: exactly the shape `dateAmbiguous` exists to
    // resolve. Found from the fixtures, never hardcoded: the corpus is
    // anonymized and its tickers are not stable across a regeneration.
    const claims = new Map<string, Set<string>>();
    for (const input of inputs) {
      for (const alias of input.aliases) {
        const owners = claims.get(alias.ticker);
        if (owners) owners.add(input.conid);
        else claims.set(alias.ticker, new Set([input.conid]));
      }
    }
    const EARLY = "0001-01-01T00:00:00.000Z";
    const LATE = "9999-12-31T23:59:59.999Z";
    const withEvents = buildIdentities(inputs, events);
    // Not every ambiguous ticker of the corpus discriminates: some conid
    // pairs are structurally undated by `dateAmbiguous` regardless of
    // windowing (see the task report). Take the one the resolution actually
    // dates apart.
    const ambiguous = [...claims.entries()]
      .filter(([, conids]) => conids.size === 2)
      .map(([ticker]) => ticker)
      .find((ticker) => withEvents.canonical(ticker, EARLY) !== withEvents.canonical(ticker, LATE));
    expect(ambiguous).toBeDefined();

    const before = withEvents.canonical(ambiguous!, EARLY);
    const after = withEvents.canonical(ambiguous!, LATE);
    expect(before).not.toBe(after);

    // Without the linking event, nothing separates the two conids: the
    // ticker must resolve to the same name on both sides — exactly a source
    // that supplied no identity hint at all (global constraint of the plan).
    const withoutEvents = buildIdentities(inputs, []);
    expect(withoutEvents.canonical(ambiguous!, EARLY)).toBe(withoutEvents.canonical(ambiguous!, LATE));
  });
});
