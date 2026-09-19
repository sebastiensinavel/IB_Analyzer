/// <reference types="node" />
// This package's tsconfig opts out of ambient globals ("types": []) since it
// runs in the browser; this file alone runs under Node (vitest), so it opts
// itself back in rather than exposing Node globals to the whole package.
// jsdom's global URL ignores the explicit base and resolves against its fake
// document location, so the fixture path is built without the WHATWG URL API
// (see flex.fixture.test.ts for the same workaround).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseActivityStatement } from "./statement.ts";

const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../tests/fixtures/activity_statement_sample.htm",
);
const html = readFileSync(FIXTURE_PATH, "utf8");
const TARGET = { accountId: "test", ibAccountId: "U0000001" };

describe("parseActivityStatement header", () => {
  it("reads the account and the declared period from the title", () => {
    const { statement } = parseActivityStatement(html, TARGET);
    expect(statement).toEqual({ ibAccountId: "U0000001", periodStart: "2025-01-01", periodEnd: "2025-12-31" });
  });

  it("refuses a statement of another account", () => {
    const result = parseActivityStatement(html, { accountId: "test", ibAccountId: "U7777777" });
    expect(result.transactions).toEqual([]);
    expect(result.issues).toEqual([
      { severity: "error", code: "account-mismatch", detail: "File belongs to account U0000001, expected U7777777" },
    ]);
  });

  it("rejects a page without statement sections", () => {
    const result = parseActivityStatement("<html><head><title>x</title></head><body></body></html>", TARGET);
    expect(result.statement).toBeNull();
    expect(result.issues[0]).toMatchObject({ severity: "error", code: "normalization" });
  });

  it("cancels everything when the period cannot be read", () => {
    const untitled = html.replace(/<title>.*<\/title>/, "<title>Nothing</title>");
    const result = parseActivityStatement(untitled, TARGET);
    expect(result.transactions).toEqual([]);
    expect(result.issues[0]).toMatchObject({ severity: "error", code: "normalization" });
  });
});

