import type { Position, Transaction, TransactionKind } from "@ib/ledger";
import {
  NormalizationError,
  attr,
  flexDateToIsoDay,
  parseFlexDateTime,
  parseNumber,
} from "./common.ts";
import { mergeIdentities, type ContractIdentity } from "./identity.ts";
import { error, warning, type ParseIssue, type ParseResult, type ParseTarget } from "./issues.ts";
import { CURRENCY_CODE_RE, type CashReport, type FileSnapshot } from "./snapshot.ts";

export interface FlexStatementInfo {
  ibAccountId: string;
  /** YYYY-MM-DD */
  fromDate: string;
  toDate: string;
  /** ISO 8601 */
  whenGenerated: string;
}

export interface FlexParseResult extends ParseResult<FlexStatementInfo> {
  /** Open Positions and USD cash; dated by the rows' reportDate, the statement's toDate when there is none. */
  snapshot: FileSnapshot | null;
  /** Starting and Ending Cash per currency over the declared window; `null` without the section. */
  cashReport: CashReport | null;
  /** Contract identities the file happened to carry; empty when no section has the column. */
  identities: ContractIdentity[];
}

/** Flex reports the cash transaction type as a label, not a code. */
const CASH_TYPE_KIND: Record<string, TransactionKind> = {
  Dividends: "dividend",
  "Payment In Lieu Of Dividends": "dividend",
  "Withholding Tax": "tax",
  "Broker Interest Paid": "interest",
  "Broker Interest Received": "interest",
  "Bond Interest Paid": "interest",
  "Bond Interest Received": "interest",
  "Other Fees": "fee",
  "Advisor Fees": "fee",
  "Commission Adjustments": "fee",
  "Deposits/Withdrawals": "transfer",
};

// Left out of the query *definition*, a column is absent on every row;
// merely empty, it is absent on some rows only. The all-rows test is what
// makes the signal reliable.
const MONEY_TRADE_COLUMNS = ["tradePrice", "proceeds", "ibCommission"] as const;
const OPTION_TRADE_COLUMNS = ["strike", "expiry", "putCall"] as const;
const POSITION_COLUMNS = ["position", "markPrice", "positionValue", "costBasisPrice", "fifoPnlUnrealized", "multiplier"] as const;
const OPTION_POSITION_COLUMNS = ["strike", "expiry", "putCall", "underlyingSymbol"] as const;

function children(parent: Element, tagName: string): Element[] {
  return Array.from(parent.children).filter((el) => el.tagName === tagName);
}

function section(statement: Element, tagName: string): Element | null {
  return children(statement, tagName)[0] ?? null;
}

/**
 * The identity an element carries, when it carries one. `conid` and `isin`
 * are per-section columns of the Flex query: Open Positions and Cash
 * Transactions have them in practice, Trades usually not. Absent, the element
 * simply identifies nothing — never an issue, never a throw.
 */
function identityOf(el: Element): ContractIdentity | null {
  const conid = attr(el, "conid") ?? "";
  const ticker = attr(el, "symbol") ?? "";
  if (conid === "" || ticker === "") return null;
  return {
    conid,
    isin: attr(el, "isin") ?? "",
    secType: attr(el, "assetCategory") ?? "",
    currency: attr(el, "currency") ?? "",
    description: attr(el, "description") ?? "",
    tickers: [ticker],
  };
}

/**
 * Every identity the file happens to carry, whatever the section, oldest
 * sighting first.
 *
 * The order matters: `mergeIdentities` unions a conid's spellings in order of
 * first sighting, and `canonicalOf` (`packages/ledger`) elects the last one
 * when a single import stamps them all with the same window — which is the
 * normal case for a Flex query. Flex sorts its own rows by asset category
 * then by *symbol*, so document order is alphabetical: taking it for
 * chronological would elect the dead spelling of any contract renamed to an
 * alphabetically earlier ticker. Sorting by the row's own date makes the rank
 * mean what the election assumes it means. A row without a date keeps its
 * place, the sort being stable.
 */
function parseIdentities(statementEl: Element): ContractIdentity[] {
  const found: ContractIdentity[] = [];
  for (const sectionName of ["Trades", "CashTransactions", "CorporateActions", "OpenPositions"] as const) {
    const el = section(statementEl, sectionName);
    if (!el) continue;
    const rows = Array.from(el.children)
      .map((child, rank) => ({ child, rank, when: attr(child, "dateTime") || attr(child, "reportDate") || "" }))
      .sort((a, b) => (a.when === b.when ? a.rank - b.rank : a.when < b.when ? -1 : 1));
    for (const { child } of rows) {
      const identity = identityOf(child);
      if (identity) found.push(identity);
    }
  }
  return mergeIdentities([found]);
}

