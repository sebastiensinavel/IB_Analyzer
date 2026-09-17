/// <reference types="node" />
// The real file, on the author's machine only: the first Flex this repository
// has ever seen carry a corporate action, and the only proof that an option
// respelled by IB is one contract and not two.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildIdentities, buildJournals, pairCorporateActions, type IdentityInput } from "@ib/ledger";
import { parseFlexXml } from "./flex.ts";
import { alphaFlex } from "./privateFiles.ts";

const PRIVATE_PATH = alphaFlex()?.path ?? "";

/** An option spelled in packed OSI form: its root, then its terms. */
const PACKED = /^(.{6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

/**
 * Every option IB respelled without changing its conid, found in the file rather than written
 * here: naming them would commit the account's holdings. Its current spelling is the one its
 * latest transaction wears.
 */
function respelled(result: ReturnType<typeof parseFlexXml>) {
  return result.identities
    .filter((identity) => identity.secType === "OPT")
    .map((identity) => ({ identity, spellings: [...new Set(identity.tickers.filter((ticker) => PACKED.test(ticker)))] }))
    .filter(({ spellings }) => spellings.length >= 2)
    .map(({ spellings }) => {
      const latest = result.transactions
        .filter((t) => spellings.includes(t.symbol))
        .sort((a, b) => (a.when < b.when ? -1 : a.when > b.when ? 1 : 0))
        .at(-1);
      const after = latest?.symbol ?? spellings[spellings.length - 1];
      const [, , yy, mm, dd, right, thousandths] = PACKED.exec(after)!;
      return {
        after,
        before: spellings.filter((spelling) => spelling !== after),
        roots: new Set(spellings.map((spelling) => spelling.slice(0, 6).trim())),
        terms: { expiry: `20${yy}-${mm}-${dd}`, right, strike: Number(thousandths) / 1000 },
      };
    });
}

describe.skipIf(PRIVATE_PATH === "")("the identity table on the real Flex of alpha", () => {
  // 3.4 MB of XML: parsed once, not once per assertion.
  let cached: ReturnType<typeof parse> | null = null;
  const read = (): ReturnType<typeof parse> => (cached ??= parse());

  function parse() {
    const text = readFileSync(PRIVATE_PATH, "utf8");
    const ibAccountId = /accountId="([^"]+)"/.exec(text)?.[1] ?? "";
    const result = parseFlexXml(text, { accountId: "alpha", ibAccountId });
    // One import stamps every alias with that file's own window, exactly as
    // `mergeContractRecords` does when the store has never seen the contract.
    const window = { firstSeen: result.statement!.fromDate, lastSeen: result.statement!.toDate };
    const inputs: IdentityInput[] = result.identities.map((identity) => ({
      conid: identity.conid,
      secType: identity.secType,
      isin: identity.isin,
      aliases: identity.tickers.map((ticker) => ({ ticker, ...window })),
    }));
    const identities = buildIdentities(inputs, pairCorporateActions(result.transactions).events);
    return { result, identities };
  }

  it("elects the current spelling of every option conid IB respelled", { timeout: 120_000 }, () => {
    const { result, identities } = read();
    const options = respelled(result);
    // The file carries at least the two respellings this rule was written for.
    expect(options.length).toBeGreaterThanOrEqual(2);
    for (const { before, after } of options) {
      for (const spelling of before) expect(identities.canonical(spelling, "2026-09-09T00:00:00.000Z")).toBe(after);
      expect(identities.canonical(after, "2026-09-09T00:00:00.000Z")).toBe(after);
    }
  });

  it("leaves no respelled option open under either name", { timeout: 120_000 }, () => {
    const { result, identities } = read();
    const report = buildJournals(result.transactions, result.snapshot ?? undefined, identities);
    // The file does not reach back to the account's opening, so the ledger
    // legitimately differs from the snapshot on positions older than its own
    // window. Only the contracts this rule touches are asserted here.
    // Both spellings of each: the old code left one open under each name.
    const options = respelled(result);
    const touched = report.reconciliation.differences.filter((d) =>
      options.some(({ roots, terms }) =>
        d.contract.secType === "OPT" && roots.has(d.contract.ticker) && d.contract.expiry === terms.expiry && d.contract.right === terms.right && d.contract.strike === terms.strike,
      ),
    );
    expect(touched).toEqual([]);
  });
});
