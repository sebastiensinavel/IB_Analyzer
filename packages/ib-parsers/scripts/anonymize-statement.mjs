#!/usr/bin/env node
// Anonymizes IB activity statements while keeping what an oracle needs:
// dates, quantities, section structure, event wording, and — across files —
// one stable mapping per real identifier. Quantities stay real, exactly as
// they do in flex_journals_corpus.xml and for the same reason: the
// reconciliation oracle is additive on quantities, and a linear map is
// always invertible (docs/points-reportes.md). Money, prices and strikes are
// not: they go through one monotone, non-linear map, and each file's Cash
// Report is then recomputed from its own anonymized transactions.
//
// Usage:
//   node scripts/anonymize-statement.mjs --out tests/fixtures/statement_ca_corpus \
//        ../../private/<account>_2022_2022.htm ../../private/<account>_2023_2023.htm \
//        ../../private/<account>_2024_2024.htm
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
if (outIndex === -1) throw new Error("--out <prefix> is required");
const outPrefix = args[outIndex + 1];
const inputs = args.filter((a, i) => i !== outIndex && i !== outIndex + 1 && !a.startsWith("--"));
if (inputs.length === 0) throw new Error("at least one statement is required");

/** One shared dictionary for every file: the same real value always maps to the same fake one. */
const maps = { account: new Map(), ticker: new Map(), conid: new Map(), isin: new Map(), name: new Map() };
const counters = { account: 0, ticker: 0, conid: 0, isin: 0, name: 0 };

/** Letters of a base-26 sequence: 0 -> AAA, 1 -> AAB… Deterministic and collision-free. */
function letters(n) {
  const a = String.fromCharCode(65 + Math.floor(n / 676) % 26);
  const b = String.fromCharCode(65 + Math.floor(n / 26) % 26);
  const c = String.fromCharCode(65 + (n % 26));
  return `${a}${b}${c}`;
}

function mapped(kind, value, make) {
  if (value === "") return "";
  const current = maps[kind].get(value);
  if (current !== undefined) return current;
  const next = make(counters[kind]++);
  maps[kind].set(value, next);
  return next;
}

/** A ticker keeps its suffix: "TESTX.OLD" -> "AAB.OLD", so `.OLD` still means `.OLD`. */
function mapTicker(ticker) {
  const dot = ticker.indexOf(".");
  if (dot !== -1) return `${mapTicker(ticker.slice(0, dot))}${ticker.slice(dot)}`;
  return mapped("ticker", ticker, (n) => letters(n));
}
const mapAccount = (v) => mapped("account", v, (n) => `U${9000000 + n}`);
const mapConid = (v) => mapped("conid", v, (n) => String(100000000 + n));
const mapIsin = (v) => mapped("isin", v, (n) => `US${String(1000000000 + n).padStart(10, "0")}`);
const mapName = (v) => mapped("name", v, (n) => `TEST COMPANY ${letters(n)}`);
/** A CUSIP is an ISIN without its country prefix and check digit: same map, nine characters. */
const mapCusip = (v) => mapped("isin", v, (n) => String(200000000 + n));

/**
 * Money, prices and strikes share one map over every distinct magnitude of the
 * corpus, never a scale factor: a published — or guessable — constant divides
 * back out, and a previous version of this script (SCALE = 0.7371) let anyone
 * recover every real figure of the account.
 *
 * - The distinct magnitudes are ranked, and rank i of n is placed at
 *   t = (i + 0.5) / n on a log scale between two FIXED bounds, not the file's
 *   own minimum and maximum, which would otherwise survive almost intact.
 * - The map is strictly increasing, so order survives: a mixed merger's
 *   `proceeds - realizedPnl` stays a positive basis below the proceeds.
 * - The same magnitude always gets the same image, so a delivery priced at
 *   its option's strike stays priced at it once both are rewritten.
 * - Row arithmetic (proceeds = quantity × price) does not survive, and the
 *   Cash Report would not add up; `rebalanceCashReports` rewrites its Starting
 *   and Ending Cash from the anonymized transactions themselves.
 *
 * Images lie between 1 and 100 000, rounded to the cent and nudged up by a
 * cent whenever rounding would tie two ranks: a strike stays a whole number of
 * thousandths, the only strikes the packed OSI form can spell.
 */