export function parseFlexXml(xml: string, target: ParseTarget): FlexParseResult {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const statementEl = doc.documentElement?.tagName === "FlexQueryResponse"
    ? doc.querySelector("FlexStatements > FlexStatement")
    : null;
  if (!statementEl) {
    return { transactions: [], statement: null, snapshot: null, cashReport: null, identities: [], issues: [error("normalization", "Not a Flex query response")] };
  }

  const issues: ParseIssue[] = [];
  let statement: FlexStatementInfo;
  try {
    statement = {
      ibAccountId: attr(statementEl, "accountId") ?? "",
      fromDate: flexDateToIsoDay(attr(statementEl, "fromDate")) ?? "",
      toDate: flexDateToIsoDay(attr(statementEl, "toDate")) ?? "",
      whenGenerated: parseFlexDateTime(attr(statementEl, "whenGenerated"), "whenGenerated"),
    };
  } catch (e) {
    if (e instanceof NormalizationError) {
      return { transactions: [], statement: null, snapshot: null, cashReport: null, identities: [], issues: [error("normalization", e.message)] };
    }
    throw e;
  }

  // `planFlex` never claims a day before the window declared here (spec §6.2). A blank
  // bound leaves it with the rows alone to reason from, which is exactly the case the rule
  // guards against: say so rather than let the guard fall silent.
  for (const [bound, value] of [["fromDate", statement.fromDate], ["toDate", statement.toDate]] as const) {
    if (value === "") issues.push(warning("column-missing", `FlexStatement: ${bound}`));
  }

  if (statement.ibAccountId !== target.ibAccountId) {
    issues.push(
      error("account-mismatch", `File belongs to account ${statement.ibAccountId}, expected ${target.ibAccountId}`),
    );
    return { transactions: [], statement, snapshot: null, cashReport: null, identities: [], issues };
  }

  try {
    const transactions = [
      ...parseTrades(statementEl, target, issues),
      ...parseCashTransactions(statementEl, target, issues),
      ...parseCorporateActions(statementEl, target),
    ];
    const snapshot = parseSnapshot(statementEl, statement, issues);
    const cashReport = parseCashPoints(statementEl, statement, issues);
    checkSections(statementEl, issues);
    return { transactions, statement, snapshot, cashReport, identities: parseIdentities(statementEl), issues };
  } catch (e) {
    if (e instanceof NormalizationError) {
      return { transactions: [], statement, snapshot: null, cashReport: null, identities: [], issues: [...issues, error("normalization", e.message)] };
    }
    throw e;
  }
}

function parseTrades(statementEl: Element, target: ParseTarget, issues: ParseIssue[]): Transaction[] {
  const trades = section(statementEl, "Trades");
  if (!trades) return [];
  const rows = children(trades, "Trade");
  const transactions = rows.map((el) => {
    const tradeId = attr(el, "tradeID") || attr(el, "transactionID");
    if (!tradeId) {
      throw new NormalizationError(`Trade without tradeID nor transactionID (${attr(el, "symbol") ?? "?"})`);
    }
    const putCall = attr(el, "putCall");
    const right = putCall === "C" || putCall === "P" ? putCall : "";
    const what = `trade ${tradeId}`;
    return {
      accountId: target.accountId,
      externalId: `flex:trade:${tradeId}`,
      source: "flex",
      kind: "trade",
      symbol: attr(el, "symbol") ?? "",
      secType: attr(el, "assetCategory") ?? "",
      right,
      strike: parseNumber(attr(el, "strike"), `${what} strike`),
      expiry: flexDateToIsoDay(attr(el, "expiry")),
      quantity: parseNumber(attr(el, "quantity"), `${what} quantity`),
      price: parseNumber(attr(el, "tradePrice"), `${what} tradePrice`),
      amount: parseNumber(attr(el, "proceeds"), `${what} proceeds`),
      commission: parseNumber(attr(el, "ibCommission"), `${what} ibCommission`),
      currency: attr(el, "currency") ?? "",
      when: parseFlexDateTime(attr(el, "dateTime") || attr(el, "tradeDate"), what),
      description: attr(el, "description") ?? "",
    } satisfies Transaction;
  });

  reportMissingColumns("Trades", rows, MONEY_TRADE_COLUMNS, issues);
  reportMissingColumns(
    "Trades",
    rows.filter((el) => attr(el, "assetCategory") === "OPT"),
    OPTION_TRADE_COLUMNS,
    issues,
  );
  return transactions;
}