describe("parseActivityStatement trades", () => {
  const trades = parseActivityStatement(html, TARGET).transactions.filter((t) => t.kind === "trade");

  it("normalizes a stock buy with the currency of its block", () => {
    const buy = trades.find((t) => t.symbol === "TESTX" && t.when === "2025-01-02T09:30:00.000Z");
    expect(buy).toMatchObject({
      source: "statement_html",
      secType: "STK",
      quantity: 100,
      price: 10,
      amount: -1000,
      commission: -1,
      currency: "USD",
      description: "TESTX",
      right: "",
      strike: null,
      expiry: null,
    });
    expect(buy?.externalId).toMatch(/^html:[0-9a-f]{64}$/);
  });

  it("keeps a sale's negative quantity", () => {
    const sale = trades.find((t) => t.symbol === "TESTX" && t.quantity === -100);
    expect(sale?.amount).toBe(1200);
  });

  it("splits an option contract out of the Symbol cell", () => {
    const option = trades.find((t) => t.secType === "OPT");
    expect(option).toMatchObject({ right: expect.stringMatching(/^[CP]$/), strike: expect.any(Number), expiry: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(option?.description).toMatch(/\d{2}[A-Z]{3}\d{2}/);
  });

  it("keeps a forex conversion as a trade on the pair with a null close price, quote currency on the row", () => {
    const fx = trades.find((t) => t.symbol === "EUR.USD");
    expect(fx).toMatchObject({ secType: "CASH", quantity: 100, price: 1.1, amount: -110, commission: -2, currency: "USD" });
  });

  it("keeps both twin rows with distinct ids", () => {
    const twins = trades.filter((t) => t.symbol === "TWINX");
    expect(twins).toHaveLength(2);
    expect(twins[1].externalId).toBe(`${twins[0].externalId}#2`);
  });

  it("excludes subtotal and total rows", () => {
    expect(trades.some((t) => /total/i.test(t.symbol))).toBe(false);
  });

  it("cancels everything on an unreadable trade value", () => {
    const broken = html.replace("10.0000", "ten");
    const result = parseActivityStatement(broken, TARGET);
    expect(result.transactions).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: "error", code: "normalization" }));
  });

  it("passes an unknown asset category through as secType, warning once per distinct category", () => {
    // Insert a new asset block under a category absent from SEC_TYPE_BY_CATEGORY,
    // with two rows so we can check the warning fires only once.
    const unknownCategoryBlock = `<tbody>
<tr><td class="header-asset" align="left" valign="middle" colspan="11">Bonds</td></tr>
</tbody>
<tbody>
<tr><td class="header-currency" align="left" valign="middle" colspan="11">USD</td></tr>
</tbody>
<tbody>
<tr>
<td>TESTBOND</td>
<td>2025-06-01, 10:00:00</td>
<td align="right">1</td>
<td align="right">100.0000</td>
<td align="right">100.0000</td>
<td align="right">-100.00</td>
<td align="right">-1.00</td>
<td align="right">100.00</td>
<td align="right">0.00</td>
<td align="right">0.00</td>
<td align="right">O</td>
</tr>
<tr>
<td>TESTBOND2</td>
<td>2025-06-02, 10:00:00</td>
<td align="right">1</td>
<td align="right">100.0000</td>
<td align="right">100.0000</td>
<td align="right">-100.00</td>
<td align="right">-1.00</td>
<td align="right">100.00</td>
<td align="right">0.00</td>
<td align="right">0.00</td>
<td align="right">O</td>
</tr>
</tbody>
`;
    const anchor = '</tbody>\n</table>\n</div>\n</div>\n\n<div id="tblCombDiv_U0000001Body"';
    expect(html).toContain(anchor);
    const withUnknownCategory = html.replace(anchor, `</tbody>\n${unknownCategoryBlock}</table>\n</div>\n</div>\n\n<div id="tblCombDiv_U0000001Body"`);
    const result = parseActivityStatement(withUnknownCategory, TARGET);
    const bondTrades = result.transactions.filter((t) => t.symbol === "TESTBOND" || t.symbol === "TESTBOND2");
    expect(bondTrades).toHaveLength(2);
    expect(bondTrades.every((t) => t.secType === "Bonds")).toBe(true);
    const bondWarnings = result.issues.filter((i) => i.code === "unknown-asset-category" && i.detail === "Bonds");
    expect(bondWarnings).toHaveLength(1);
  });

  it("reads a second asset-category block that repeats the table header with its own column layout", () => {
    // IB does not always reuse one table-wide header: a block can carry its own
    // <thead> with a different column layout (seen live in a real statement,
    // reproduced here with invented values of the same shape: blank header
    // cells and a renamed commission column instead of "Comm/Fee").
    const secondBlock = `<thead>
<tr>
<th align="left">Symbol</th>
<th align="left">Date/Time</th>
<th align="right">Quantity</th>
<th align="right">T. Price</th>
<th align="right"></th>
<th align="right">Proceeds</th>
<th align="right">Comm in EUR</th>
<th align="right"></th>
<th align="right"></th>
<th align="right">MTM in EUR</th>
<th align="right">Code</th>
</tr>
</thead>
<tbody>
<tr><td class="header-asset" align="left" valign="middle" colspan="11">Forex</td></tr>
</tbody>
<tbody>
<tr><td class="header-currency" align="left" valign="middle" colspan="11">EUR</td></tr>
</tbody>
<tbody>
<tr>
<td>GBP.EUR</td>
<td>2025-07-01, 11:00:00</td>
<td align="right">200</td>
<td align="right">1.1500</td>
<td align="right"></td>
<td align="right">-230.00</td>
<td align="right">-3.00</td>
<td align="right"></td>
<td align="right"></td>
<td align="right">0.00</td>
<td align="right">O</td>
</tr>
</tbody>
`;
    const anchor = '</tbody>\n</table>\n</div>\n</div>\n\n<div id="tblCombDiv_U0000001Body"';
    expect(html).toContain(anchor);
    const withSecondBlock = html.replace(anchor, `</tbody>\n${secondBlock}</table>\n</div>\n</div>\n\n<div id="tblCombDiv_U0000001Body"`);
    const result = parseActivityStatement(withSecondBlock, TARGET);

    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    const fx = result.transactions.find((t) => t.symbol === "GBP.EUR");
    expect(fx).toMatchObject({
      kind: "trade",
      secType: "CASH",
      quantity: 200,
      price: 1.15,
      amount: -230,
      // The block's header names its commission column "Comm in EUR", not
      // "Comm/Fee": the commission column is matched by the "Comm" prefix,
      // not by one fixed name, so the value is still read rather than lost.
      commission: -3,
      currency: "EUR",
    });
    // The first block's own rows still parse under its own, unaffected header.
    expect(result.transactions.some((t) => t.symbol === "TESTX")).toBe(true);
  });

  it("cancels everything when a required section has a row with the wrong cell count", () => {
    // Drop one <td> from the TESTX buy row: 10 cells instead of 11.
    const broken = html.replace(
      "<td>TESTX</td>\n<td>2025-01-02, 09:30:00</td>\n<td align=\"right\">100</td>\n<td align=\"right\">10.0000</td>\n<td align=\"right\">10.5000</td>\n<td align=\"right\">-1,000.00</td>\n<td align=\"right\">-1.00</td>\n<td align=\"right\">1001.00</td>\n<td align=\"right\">0.00</td>\n<td align=\"right\">50.00</td>\n<td align=\"right\">O</td>",
      "<td>TESTX</td>\n<td>2025-01-02, 09:30:00</td>\n<td align=\"right\">100</td>\n<td align=\"right\">10.0000</td>\n<td align=\"right\">10.5000</td>\n<td align=\"right\">-1,000.00</td>\n<td align=\"right\">-1.00</td>\n<td align=\"right\">1001.00</td>\n<td align=\"right\">0.00</td>\n<td align=\"right\">O</td>",
    );
    const result = parseActivityStatement(broken, TARGET);
    expect(result.transactions).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: "error", code: "normalization" }));
  });

  it("passes over an empty layout row, even in a required section, instead of cancelling the file", () => {
    // IB closes a table with `<tr class="border-top"><td colspan="…"></td></tr>`: no data, one cell.
    const bordered = html.replace("</table>", '<tr class="border-top"><td class="border-top" colspan="11"></td>\n</tr>\n</table>');
    const result = parseActivityStatement(bordered, TARGET);
    expect(result.issues).toEqual(parseActivityStatement(html, TARGET).issues);
    expect(result.transactions).toHaveLength(parseActivityStatement(html, TARGET).transactions.length);
  });

  it("warns column-missing when a watched column is renamed across the whole required section", () => {
    // Rename "Quantity" in both <thead> blocks of the Transactions table (the
    // main one and the Forex one added above), leaving CorporateActions'
    // unrelated "Quantity" header alone: the column is genuinely gone from
    // every header layout in scope for this section, not just empty on some
    // rows, mirroring the "all rows lack the attribute" signal flex.ts uses.
    let renamed = html.replace('<th align="right">Quantity</th>', '<th align="right">Qty</th>');
    renamed = renamed.replace('<th align="right">Quantity</th>', '<th align="right">Qty</th>');
    const result = parseActivityStatement(renamed, TARGET);
    expect(result.issues).toContainEqual({ severity: "warning", code: "column-missing", detail: "Transactions: Quantity" });
    // The section is still read, quantity simply unknown rather than invented.
    const buy = result.transactions.find((t) => t.symbol === "TESTX" && t.when === "2025-01-02T09:30:00.000Z");
    expect(buy?.quantity).toBeNull();
  });

  it("does not warn column-missing for the Comm* family when the Forex block's own header still has one", () => {
    const result = parseActivityStatement(html, TARGET);
    expect(result.issues.filter((i) => i.code === "column-missing" && i.detail.includes("Comm"))).toEqual([]);
  });

  it("raises currency-missing on a data row seen before any header-currency in scope", () => {
    // Drop the Stocks block's own header-currency row: the TESTX buy row is
    // now the section's very first data row with no currency context yet.
    const withoutCurrencyHeader = html.replace(
      '<tbody>\n<tr><td class="header-currency" align="left" valign="middle" colspan="11">USD</td></tr>\n</tbody>\n<tbody>\n<tr>\n<td>TESTX</td>\n<td>2025-01-02, 09:30:00</td>',
      '<tbody>\n<tr>\n<td>TESTX</td>\n<td>2025-01-02, 09:30:00</td>',
    );
    expect(html).not.toBe(withoutCurrencyHeader);
    const result = parseActivityStatement(withoutCurrencyHeader, TARGET);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: "warning", code: "currency-missing", detail: expect.stringContaining("Transactions") }),
    );
    const buy = result.transactions.find((t) => t.symbol === "TESTX" && t.when === "2025-01-02T09:30:00.000Z");
    expect(buy?.currency).toBe("");
  });
});

