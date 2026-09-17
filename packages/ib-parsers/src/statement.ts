import type { Position, Transaction, TransactionKind } from "@ib/ledger";
import {
  NormalizationError,
  legFromDescription,
  parseNumber,
  parseStatementDateTime,
  splitOptionSymbol,
  symbolFromDescription,
} from "./common.ts";
import { statementExternalId, suffixTwins } from "./hash.ts";
import type { ContractIdentity } from "./identity.ts";
import { error, warning, type ParseIssue, type ParseResult, type ParseTarget } from "./issues.ts";
import { CURRENCY_CODE_RE, type CashReport, type FileSnapshot } from "./snapshot.ts";

export interface StatementInfo {
  ibAccountId: string;
  /** YYYY-MM-DD, from the statement title. */
  periodStart: string;
  periodEnd: string;
}

export interface StatementParseResult extends ParseResult<StatementInfo> {
  /** Contract Information of this file; empty when the section is absent. */
  identities: ContractIdentity[];
  /** Open Positions and USD Ending Cash at `periodEnd`; `null` when absent or unreadable. */
  snapshot: FileSnapshot | null;
  /** Starting and Ending Cash per currency over the declared period; `null` without the section. */
  cashReport: CashReport | null;
}

const SEC_TYPE_BY_CATEGORY: Record<string, string> = {
  Stocks: "STK",
  "Equity and Index Options": "OPT",
  Forex: "CASH",
  Warrants: "WAR",
};

const MONTHS: Record<string, number> = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

interface SectionRow {
  cells: Record<string, string>;
  assetCategory: string;
  currency: string;
}

interface Section {
  key: string;
  rows: SectionRow[];
  /** Union of every `<thead>`'s column names seen in this section's table. */
  columnsSeen: Set<string>;
}

interface Context {
  target: ParseTarget;
  ibAccountId: string;
  doc: Document;
  issues: ParseIssue[];
  /** Asset categories already reported unknown, one warning each. */
  unknownCategories: Set<string>;
}

export function parseActivityStatement(html: string, target: ParseTarget): StatementParseResult {
  const doc = new DOMParser().parseFromString(html, "text/html");

  const firstSection = Array.from(doc.querySelectorAll('div[id^="tbl"][id$="Body"]')).find((el) =>
    /^tbl[A-Za-z]+_.+Body$/.test(el.id),
  );
  if (!firstSection) {
    return { transactions: [], statement: null, identities: [], snapshot: null, cashReport: null, issues: [error("normalization", "Not an activity statement")] };
  }
  const ibAccountId = /^tbl[A-Za-z]+_(.+)Body$/.exec(firstSection.id)![1];

  const period = readPeriod(doc.title);
  if (!period) {
    return {
      transactions: [],
      statement: null,
      identities: [],
      snapshot: null,
      cashReport: null,
      issues: [error("normalization", `Statement period not found in title "${doc.title}"`)],
    };
  }
  const statement: StatementInfo = { ibAccountId, periodStart: period.start, periodEnd: period.end };

  if (ibAccountId !== target.ibAccountId) {
    return {
      transactions: [],
      statement,
      identities: [],
      snapshot: null,
      cashReport: null,
      issues: [error("account-mismatch", `File belongs to account ${ibAccountId}, expected ${target.ibAccountId}`)],
    };
  }

  const ctx: Context = { target, ibAccountId, doc, issues: [], unknownCategories: new Set() };
  try {
    const transactions = suffixTwins([...parseTrades(ctx), ...parseOtherSections(ctx)]);
    const identities = parseContractInfo(ctx);
    const cashReport = parseCashReport(ctx, statement);
    const snapshot = parseOpenPositions(ctx, statement, cashReport);
    return { transactions, statement, identities, snapshot, cashReport, issues: ctx.issues };
  } catch (e) {
    if (e instanceof NormalizationError) {
      return { transactions: [], statement, identities: [], snapshot: null, cashReport: null, issues: [...ctx.issues, error("normalization", e.message)] };
    }
    throw e;
  }
}