function reportMissingColumns(
  sectionName: string,
  rows: Element[],
  columns: readonly string[],
  issues: ParseIssue[],
): void {
  if (rows.length === 0) return;
  for (const column of columns) {
    if (rows.every((el) => !el.hasAttribute(column))) {
      issues.push(warning("column-missing", `${sectionName}: ${column}`));
    }
  }
}

function parseCashTransactions(statementEl: Element, target: ParseTarget, issues: ParseIssue[]): Transaction[] {
  const cash = section(statementEl, "CashTransactions");
  if (!cash) return [];
  const unknownTypes = new Set<string>();
  return children(cash, "CashTransaction").map((el) => {
    const id = attr(el, "transactionID");
    if (!id) throw new NormalizationError(`Cash transaction without transactionID (${attr(el, "description") ?? "?"})`);
    const type = attr(el, "type") ?? "";
    let kind = CASH_TYPE_KIND[type];
    if (!kind) {
      kind = "fee";
      if (!unknownTypes.has(type)) {
        unknownTypes.add(type);
        issues.push(warning("unknown-cash-type", `Cash transaction type "${type}" classed as fee`));
      }
    }
    const what = `cash transaction ${id}`;
    return {
      accountId: target.accountId,
      externalId: `flex:cash:${id}`,
      source: "flex",
      kind,
      symbol: attr(el, "symbol") ?? "",
      secType: attr(el, "assetCategory") ?? "",
      right: "",
      strike: null,
      expiry: null,
      quantity: null,
      price: null,
      amount: parseNumber(attr(el, "amount"), `${what} amount`),
      commission: null,
      currency: attr(el, "currency") ?? "",
      when: parseFlexDateTime(attr(el, "dateTime") || attr(el, "reportDate") || attr(el, "settleDate"), what),
      description: attr(el, "description") ?? "",
    } satisfies Transaction;
  });
}

function parseCorporateActions(statementEl: Element, target: ParseTarget): Transaction[] {
  const actions = section(statementEl, "CorporateActions");
  if (!actions) return [];
  return children(actions, "CorporateAction").map((el) => {
    const id = attr(el, "transactionID");
    if (!id) throw new NormalizationError(`Corporate action without transactionID (${attr(el, "description") ?? "?"})`);
    const what = `corporate action ${id}`;
    return {
      accountId: target.accountId,
      externalId: `flex:ca:${id}`,
      source: "flex",
      kind: "corporate_action",
      symbol: attr(el, "symbol") ?? "",
      secType: attr(el, "assetCategory") ?? "",
      right: "",
      strike: null,
      expiry: null,
      quantity: parseNumber(attr(el, "quantity"), `${what} quantity`),
      price: null,
      amount: parseNumber(attr(el, "proceeds"), `${what} proceeds`),
      commission: null,
      currency: attr(el, "currency") ?? "",
      when: parseFlexDateTime(attr(el, "dateTime") || attr(el, "reportDate"), what),
      description: attr(el, "description") ?? "",
      realizedPnl: parseNumber(attr(el, "fifoPnlRealized"), `${what} realized P/L`),
    } satisfies Transaction;
  });
}

function parseSnapshot(statementEl: Element, statement: FlexStatementInfo, issues: ParseIssue[]): FileSnapshot | null {
  const open = section(statementEl, "OpenPositions");
  if (!open) return null;
  // A LOT row repeats part of its SUMMARY row's quantity: read summaries only.
  const rows = children(open, "OpenPosition").filter((el) => (attr(el, "levelOfDetail") ?? "SUMMARY") === "SUMMARY");
  reportMissingColumns("Open Positions", rows, POSITION_COLUMNS, issues);
  reportMissingColumns(
    "Open Positions",
    rows.filter((el) => isOptionCategory(attr(el, "assetCategory"))),
    OPTION_POSITION_COLUMNS,
    issues,
  );
  let positions: Position[];
  try {
    positions = rows.map((el) => parseOpenPosition(el));
  } catch (e) {
    if (e instanceof NormalizationError) {
      // Do not let one unreadable position row take down the file's transactions
      // (handled by the outer try/catch of parseFlexXml) - but a snapshot missing
      // a leg is worse than no snapshot at all: it could show a short leg as
      // uncovered, or lose the stock that covers it. Skip the snapshot, not the file.
      issues.push(warning("row-skipped", `Open Positions: ${e.message}`));
      return null;
    }
    throw e;
  }
  const asOf = rows.length > 0 ? flexDateToIsoDay(attr(rows[0], "reportDate")) : null;
  return { asOf: asOf ?? statement.toDate, positions, cashAvailable: parseCashReport(statementEl, issues) };
}

function isOptionCategory(category: string | null): boolean {
  return category === "OPT" || category === "FOP";
}