describe("parseActivityStatement cash sections", () => {
  const { transactions } = parseActivityStatement(html, TARGET);
  const byKind = (kind: string) => transactions.filter((t) => t.kind === kind);

  it("reads a dividend with its ticker pulled from the description, at midnight", () => {
    const [dividend] = byKind("dividend");
    expect(dividend).toMatchObject({
      symbol: "TESTX",
      amount: 10,
      currency: "USD",
      when: "2025-03-15T00:00:00.000Z",
      quantity: null,
      price: null,
      commission: null,
      secType: "",
    });
    expect(dividend.description).toContain("Cash Dividend");
  });

  it("reads withholding tax, fees and interest", () => {
    expect(byKind("tax")[0]).toMatchObject({ symbol: "TESTX", amount: -1.5 });
    expect(byKind("fee").length).toBeGreaterThan(0);
    expect(byKind("interest").length).toBeGreaterThan(0);
  });

  it("reads deposits and withdrawals as transfers with an empty symbol", () => {
    const transfers = byKind("transfer");
    expect(transfers.map((t) => t.amount)).toEqual([10000, -2500.5]);
    expect(transfers[0]).toMatchObject({ symbol: "", currency: "EUR", description: "Electronic Fund Transfer" });
  });

  it("reads a corporate action with its quantity and zero proceeds kept as zero", () => {
    const [split] = byKind("corporate_action");
    expect(split).toMatchObject({ symbol: "TESTX", quantity: 100, amount: 0, secType: "STK", when: "2025-05-30T20:00:00.000Z" });
  });

  it("turns an option cash settlement into a trade on the contract, without quantity", () => {
    const settlement = transactions.find((t) => t.description.startsWith("Exercise"));
    expect(settlement).toMatchObject({
      kind: "trade",
      secType: "OPT",
      symbol: "ZQX",
      expiry: "2025-08-15",
      strike: 500,
      right: "P",
      quantity: null,
      price: null,
      commission: null,
      amount: 250,
      currency: "USD",
      when: "2025-08-15T16:20:00.000Z",
    });
  });

  it("falls back to the parenthesised text as symbol when the contract does not parse, not the whole description", () => {
    const withUnparsableContract = html.replace(
      "Exercise ( ZQX 15AUG25 500 P )",
      "Exercise ( not a contract )",
    );
    const result = parseActivityStatement(withUnparsableContract, TARGET);
    const settlement = result.transactions.find((t) => t.description.startsWith("Exercise"));
    expect(settlement).toMatchObject({ symbol: "not a contract", amount: 250 });
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: "warning", code: "row-skipped" }),
    );
  });

  it("leaves symbol empty, rather than inventing one, when the description has no parentheses at all", () => {
    const withoutParentheses = html.replace(
      "Exercise ( ZQX 15AUG25 500 P )",
      "Exercise settlement, no contract given",
    );
    const result = parseActivityStatement(withoutParentheses, TARGET);
    const settlement = result.transactions.find((t) => t.description.startsWith("Exercise"));
    expect(settlement).toMatchObject({ symbol: "", amount: 250 });
  });
});