/** "U0000001 Activity Statement January 1, 2025 - December 31, 2025 - Interactive Brokers" */
function readPeriod(title: string): { start: string; end: string } | null {
  const match = /Activity Statement\s+([A-Z][a-z]+ \d{1,2}, \d{4})(?:\s+-\s+([A-Z][a-z]+ \d{1,2}, \d{4}))?/.exec(title);
  if (!match) return null;
  const start = longDateToIso(match[1]);
  const end = match[2] ? longDateToIso(match[2]) : start;
  return start && end ? { start, end } : null;
}

function longDateToIso(text: string): string | null {
  const match = /^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/.exec(text);
  if (!match) return null;
  const month = MONTHS[match[1]];
  if (!month) return null;
  return `${match[3]}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function cellText(el: Element): string {
  return (el.textContent ?? "").replace(/\u00a0/g, " ").trim();
}

/**
 * One IB section: header cells name the columns; `subtotal`/`total` rows are
 * skipped; single-cell `header-asset` / `header-currency` rows set the context
 * of the data rows that follow.
 *
 * A table can carry more than one `<thead>`: IB repeats the header, with its
 * own column layout, once per asset-category block instead of reusing a
 * single table-wide header (seen live in a real Transactions section split
 * into Stocks / Options / Forex blocks, the last with renamed columns).
 * `querySelectorAll("thead, tr")` walks both in document order, so the
 * in-scope `columns` is simply reset each time a new `<thead>` is reached and
 * applied to the data rows that follow it, until the next one.
 *
 * `noCurrency` names a section IB writes without any `header-currency` row —
 * Contract Information: a contract has no balance to sit on — so a row without
 * one is expected there, never a warning.
 */
function readSection(
  ctx: Context,
  key: string,
  required: boolean,
  options: { summaryRowsOnly?: boolean; noCurrency?: boolean } = {},
): Section | null {
  // IB is inconsistent: most sections are `tbl<Key>_<account>Body`, but
  // ContractInfo and FIFOPerfSumByUnderlying drop the separator entirely.
  const body =
    ctx.doc.getElementById(`tbl${key}_${ctx.ibAccountId}Body`) ??
    ctx.doc.getElementById(`tbl${key}${ctx.ibAccountId}Body`);
  // One section is one logical table, but IB does not always write it as one:
  // a 2025 statement splits Contract Information into one
  // `div.table-responsive > table` per asset category (Warrants, Stocks,
  // Equity and Index Options). Stopping at the first table would drop whole
  // categories without a word — and with them the renames they carry.
  const tables = Array.from(body?.querySelectorAll("table") ?? []);
  if (tables.length === 0) return null;
  const columnsSeen = new Set(
    tables
      .flatMap((table) => Array.from(table.querySelectorAll("thead")))
      .flatMap((thead) => Array.from(thead.querySelectorAll("th")).map(cellText).filter(Boolean)),
  );
  const rows: SectionRow[] = [];
  // The asset category and the currency in scope carry from one table to the
  // next: the split is a layout accident, not a new section.
  let assetCategory = "";
  let currency = "";
  for (const table of tables) {
    let columns = Array.from(table.querySelector("thead")?.querySelectorAll("th") ?? []).map(cellText);
    for (const node of Array.from(table.querySelectorAll("thead, tr"))) {
      if (node.tagName === "THEAD") {
        columns = Array.from(node.querySelectorAll("th")).map(cellText);
        continue;
      }
      const tr = node;
      if (tr.closest("thead")) continue;
      if (tr.classList.contains("subtotal") || tr.classList.contains("total")) continue;
      const tds = Array.from(tr.children).filter((el) => el.tagName === "TD");
      if (tds.length === 1 && tds[0].classList.contains("header-asset")) {
        assetCategory = cellText(tds[0]);
        continue;
      }
      if (tds.length === 1 && tds[0].classList.contains("header-currency")) {
        currency = cellText(tds[0]);
        continue;
      }
      if (tds.length === 0) continue;
      // A lot row repeats part of its summary row's quantity, like a Flex LOT row: where asked,
      // keep only the rows IB leaves unclassed or marks as a summary.
      if (options.summaryRowsOnly && tr.classList.length > 0 && !tr.classList.contains("row-summary")) continue;
      const values = tds.map(cellText);
      // IB closes a table with an empty border row (`<tr class="border-top"><td colspan="11"></td></tr>`):
      // no data at all, whatever its cell count, so nothing to skip, warn about or cancel on.
      if (values.every((value) => value === "")) continue;
      if (values.length !== columns.length) {
        const detail = `${key}: row with ${values.length} cell(s), expected ${columns.length} (${values.join(" | ")})`;
        if (required) throw new NormalizationError(detail);
        ctx.issues.push(warning("row-skipped", detail));
        continue;
      }
      if (currency === "" && !options.noCurrency) {
        // No `header-currency` row has been seen yet in this section: the row
        // cannot be placed on any balance. A warning, not an error, since the
        // rest of the section (and the file) is still worth writing.
        ctx.issues.push(warning("currency-missing", `${key}: row with no header-currency in scope (${values.join(" | ")})`));
      }
      const cells: Record<string, string> = {};
      columns.forEach((column, i) => (cells[column] = values[i]));
      rows.push({ cells, assetCategory, currency });
    }
  }
  return { key, rows, columnsSeen };
}

/**
 * A column watched by exact name, or by a predicate for a family of column
 * names (e.g. every "Comm…" variant). Left out of *every* header layout seen
 * in the section, it is a genuine rename or removal, not just an empty cell
 * on some rows — the same "all rows" signal `reportMissingColumns` in
 * `flex.ts` relies on, adapted to a section that can carry more than one
 * `<thead>` layout.
 */
type WatchedColumn = string | { label: string; test: (column: string) => boolean };

function reportMissingColumns(ctx: Context, sectionData: Section, watched: readonly WatchedColumn[]): void {
  if (sectionData.rows.length === 0) return;
  for (const column of watched) {
    const found = typeof column === "string"
      ? sectionData.columnsSeen.has(column)
      : Array.from(sectionData.columnsSeen).some(column.test);
    if (!found) {
      const label = typeof column === "string" ? column : column.label;
      ctx.issues.push(warning("column-missing", `${sectionData.key}: ${label}`));
    }
  }
}

function secTypeOf(ctx: Context, category: string): string {
  if (category === "") return "";
  const known = SEC_TYPE_BY_CATEGORY[category];
  if (known) return known;
  if (!ctx.unknownCategories.has(category)) {
    ctx.unknownCategories.add(category);
    ctx.issues.push(warning("unknown-asset-category", category));
  }
  return category;
}

const TRANSACTIONS_WATCHED_COLUMNS: readonly WatchedColumn[] = [
  "Symbol",
  "Date/Time",
  "Quantity",
  "T. Price",
  "Proceeds",
  // Not one fixed name: a block's own header can rename it to "Comm in
  // <currency>" (seen live on a Forex block), so `commissionCell` below
  // matches any column starting with "Comm" rather than one exact string.
  { label: "Comm*", test: (column: string) => column.startsWith("Comm") },
];

/**
 * The commission column is not always spelled "Comm/Fee": IB renames it
 * "Comm in <currency>" on at least the Forex block of a real statement. Any
 * header starting with "Comm" is the commission column; when it names a
 * currency, that currency is already the one the ledger wants the value in
 * (the base leg of the pair for a conversion row), so the value is kept as
 * read, with no further conversion.
 */
function commissionCell(cells: Record<string, string>): string | undefined {
  const key = Object.keys(cells).find((column) => column.startsWith("Comm"));
  return key === undefined ? undefined : cells[key];
}

function parseTrades(ctx: Context): Transaction[] {
  const sectionData = readSection(ctx, "Transactions", true);
  if (!sectionData) {
    ctx.issues.push(warning("section-missing", "Transactions"));
    return [];
  }
  reportMissingColumns(ctx, sectionData, TRANSACTIONS_WATCHED_COLUMNS);
  return sectionData.rows.map((row) => {
    const symbolText = row.cells["Symbol"] ?? "";
    const { symbol, expiry, strike, right } = splitOptionSymbol(symbolText);
    const secType = secTypeOf(ctx, row.assetCategory);
    if (secType === "OPT" && right === "") {
      ctx.issues.push(warning("row-skipped", `Transactions: option contract not recognised in "${symbolText}" (row kept with the whole cell as symbol)`));
    }
    const what = `trade ${symbolText} ${row.cells["Date/Time"]}`;
    const when = parseStatementDateTime(row.cells["Date/Time"], what);
    const quantity = parseNumber(row.cells["Quantity"], `${what} quantity`);
    const price = parseNumber(row.cells["T. Price"], `${what} price`);
    const amount = parseNumber(row.cells["Proceeds"], `${what} proceeds`);
    return {
      accountId: ctx.target.accountId,
      externalId: statementExternalId({ accountId: ctx.target.accountId, section: "Transactions", symbol, when, quantity, price, amount }),
      source: "statement_html",
      kind: "trade",
      symbol,
      secType,
      right,
      strike,
      expiry,
      quantity,
      price,
      amount,
      commission: parseNumber(commissionCell(row.cells), `${what} commission`),
      currency: row.currency,
      when,
      description: symbolText,
    } satisfies Transaction;
  });
}

const CASH_SECTION_KIND: Record<string, TransactionKind> = {
  CombDiv: "dividend",
  WithholdingTax: "tax",
  CombFees: "fee",
  CombInt: "interest",
  CombDepWith: "transfer",
};

function parseOtherSections(ctx: Context): Transaction[] {
  const out: Transaction[] = [];
  for (const key of Object.keys(CASH_SECTION_KIND)) out.push(...parseCashSection(ctx, key));
  out.push(...parseCorporateActions(ctx));
  out.push(...parseOptionCashSettlements(ctx));
  if (ctx.doc.getElementById(`tblTransfers_${ctx.ibAccountId}Body`)) {
    ctx.issues.push(warning("section-unread", "Transfers"));
  }
  return out;
}

function cashRow(
  ctx: Context,
  section: string,
  kind: TransactionKind,
  row: SectionRow,
  fields: { symbol: string; secType: string; right: "C" | "P" | ""; strike: number | null; expiry: string | null; quantity: number | null; when: string; description: string },
): Transaction {
  const amount = parseNumber(row.cells["Amount"] ?? row.cells["Proceeds"], `${section} ${fields.description} amount`);
  return {
    accountId: ctx.target.accountId,
    externalId: statementExternalId({
      accountId: ctx.target.accountId,
      section,
      symbol: fields.symbol,
      when: fields.when,
      quantity: fields.quantity,
      price: null,
      amount,
    }),
    source: "statement_html",
    kind,
    symbol: fields.symbol,
    secType: fields.secType,
    right: fields.right,
    strike: fields.strike,
    expiry: fields.expiry,
    quantity: fields.quantity,
    price: null,
    amount,
    commission: null,
    currency: row.currency,
    when: fields.when,
    description: fields.description,
  };
}

/** Date / Description / Amount sections under per-currency headers. */
function parseCashSection(ctx: Context, key: string): Transaction[] {
  const sectionData = readSection(ctx, key, false);
  if (!sectionData) return [];
  return sectionData.rows.map((row) => {
    const description = row.cells["Description"] ?? "";
    return cashRow(ctx, key, CASH_SECTION_KIND[key], row, {
      symbol: symbolFromDescription(description),
      secType: "",
      right: "",
      strike: null,
      expiry: null,
      quantity: null,
      when: parseStatementDateTime(row.cells["Date"], `${key} ${description}`),
      description,
    });
  });
}

function parseCorporateActions(ctx: Context): Transaction[] {
  const sectionData = readSection(ctx, "CorporateActions", false);
  if (!sectionData) return [];
  return sectionData.rows.map((row) => {
    const description = row.cells["Description"] ?? "";
    const leg = legFromDescription(description);
    const tx = cashRow(ctx, "CorporateActions", "corporate_action", row, {
      // The leg's own ticker, not the description prefix: both rows of one
      // event share that prefix, and a conversion that gave them the same
      // symbol would net to zero instead of moving the position.
      symbol: leg ? leg.ticker : symbolFromDescription(description),
      secType: secTypeOf(ctx, row.assetCategory),
      right: "",
      strike: null,
      expiry: null,
      quantity: parseNumber(row.cells["Quantity"], `corporate action ${description} quantity`),
      when: parseStatementDateTime(row.cells["Date/Time"], `corporate action ${description}`),
      description,
    });
    return { ...tx, realizedPnl: parseNumber(row.cells["Realized P/L"], `corporate action ${description} realized P/L`) };
  });
}

/**
 * Contract Information: the statement's own Rosetta stone. `Symbol` is a
 * comma-separated list of every spelling this contract wore in this file, so
 * a ticker change that IB does not report as an event (ZXAB -> ZXABQ) is
 * still visible here, under one unchanged conid.
 */
function parseContractInfo(ctx: Context): ContractIdentity[] {
  const sectionData = readSection(ctx, "ContractInfo", false, { noCurrency: true });
  if (!sectionData) return [];
  const identities: ContractIdentity[] = [];
  for (const row of sectionData.rows) {
    const conid = (row.cells["Conid"] ?? "").trim();
    if (conid === "") continue;
    const tickers = (row.cells["Symbol"] ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tickers.length === 0) continue;
    identities.push({
      conid,
      isin: (row.cells["Security ID"] ?? "").trim(),
      secType: secTypeOf(ctx, row.assetCategory),
      currency: row.currency,
      description: (row.cells["Description"] ?? "").trim(),
      tickers,
    });
  }
  return identities;
}

/**
 * A cash-settled index option (XSP, SPX) exercised or assigned delivers no
 * shares: the Transactions section closes the position at price 0 and this
 * section carries the cash actually paid. Without it every settlement is
 * missing from the running balance.
 */
function parseOptionCashSettlements(ctx: Context): Transaction[] {
  const sectionData = readSection(ctx, "OptionCashSettlement", false);
  if (!sectionData) return [];
  return sectionData.rows.map((row) => {
    const description = row.cells["Description"] ?? "";
    const contractText = /\(\s*(.+?)\s*\)/.exec(description)?.[1] ?? "";
    const contract = splitOptionSymbol(contractText);
    if (contract.right === "") {
      ctx.issues.push(warning("row-skipped", `OptionCashSettlement: contract not recognised in "${description}" (kept with the parenthesised text as symbol, empty when there is none)`));
    }
    return cashRow(ctx, "OptionCashSettlement", "trade", row, {
      symbol: contract.symbol,
      secType: "OPT",
      right: contract.right,
      strike: contract.strike,
      expiry: contract.expiry,
      quantity: null,
      when: parseStatementDateTime(row.cells["Date"], `option cash settlement ${description}`),
      description,
    });
  });
}

/**
 * Cash Report: one block per currency after the base-currency summary, each opening on Starting
 * Cash and closing on Ending Cash in the Total column. The movements in between are the ledger's
 * own job. A block missing one of the two cannot be checked, so it is dropped whole.
 */
function parseCashReport(ctx: Context, statement: StatementInfo): CashReport | null {
  const sectionData = readSection(ctx, "CashReport", false);
  if (!sectionData) return null;
  const found = new Map<string, { start: number | null; end: number | null }>();
  // An unreadable amount marks its whole currency, never the file: same philosophy as
  // Open Positions, one bad row drops the section for that currency, not the import.
  const unreadable = new Set<string>();
  for (const row of sectionData.rows) {
    if (!CURRENCY_CODE_RE.test(row.currency)) continue;
    // The label column has a blank header: `readSection` keys it by "".
    const label = row.cells[""] ?? "";
    if (label !== "Starting Cash" && label !== "Ending Cash") continue;
    let value: number | null;
    try {
      value = parseNumber(row.cells["Total"], `CashReport ${row.currency} ${label}`);
    } catch (e) {
      if (!(e instanceof NormalizationError)) throw e;
      unreadable.add(row.currency);
      continue;
    }
    const entry = found.get(row.currency) ?? { start: null, end: null };
    if (label === "Starting Cash") entry.start = value;
    else entry.end = value;
    found.set(row.currency, entry);
  }
  const start: Record<string, number> = {};
  const end: Record<string, number> = {};
  for (const currency of unreadable) {
    ctx.issues.push(warning("row-skipped", `CashReport: ${currency} amount unreadable`));
  }
  for (const [currency, entry] of found) {
    if (unreadable.has(currency)) continue;
    if (entry.start === null || entry.end === null) {
      ctx.issues.push(warning("row-skipped", `CashReport: ${currency} without Starting Cash or Ending Cash`));
      continue;
    }
    start[currency] = entry.start;
    end[currency] = entry.end;
  }
  if (Object.keys(end).length === 0) return null;
  return { start: { asOf: statement.periodStart, balances: start }, end: { asOf: statement.periodEnd, balances: end } };
}

const OPEN_POSITIONS_WATCHED_COLUMNS: readonly WatchedColumn[] = [
  "Symbol",
  "Quantity",
  "Mult",
  "Cost Price",
  "Close Price",
  "Value",
  "Unrealized P/L",
];

/**
 * Open Positions, as of the close of the statement's last day. One unreadable row drops the
 * snapshot but never the file: a snapshot missing a leg could show a short leg as uncovered, or
 * lose the stock that covers it (same rule as `parseSnapshot` in `flex.ts`).
 */
function parseOpenPositions(ctx: Context, statement: StatementInfo, cashReport: CashReport | null): FileSnapshot | null {
  let positions: Position[];
  try {
    const sectionData = readSection(ctx, "OpenPositions", true, { summaryRowsOnly: true });
    if (!sectionData) {
      ctx.issues.push(warning("section-missing", "Open Positions"));
      return null;
    }
    reportMissingColumns(ctx, sectionData, OPEN_POSITIONS_WATCHED_COLUMNS);
    positions = sectionData.rows.map((row) => openPosition(ctx, row));
  } catch (e) {
    if (e instanceof NormalizationError) {
      const detail = e.message.startsWith("OpenPositions:") ? e.message : `OpenPositions: ${e.message}`;
      ctx.issues.push(warning("row-skipped", detail));
      return null;
    }
    throw e;
  }
  return { asOf: statement.periodEnd, positions, cashAvailable: cashReport?.end.balances.USD ?? null };
}

function openPosition(ctx: Context, row: SectionRow): Position {
  const text = row.cells["Symbol"] ?? "";
  const what = `open position ${text}`;
  const { symbol, expiry, strike, right } = splitOptionSymbol(text);
  const secType = secTypeOf(ctx, row.assetCategory);
  if (secType === "OPT" && right === "") throw new NormalizationError(`option contract not recognised in "${text}"`);
  const quantity = parseNumber(row.cells["Quantity"], `${what} quantity`);
  if (quantity === null) throw new NormalizationError(`Open position without quantity (${text})`);
  return {
    // Coverage groups by underlying: `splitOptionSymbol` gives it for an option, the ticker otherwise.
    symbol,
    secType,
    right,
    strike,
    expiry,
    multiplier: parseNumber(row.cells["Mult"], `${what} multiplier`),
    quantity,
    // Already per unit: quantity × Mult × Cost Price is the Cost Basis column.
    avgPrice: parseNumber(row.cells["Cost Price"], `${what} cost price`),
    marketPrice: parseNumber(row.cells["Close Price"], `${what} close price`),
    marketValue: parseNumber(row.cells["Value"], `${what} value`),
    unrealizedPnl: parseNumber(row.cells["Unrealized P/L"], `${what} unrealized P/L`),
    currency: row.currency,
    // The section carries no conid.
    conid: "",
    description: text,
  };
}