function parseOpenPosition(el: Element): Position {
  const category = attr(el, "assetCategory") ?? "";
  const symbol = attr(el, "symbol") ?? "";
  const what = `open position ${symbol}`;
  const quantity = parseNumber(attr(el, "position"), `${what} position`);
  if (quantity === null) throw new NormalizationError(`Open position without quantity (${symbol})`);
  const putCall = attr(el, "putCall");
  return {
    // Coverage groups by underlying: an option's own symbol is the packed OCC one.
    symbol: isOptionCategory(category) ? attr(el, "underlyingSymbol") || symbol : symbol,
    secType: category,
    right: putCall === "C" || putCall === "P" ? putCall : "",
    strike: parseNumber(attr(el, "strike"), `${what} strike`),
    expiry: flexDateToIsoDay(attr(el, "expiry")),
    multiplier: parseNumber(attr(el, "multiplier"), `${what} multiplier`),
    quantity,
    // costBasisPrice is already per unit (per share, per unit of underlying).
    avgPrice: parseNumber(attr(el, "costBasisPrice"), `${what} costBasisPrice`),
    marketPrice: parseNumber(attr(el, "markPrice"), `${what} markPrice`),
    marketValue: parseNumber(attr(el, "positionValue"), `${what} positionValue`),
    unrealizedPnl: parseNumber(attr(el, "fifoPnlUnrealized"), `${what} fifoPnlUnrealized`),
    currency: attr(el, "currency") ?? "",
    conid: attr(el, "conid") ?? "",
    description: attr(el, "description") ?? "",
  };
}

/** The USD line of the Cash Report: `endingCash` is TWS's TotalCashBalance at the close. */
function parseCashReport(statementEl: Element, issues: ParseIssue[]): number | null {
  const report = section(statementEl, "CashReport");
  if (!report) return null; // checkSections reports it
  const usd = children(report, "CashReportCurrency").find(
    (el) => attr(el, "currency") === "USD" && (attr(el, "levelOfDetail") ?? "Currency") === "Currency",
  );
  if (!usd) {
    issues.push(warning("currency-missing", "Cash Report: USD"));
    return null;
  }
  reportMissingColumns("Cash Report", [usd], ["endingCash"], issues);
  return parseNumber(attr(usd, "endingCash"), "cash report endingCash");
}

/**
 * Both points of every currency line of the Cash Report, dated by the window the response
 * declares. The base summary is not a currency. A line missing one of its two amounts cannot be
 * checked, so it is dropped whole; without a declared window there is nothing to date them by.
 */
function parseCashPoints(statementEl: Element, statement: FlexStatementInfo, issues: ParseIssue[]): CashReport | null {
  const report = section(statementEl, "CashReport");
  if (!report || statement.fromDate === "" || statement.toDate === "") return null;
  const start: Record<string, number> = {};
  const end: Record<string, number> = {};
  // An unreadable amount marks its whole currency, never the file: same philosophy as
  // Open Positions, one bad row drops the section for that currency, not the import.
  const unreadable = new Set<string>();
  for (const el of children(report, "CashReportCurrency")) {
    const currency = attr(el, "currency") ?? "";
    if ((attr(el, "levelOfDetail") ?? "Currency") !== "Currency" || !CURRENCY_CODE_RE.test(currency)) continue;
    let starting: number | null;
    let ending: number | null;
    try {
      starting = parseNumber(attr(el, "startingCash"), `cash report ${currency} startingCash`);
      ending = parseNumber(attr(el, "endingCash"), `cash report ${currency} endingCash`);
    } catch (e) {
      if (!(e instanceof NormalizationError)) throw e;
      unreadable.add(currency);
      continue;
    }
    if (starting === null || ending === null) {
      issues.push(warning("row-skipped", `Cash Report: ${currency} without startingCash or endingCash`));
      continue;
    }
    start[currency] = starting;
    end[currency] = ending;
  }
  for (const currency of unreadable) {
    issues.push(warning("row-skipped", `Cash Report: ${currency} amount unreadable`));
  }
  if (Object.keys(end).length === 0) return null;
  return { start: { asOf: statement.fromDate, balances: start }, end: { asOf: statement.toDate, balances: end } };
}

/** Sections the history needs, and the ones the next sub-projects will. */
function checkSections(statementEl: Element, issues: ParseIssue[]): void {
  const required: Array<[tag: string, label: string]> = [
    ["Trades", "Trades"],
    ["CashTransactions", "Cash Transactions"],
    ["OpenPositions", "Open Positions"],
    ["CashReport", "Cash Report"],
  ];
  for (const [tag, label] of required) {
    if (!section(statementEl, tag)) issues.push(warning("section-missing", label));
  }
  if (section(statementEl, "Transfers")) issues.push(warning("section-unread", "Transfers"));
}