describe("parseActivityStatement corporate actions", () => {
  const cas = parseActivityStatement(html, TARGET).transactions.filter((t) => t.kind === "corporate_action");

  it("gives each leg the ticker it actually holds, not the description prefix", () => {
    const incoming = cas.find((t) => t.quantity === 114);
    const outgoing = cas.find((t) => t.quantity === -114);
    expect(incoming?.symbol).toBe("TESTP");
    expect(outgoing?.symbol).toBe("TESTV.OLD");
  });

  it("keeps the whole description on both legs, so they can be paired", () => {
    const legs = cas.filter((t) => Math.abs(t.quantity ?? 0) === 114);
    expect(legs).toHaveLength(2);
    expect(legs[0].description).not.toBe(legs[1].description);
    expect(legs[0].description.slice(0, 40)).toBe(legs[1].description.slice(0, 40));
  });

  it("reads Realized P/L, and leaves it null when the cell is empty", () => {
    expect(cas.find((t) => t.quantity === -120)?.realizedPnl).toBe(180.40);
    expect(cas.find((t) => t.quantity === 114)?.realizedPnl).toBe(0);
  });

  it("falls back on the description prefix when there is no trailing triple", () => {
    const legacy = cas.find((t) => t.quantity === 100);
    expect(legacy?.symbol).toBe("TESTX");
  });
});