const LOG_MIN = 0;
const LOG_MAX = 5;
const magnitudes = new Set();
const moneyMap = new Map();

function numberOf(text) {
  const n = Number(text.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function noteMagnitude(value) {
  const magnitude = Math.abs(value);
  if (magnitude !== 0) magnitudes.add(magnitude);
}

function buildMoneyMap() {
  const sorted = [...magnitudes].sort((a, b) => a - b);
  let previous = 0;
  sorted.forEach((magnitude, i) => {
    const t = (i + 0.5) / sorted.length;
    const raw = 10 ** (LOG_MIN + t * (LOG_MAX - LOG_MIN));
    let image = Math.round(raw * 100) / 100;
    if (image <= previous) image = previous + 0.01;
    image = Number(image.toFixed(2));
    moneyMap.set(magnitude, image);
    previous = image;
  });
}

function mapMagnitude(value) {
  if (value === 0) return 0;
  const image = moneyMap.get(Math.abs(value));
  if (image === undefined) throw new Error("a magnitude was never collected");
  return value < 0 ? -image : image;
}

/** A cell keeps its own number of decimals, never fewer than two. */
function mapMoney(text) {
  const n = numberOf(text);
  if (n === null) return text;
  const image = mapMagnitude(n);
  const decimals = Math.max(/\.(\d+)$/.exec(text.trim())?.[1].length ?? 0, 2);
  return image.toFixed(decimals);
}

/** A strike as a contract name spells it: "12.5", never "12.50". */
function mapStrike(text) {
  const n = numberOf(text);
  return n === null ? text : String(mapMagnitude(n));
}

// ---------------------------------------------------------------------------
// Walking a statement
// ---------------------------------------------------------------------------

/** A cell's own text: no tag ever appears inside a `<td>` of a statement. */
function textOf(html) {
  return html.replace(/&nbsp;/g, " ").trim();
}

/**
 * Walks the tables of a statement in document order and replaces each data
 * cell's text by what `rewrite` returns. The columns in scope come from the
 * last row of the `<thead>` last seen — a section can carry several, one per
 * asset-category block, and a grouped header spells the real column names on
 * its bottom row — and are dropped at every `<table>`, so a table without a
 * header never inherits the previous one's. `colspan` is counted, so the
 * cells of a subtotal row line up with the columns they total. `asset` is the
 * last `header-asset` row of the section ("Stocks", "Forex"…).
 */
function mapCells(html, rewrite) {
  let section = "";
  let asset = "";
  let columns = [];
  return html.replace(
    /<div id="tbl([A-Za-z]+)_?[A-Z]\d+Body"|<table[^>]*>|<thead>[\s\S]*?<\/thead>|<tr[^>]*>[\s\S]*?<\/tr>/g,
    (block, sectionKey) => {
      if (sectionKey !== undefined) {
        section = sectionKey;
        asset = "";
        return block;
      }
      const header = /class="header-asset"[^>]*>([^<]*)</.exec(block);
      if (header) {
        asset = header[1].trim();
        return block;
      }
      if (block.startsWith("<table")) {
        columns = [];
        return block;
      }
      if (block.startsWith("<thead")) {
        const rows = block.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
        const last = rows[rows.length - 1] ?? "";
        columns = Array.from(last.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g), (m) => textOf(m[1]));
        return block;
      }
      let index = 0;
      return block.replace(/<td([^>]*)>([\s\S]*?)<\/td>/g, (cell, attrs, inner) => {
        const colspan = Number(/colspan="(\d+)"/.exec(attrs)?.[1] ?? 1);
        const column = columns[index] ?? "";
        index += colspan;
        const text = textOf(inner);
        const next = rewrite({ section, asset, column, text, colspan });
        return next === text ? cell : `<td${attrs}>${next}</td>`;
      });
    },
  );
}

// ---------------------------------------------------------------------------
// Reading the real dictionary, from every file, before rewriting any of them
// ---------------------------------------------------------------------------

const real = { accounts: new Set(), tickers: new Set(), names: new Set(), conids: new Set(), securityIds: new Set() };

const ISIN_RE = /\b[A-Z]{2}[A-Z0-9]{9}\d\b/g;
/** A CUSIP only ever appears parenthesised in a description; bare, nine digits are a conid. */
const CUSIP_RE = /\((\d[0-9A-Z]{8})\)/g;
const TICKER_RE = /^[A-Z][A-Z0-9]{0,5}(\.[A-Z]+)?$/;
/** A currency is not a ticker, whatever column it turns up in. */
const NOT_TICKERS = new Set(["USD", "EUR", "CAD", "GBP", "CHF", "JPY", "AUD", "HKD", "SGD", "SEK", "NOK", "DKK", "NZD", "MXN"]);
/** ContractInfo names an option contract, not a company, in its Description. */
const OPTION_CONTRACT_RE = /^\S+ \d{2}[A-Z]{3}\d{2} [\d.]+ [CP]$/;

function addTicker(ticker) {
  if (!TICKER_RE.test(ticker) || NOT_TICKERS.has(ticker)) return;
  real.tickers.add(ticker);
  const dot = ticker.indexOf(".");
  if (dot !== -1) addTicker(ticker.slice(0, dot));
}

/** "TESTX", "TESTX.OLD", "TESTX 17JAN25 2.5 P", "TESTX 241220P00002000" -> the ticker. */
function tickerOfSymbolCell(text) {
  return text.split(/\s+/)[0];
}

/**
 * A description names its contract twice: "TESTX(US0000000000) Merged(…) …
 * (TESTY, TEST COMPANY TWO, US0000000001)" — the event's own ticker first,
 * the leg's ticker, company name and ISIN last.
 */
function collectFromDescription(text) {
  const prefix = /^([A-Z][A-Za-z0-9.]*)\(/.exec(text);
  if (prefix) addTicker(prefix[1]);
  const leg = /\(([A-Za-z0-9.]+),\s*(.+?),\s*[A-Z0-9]{9,12}\)\s*$/.exec(text);
  if (leg) {
    addTicker(leg[1]);
    if (leg[2].length >= 3) real.names.add(leg[2]);
  }
}

/** `mapCells` walks here rather than rewrites: every cell is returned unchanged. */
function collect(html) {
  for (const [, account] of html.matchAll(/id="(?:tbl|sec)[A-Za-z]+_?([A-Z]\d+)(?:Body|Heading)"/g)) real.accounts.add(account);
  const holder = /<td>Name<\/td>\s*<td>([^<]+)<\/td>/.exec(html);
  if (holder) real.names.add(holder[1].trim());
  for (const [isin] of html.matchAll(ISIN_RE)) real.securityIds.add(isin);
  for (const [, cusip] of html.matchAll(CUSIP_RE)) real.securityIds.add(cusip);
  mapCells(html, ({ section, column, text, colspan }) => {
    if (colspan !== 1 || text === "") return text;
    if (column === "Symbol") addTicker(tickerOfSymbolCell(text));
    if (column === "Underlying") addTicker(text);
    if (column === "Conid" && /^\d+$/.test(text)) real.conids.add(text);
    if (column === "Description") {
      if (section === "ContractInfo") {
        if (!OPTION_CONTRACT_RE.test(text)) real.names.add(text);
      } else collectFromDescription(text);
    }
    return text;
  });
}

// ---------------------------------------------------------------------------
// Rewriting
// ---------------------------------------------------------------------------

/**
 * Columns copied verbatim: identity, structure, dates and quantities. Every
 * other numeric cell is money and gets mapped, so a column IB renames or adds
 * tomorrow is mapped rather than leaked. A strike is mapped too, through the
 * same map, wherever it is written.
 */
const KEEP_COLUMNS = new Set([
  "Symbol", "Description", "Conid", "Security ID", "Underlying", "Listing Exch", "Type", "Code",
  "Multiplier", "Mult", "Strike", "Expiry", "Delivery Month", "Quantity",
  "Date", "Date/Time", "Report Date", "Ex Date", "Pay Date", "Meaning", "Code (Cont.)", "Meaning (Cont.)",
]);
/** A Forex "quantity" is a cash amount, not a share count: money, and mapped like money. */
const MONEY_QUANTITY_SECTIONS = new Set(["FxPositions"]);
const MONEY_QUANTITY_ASSETS = new Set(["Forex"]);
const NUMBER_RE = /^-?[\d,]+(?:\.\d+)?%?$/;
/** "TESTX 17JAN25 2.5 P": ticker, expiry, strike, right. */
const OPTION_NAME_RE = /\b([A-Z][A-Z0-9.]{0,9} \d{2}[A-Z]{3}\d{2} )(\d+(?:\.\d+)?)( [CP])\b/g;
/**
 * A cash amount per share written into a description: "Cash Dividend USD 0.14 per Share",
 * "534 FOR 1000 AND USD 11.75236923 (…". No parser reads it, and with its date it would name
 * the company.
 */
const PER_SHARE_RE = /(\b[A-Z]{3} )(\d+(?:\.\d+)?)(?= per Share\b| \()/g;
/** The tail of a packed OCC symbol: expiry and right, then the strike in thousandths. */
const OCC_STRIKE_RE = /(\d{6}[CP])(\d{8})\b/g;

/** "money", "strike", or null for a cell copied verbatim. */
function cellKind({ section, asset, column, text }) {
  if (!NUMBER_RE.test(text)) return null;
  if (column === "Strike") return "strike";
  if (column === "Quantity" && MONEY_QUANTITY_ASSETS.has(asset)) return "money";
  if (KEEP_COLUMNS.has(column) && !MONEY_QUANTITY_SECTIONS.has(section)) return null;
  return "money";
}

/** Every magnitude the map must place, from every file, before any file is rewritten. */
function collectMagnitudes(html) {
  mapCells(html, (cell) => {
    if (cellKind(cell) !== null) noteMagnitude(numberOf(cell.text.replace(/%$/, "")) ?? 0);
    return cell.text;
  });
  for (const [, , strike] of html.matchAll(OPTION_NAME_RE)) noteMagnitude(Number(strike));
  for (const [, , thousandths] of html.matchAll(OCC_STRIKE_RE)) noteMagnitude(Number(thousandths) / 1000);
  for (const [, , amount] of html.matchAll(PER_SHARE_RE)) noteMagnitude(Number(amount));
}

function mapMoneyCells(html) {
  return mapCells(html, (cell) => {
    const kind = cellKind(cell);
    if (kind === "strike") return mapStrike(cell.text);
    if (kind === null) return cell.text;
    return cell.text.endsWith("%") ? `${mapMoney(cell.text.slice(0, -1))}%` : mapMoney(cell.text);
  });
}

/** Strikes written inside contract names, spelled out or packed, and amounts per share in descriptions. */
function mapStrikesInNames(html) {
  return html
    .replace(PER_SHARE_RE, (whole, head, amount) => `${head}${mapStrike(amount)}`)
    .replace(OPTION_NAME_RE, (whole, head, strike, right) => `${head}${mapStrike(strike)}${right}`)
    .replace(OCC_STRIKE_RE, (whole, head, thousandths) =>
      `${head}${String(Math.round(mapMagnitude(Number(thousandths) / 1000) * 1000)).padStart(8, "0")}`,
    );
}

// ---------------------------------------------------------------------------
// The Cash Report, recomputed
// ---------------------------------------------------------------------------

/**
 * The parser and the ledger, loaded through Vite's module runner: they are
 * TypeScript, and this script is plain Node. Resolved from vitest, the one
 * dependency of this package that brings Vite along.
 */
async function loadEngine() {
  // The parser reads HTML through the browser's DOMParser; jsdom stands in, as in the tests.
  const { JSDOM } = await import("jsdom");
  globalThis.DOMParser ??= new JSDOM().window.DOMParser;
  const fromVitest = createRequire(fileURLToPath(import.meta.resolve("vitest")));
  const vite = await import(pathToFileURL(fromVitest.resolve("vite")).href);
  const root = fileURLToPath(new URL("..", import.meta.url));
  const options = { root, configFile: false, logLevel: "error" };
  const parsers = await vite.runnerImport(fileURLToPath(new URL("../src/index.ts", import.meta.url)), options);
  const ledger = await vite.runnerImport("@ib/ledger", options);
  return { parseActivityStatement: parsers.module.parseActivityStatement, runningBalances: ledger.module.runningBalances };
}

/** Rewrites the Total and Securities cells of one currency's Starting and Ending Cash rows. */
function setCashRow(html, currency, label, value) {
  const body = /<div id="tblCashReport_[A-Z]\d+Body"[\s\S]*?<\/table>/.exec(html);
  if (!body) throw new Error("no Cash Report to rebalance");
  let current = "";
  let found = false;
  const rewritten = body[0].replace(/<tr[^>]*>[\s\S]*?<\/tr>/g, (row) => {
    const header = /class="header-currency"[^>]*>([^<]*)</.exec(row);
    if (header) {
      current = header[1].trim();
      return row;
    }
    const cells = Array.from(row.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g));
    if (current !== currency || cells.length < 3 || textOf(cells[0][2]) !== label) return row;
    found = true;
    let index = 0;
    // Cells 1 and 2: Total, then Securities.
    return row.replace(/<td([^>]*)>([\s\S]*?)<\/td>/g, (cell, attrs) => {
      const at = index++;
      return at === 1 || at === 2 ? `<td${attrs}>${value.toFixed(2)}</td>` : cell;
    });
  });
  if (!found) throw new Error(`no ${currency} ${label} row in the Cash Report`);
  return html.replace(body[0], () => rewritten);
}

/**
 * Each file's Starting Cash is the previous file's Ending Cash — the first
 * file keeps its own, zero at the account's opening — and its Ending Cash is
 * that plus the cash its own anonymized transactions move, exactly as the
 * ledger adds it up (`runningBalances`). The movement lines in between stay
 * mapped figures that no longer sum: nothing reads them.
 */
async function rebalanceCashReports(files) {
  const { parseActivityStatement, runningBalances } = await loadEngine();
  const ordered = [...files].sort((a, b) => (a.out < b.out ? -1 : 1));
  const carried = new Map();
  for (const file of ordered) {
    const ibAccountId = /tbl[A-Za-z]+_?([A-Z]\d+)Body/.exec(file.html)[1];
    const parsed = parseActivityStatement(file.html, { accountId: "anonymizer", ibAccountId });
    if (!parsed.cashReport) throw new Error(`${file.out}: no Cash Report parsed`);
    const currencies = Object.keys(parsed.cashReport.end.balances);
    const rows = runningBalances(parsed.transactions, currencies);
    const moved = rows.length === 0 ? {} : rows[rows.length - 1].balances;
    for (const currency of currencies) {
      const start = carried.get(currency) ?? parsed.cashReport.start.balances[currency] ?? 0;
      const end = Math.round((start + (moved[currency] ?? 0)) * 100) / 100;
      file.html = setCashRow(setCashRow(file.html, currency, "Starting Cash", start), currency, "Ending Cash", end);
      carried.set(currency, end);
    }
  }
}

/**
 * ContractInfo spells an option as a packed OCC symbol whose root is padded
 * to six characters. Rewriting the root through the ticker map alone would
 * shorten that field; it is re-padded so the packed form stays readable by
 * whatever reads it.
 */
function rewriteOccSymbols(html) {
  return html.replace(/\b([A-Z][A-Z0-9]{0,5}) {0,5}(\d{6}[CP]\d{8})\b/g, (whole, root, rest) =>
    real.tickers.has(root) ? `${mapTicker(root).padEnd(6, " ")}${rest}` : whole,
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A literal only matches a whole word, so the ticker "AI" never matches
 * inside "MAIN". An account id is exempt: it lives glued to word characters
 * in every section id ("tblTransactions_U0000001Body"), where a word
 * boundary — "_" being a word character — would never fire.
 */
function boundedLiteral(value) {
  if (real.accounts.has(value)) return escapeRegExp(value);
  return `${/^\w/.test(value) ? "\\b" : ""}${escapeRegExp(value)}${/\w$/.test(value) ? "\\b" : ""}`;
}

/**
 * Every real identifier is rewritten in one pass, longest first: a company
 * name ("T3.AI INC-A") is matched before the ticker it contains ("AI"), and
 * nothing this pass writes is ever read back by it — an image can never be
 * mistaken for a real value and mapped twice.
 */
function rewriteIdentifiers(html) {
  const literals = [
    ...real.accounts, ...real.names, ...real.securityIds, ...real.conids, ...real.tickers,
  ].sort((a, b) => b.length - a.length);
  const pattern = new RegExp([...literals.map(boundedLiteral), ISIN_RE.source].join("|"), "g");
  return html.replace(pattern, (value) => {
    if (real.accounts.has(value)) return mapAccount(value);
    if (real.names.has(value)) return mapName(value);
    if (real.conids.has(value)) return mapConid(value);
    if (real.tickers.has(value)) return mapTicker(value);
    if (/^\d/.test(value)) return mapCusip(value);
    return mapIsin(value);
  });
}

/** "…Activity Statement January 1, 2023 - December 31, 2023…" -> "2023". */
function yearOf(html) {
  const match = /Activity Statement\s+[A-Z][a-z]+ \d{1,2}, (\d{4})/.exec(html);
  if (!match) throw new Error("no statement period in the title");
  return match[1];
}

// ---------------------------------------------------------------------------
// The self-check: a fixture is committed forever, so the script refuses to
// write one that still carries a real value it knows about.
// ---------------------------------------------------------------------------

function assertNoLeak(path, html) {
  // A leak is reported by its length, never by its value: this message ends up
  // quoted in a terminal, a report or a review.
  const leaks = [];
  for (const [kind, values] of Object.entries(real)) {
    for (const value of values) {
      if (new RegExp(boundedLiteral(value)).test(html)) leaks.push(`${kind}: ${value.length} characters`);
    }
  }
  const images = new Set(maps.isin.values());
  for (const [isin] of html.matchAll(ISIN_RE)) {
    if (!images.has(isin)) leaks.push(`an unmapped ISIN of ${isin.length} characters`);
  }
  if (leaks.length > 0) throw new Error(`${path} still carries real data: ${leaks.join(", ")}`);
}

/** An image that collides with a real value would be rewritten in its turn. */
function assertNoImageCollision() {
  const reals = new Set([...real.accounts, ...real.names, ...real.securityIds, ...real.conids, ...real.tickers]);
  for (const map of Object.values(maps)) {
    for (const image of map.values()) {
      if (reals.has(image)) throw new Error(`the image "${image}" is itself a real value`);
    }
  }
}

// ---------------------------------------------------------------------------

const files = inputs.map((path) => ({ path, html: readFileSync(path, "utf8") }));
for (const file of files) {
  collect(file.html);
  collectMagnitudes(file.html);
}
buildMoneyMap();
const anonymized = files.map((file) => {
  const html = rewriteIdentifiers(rewriteOccSymbols(mapStrikesInNames(mapMoneyCells(file.html))));
  return { path: file.path, out: `${outPrefix}_${yearOf(html)}.htm`, html };
});
assertNoImageCollision();
await rebalanceCashReports(anonymized);
for (const file of anonymized) {
  assertNoLeak(file.out, file.html);
  writeFileSync(file.out, file.html);
  console.error(`${file.path} -> ${file.out}`);
}
console.error(
  `mapped ${maps.account.size} account(s), ${maps.ticker.size} ticker(s), ${maps.conid.size} conid(s), ` +
    `${maps.isin.size} security id(s), ${maps.name.size} name(s), ${moneyMap.size} money magnitude(s)`,
);