describe("parseActivityStatement tail", () => {
  const result = parseActivityStatement(html, TARGET);
  const { transactions, issues } = result;

  it("does not warn about optional sections that are simply absent", () => {
    expect(issues.filter((i) => i.code === "section-missing")).toEqual([]);
  });

  it("gives every row a unique externalId", () => {
    const ids = transactions.map((t) => t.externalId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("warns that a Transfers section is present but not read", () => {
    const withTransfers = html.replace(
      "</body>",
      '<div id="tblTransfers_U0000001Body"><table><thead><tr><th>Date</th></tr></thead></table></div></body>',
    );
    expect(parseActivityStatement(withTransfers, TARGET).issues).toContainEqual({
      severity: "warning",
      code: "section-unread",
      detail: "Transfers",
    });
  });

  it("keeps the other rows and warns instead of cancelling when an optional section has a malformed row", () => {
    // Drop the Amount cell from the CombDiv row: 2 cells instead of 3.
    const broken = html.replace(
      '<td>2025-03-15</td>\n<td>TESTX(US0000000000) Cash Dividend USD 0.10 per Share (Ordinary Dividend)</td>\n<td align="right">10.00</td>',
      '<td>2025-03-15</td>\n<td>TESTX(US0000000000) Cash Dividend USD 0.10 per Share (Ordinary Dividend)</td>',
    );
    const brokenResult = parseActivityStatement(broken, TARGET);
    expect(brokenResult.transactions.filter((t) => t.kind === "dividend")).toEqual([]);
    expect(brokenResult.transactions.some((t) => t.kind === "tax")).toBe(true);
    expect(brokenResult.issues).toContainEqual(
      expect.objectContaining({ severity: "warning", code: "row-skipped", detail: expect.stringContaining("CombDiv") }),
    );
    expect(brokenResult.issues.some((i) => i.severity === "error")).toBe(false);
  });
});

describe("parseActivityStatement contract information", () => {
  const { identities } = parseActivityStatement(html, TARGET);

  it("reads the section whose id has no underscore before the account", () => {
    expect(identities.length).toBeGreaterThan(0);
  });

  it("reads every table of a section, not only the first", () => {
    // A 2025 statement splits Contract Information into one
    // `div.table-responsive > table` per asset category, Warrants first.
    // Stopping at the first table dropped every stock identity — and with it
    // the rename that links a ticker to the one that succeeds it.
    expect(identities.find((i) => i.conid === "810000001")).toMatchObject({ secType: "WAR", tickers: ["TESTWW"] });
    expect(identities.filter((i) => i.secType === "STK").map((i) => i.conid)).toEqual(["900000106", "900000105"]);
  });

  it("splits the Symbol cell into every alias of one conid", () => {
    const quanergy = identities.find((i) => i.conid === "900000106");
    expect(quanergy).toEqual({
      conid: "900000106",
      isin: "US7476000000",
      secType: "STK",
      // A contract has no balance to sit on: IB writes no currency block in this section.
      currency: "",
      description: "QUANERGY SYSTEMS INC",
      tickers: ["ZXAB", "ZXABQ"],
    });
  });

  it("reads a single-alias row", () => {
    expect(identities.find((i) => i.conid === "900000105")?.tickers).toEqual(["TESTZ"]);
  });

  it("reads columns by their header, not their rank", () => {
    // The 2024 statement inserts `Underlying` between `Security ID` and
    // `Listing Exch`; the fixture carries that column on the option row.
    expect(identities.find((i) => i.conid === "700000001")).toMatchObject({ secType: "OPT", tickers: ["TESTX  251219C00020000"] });
  });

  it("reads the section as IB writes it, without a currency block and closed by an empty border row, and warns about nothing", () => {
    // Every real statement: one currency-missing per contract, plus one row-skipped for the border.
    const { issues } = parseActivityStatement(html, TARGET);
    expect(issues.filter((i) => i.detail.startsWith("ContractInfo"))).toEqual([]);
    expect(identities.map((i) => i.conid)).toEqual(["810000001", "900000106", "900000105", "700000001"]);
  });

  it("yields an empty list when the section is absent", () => {
    const without = html.replace(/tblContractInfoU0000001Body/g, "tblGoneBody");
    expect(parseActivityStatement(without, TARGET).identities).toEqual([]);
  });
});

describe("parseActivityStatement cash report", () => {
  it("reads Starting Cash and Ending Cash per currency, dated by the declared period, never the base summary", () => {
    const result = parseActivityStatement(html, TARGET);
    expect(result.issues).toEqual([]);
    expect(result.cashReport).toEqual({
      start: { asOf: "2025-01-01", balances: { EUR: 0, USD: 1000 } },
      end: { asOf: "2025-12-31", balances: { EUR: 7597.7, USD: 2803.63 } },
    });
  });

  it("drops a currency block missing one of its two lines, and says so", () => {
    const noUsdEnd = html.replace('Ending Cash</td>\n<td align="right">2,803.63', 'Closing Cash</td>\n<td align="right">2,803.63');
    expect(noUsdEnd).not.toBe(html);
    const result = parseActivityStatement(noUsdEnd, TARGET);
    expect(result.cashReport).toEqual({
      start: { asOf: "2025-01-01", balances: { EUR: 0 } },
      end: { asOf: "2025-12-31", balances: { EUR: 7597.7 } },
    });
    expect(result.issues).toContainEqual({
      severity: "warning",
      code: "row-skipped",
      detail: "CashReport: USD without Starting Cash or Ending Cash",
    });
  });

  it("drops a currency whose amount cannot be read, keeps the rest of the file", () => {
    const unreadable = html.replace('Ending Cash</td>\n<td align="right">2,803.63', 'Ending Cash</td>\n<td align="right">two thousand');
    expect(unreadable).not.toBe(html);
    const result = parseActivityStatement(unreadable, TARGET);
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.transactions).toHaveLength(parseActivityStatement(html, TARGET).transactions.length);
    expect(result.cashReport).toEqual({
      start: { asOf: "2025-01-01", balances: { EUR: 0 } },
      end: { asOf: "2025-12-31", balances: { EUR: 7597.7 } },
    });
    expect(result.snapshot?.cashAvailable).toBeNull();
    expect(result.issues).toContainEqual({
      severity: "warning",
      code: "row-skipped",
      detail: "CashReport: USD amount unreadable",
    });
  });

  it("has no cash report, and no warning, when the section is absent", () => {
    const result = parseActivityStatement(html.replace(/tblCashReport_U0000001Body/g, "tblGoneBody"), TARGET);
    expect(result.cashReport).toBeNull();
    expect(result.issues).toEqual([]);
  });

  it("returns no cash report on a statement of another account", () => {
    expect(parseActivityStatement(html, { accountId: "test", ibAccountId: "U7777777" }).cashReport).toBeNull();
  });
});

describe("parseActivityStatement open positions", () => {
  const TESTE = {
    symbol: "TESTE", secType: "STK", right: "", strike: null, expiry: null, multiplier: 1, quantity: 10,
    avgPrice: 20.5, marketPrice: 21, marketValue: 210, unrealizedPnl: 5, dailyPnl: null, dayChange: null, currency: "EUR", conid: "", description: "TESTE",
  };
  const TWINX = {
    symbol: "TWINX", secType: "STK", right: "", strike: null, expiry: null, multiplier: 1, quantity: 20,
    avgPrice: 5.1, marketPrice: 6, marketValue: 120, unrealizedPnl: 18, dailyPnl: null, dayChange: null, currency: "USD", conid: "", description: "TWINX",
  };
  const PUT = {
    symbol: "TESTX", secType: "OPT", right: "P", strike: 15, expiry: "2026-01-16", multiplier: 100, quantity: -1,
    avgPrice: 1.4935, marketPrice: 0.8, marketValue: -80, unrealizedPnl: 69.35, dailyPnl: null, dayChange: null, currency: "USD", conid: "",
    description: "TESTX 16JAN26 15 P",
  };

  it("reads the positions into a snapshot at the period's end, with the USD Ending Cash", () => {
    const result = parseActivityStatement(html, TARGET);
    expect(result.issues).toEqual([]);
    expect(result.snapshot).toEqual({ asOf: "2025-12-31", positions: [TESTE, TWINX, PUT], cashAvailable: 2803.63 });
  });

  it("gives a statement position no day values: a file has no today", () => {
    const result = parseActivityStatement(html, TARGET);
    expect(result.snapshot?.positions[0].dailyPnl).toBeNull();
    expect(result.snapshot?.positions[0].dayChange).toBeNull();
  });

  it("keeps the summary row and skips a lot row: a lot repeats part of its summary's quantity", () => {
    const summary =
      '<td>TWINX</td>\n<td align="right">20</td>\n<td align="right">1</td>\n<td align="right">5.1</td>\n<td align="right">102.00</td>\n<td align="right">6.0000</td>\n<td align="right">120.00</td>\n<td align="right">18.00</td>\n<td align="right">&nbsp;</td>\n</tr>';
    const lot =
      '<tr class="row-detail">\n<td>TWINX</td>\n<td align="right">5</td>\n<td align="right">1</td>\n<td align="right">5.1</td>\n<td align="right">25.50</td>\n<td align="right">6.0000</td>\n<td align="right">30.00</td>\n<td align="right">4.50</td>\n<td align="right">&nbsp;</td>\n</tr>';
    const withLot = html.replace(summary, `${summary}\n${lot}`);
    expect(withLot).not.toBe(html);
    expect(parseActivityStatement(withLot, TARGET).snapshot?.positions).toEqual([TESTE, TWINX, PUT]);
  });

  it("drops the snapshot, never the file, on an unreadable quantity", () => {
    const broken = html.replace('<td align="right">-1</td>\n<td align="right">100</td>', '<td align="right">minus one</td>\n<td align="right">100</td>');
    expect(broken).not.toBe(html);
    const result = parseActivityStatement(broken, TARGET);
    expect(result.snapshot).toBeNull();
    expect(result.transactions).toHaveLength(parseActivityStatement(html, TARGET).transactions.length);
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: "warning", code: "row-skipped", detail: expect.stringContaining("OpenPositions: Unreadable number") }),
    );
  });

  it("drops the snapshot on an option whose contract it cannot read: a missing leg is worse than none", () => {
    const broken = html.replace("<td>TESTX 16JAN26 15 P</td>", "<td>TESTX JAN26 15 P</td>");
    expect(broken).not.toBe(html);
    const result = parseActivityStatement(broken, TARGET);
    expect(result.snapshot).toBeNull();
    expect(result.issues).toContainEqual({
      severity: "warning",
      code: "row-skipped",
      detail: 'OpenPositions: option contract not recognised in "TESTX JAN26 15 P"',
    });
  });

  it("drops the snapshot on a row with the wrong cell count", () => {
    const broken = html.replace('<td>TWINX</td>\n<td align="right">20</td>', "<td>TWINX</td>");
    expect(broken).not.toBe(html);
    const result = parseActivityStatement(broken, TARGET);
    expect(result.snapshot).toBeNull();
    expect(result.issues).toContainEqual(
      expect.objectContaining({ severity: "warning", code: "row-skipped", detail: expect.stringContaining("OpenPositions: row with 8 cell(s)") }),
    );
  });

  it("has no snapshot without the section, and says so", () => {
    const result = parseActivityStatement(html.replace(/tblOpenPositions_U0000001Body/g, "tblGoneBody"), TARGET);
    expect(result.snapshot).toBeNull();
    expect(result.issues).toEqual([{ severity: "warning", code: "section-missing", detail: "Open Positions" }]);
  });

  it("reads an empty section as an account that held nothing", () => {
    const empty = html.replace(/(<div id="tblOpenPositions_U0000001Body"[\s\S]*?<\/thead>)[\s\S]*?(<\/table>)/, "$1\n$2");
    expect(empty).not.toBe(html);
    expect(parseActivityStatement(empty, TARGET).snapshot).toEqual({ asOf: "2025-12-31", positions: [], cashAvailable: 2803.63 });
  });

  it("warns column-missing on a renamed column and leaves the value unknown", () => {
    const renamed = html.replace('<th align="right">Close Price</th>', '<th align="right">Last Price</th>');
    const result = parseActivityStatement(renamed, TARGET);
    expect(result.issues).toEqual([{ severity: "warning", code: "column-missing", detail: "OpenPositions: Close Price" }]);
    expect(result.snapshot?.positions.map((p) => p.marketPrice)).toEqual([null, null, null]);
  });

  it("leaves the cash unknown when the Cash Report is absent", () => {
    const result = parseActivityStatement(html.replace(/tblCashReport_U0000001Body/g, "tblGoneBody"), TARGET);
    expect(result.snapshot?.cashAvailable).toBeNull();
  });
});
