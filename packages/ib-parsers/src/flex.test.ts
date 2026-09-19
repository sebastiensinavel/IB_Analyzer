import { describe, expect, it } from "vitest";
import { parseFlexXml } from "./flex.ts";

const TARGET = { accountId: "test", ibAccountId: "U0000001" };

function flex(body: string, accountId = "U0000001"): string {
  return `<FlexQueryResponse queryName="global_export" type="AF">
<FlexStatements count="1">
<FlexStatement accountId="${accountId}" fromDate="20250903" toDate="20260902" period="Last365CalendarDays" whenGenerated="20260903;010001">
${body}
</FlexStatement>
</FlexStatements>
</FlexQueryResponse>`;
}

const STOCK_TRADE =
  '<Trade accountId="U0000001" currency="USD" assetCategory="STK" subCategory="COMMON" symbol="SYMA" description="SYMA HOLDINGS INC" tradeID="9000000001" dateTime="20260210;153000" putCall="" tradeDate="20260210" fifoPnlRealized="0" buySell="BUY" transactionType="BookTrade" quantity="150" transactionID="9500000001" multiplier="1" strike="" expiry="" ibCommission="0" ibCommissionCurrency="USD" netCash="-600" cost="600" tradePrice="4" proceeds="-600" />';
const OPTION_TRADE =
  '<Trade accountId="U0000001" currency="USD" assetCategory="OPT" subCategory="P" symbol="SYMB  260320P00020000" description="SYMB 20MAR26 20 P" tradeID="9000000002" dateTime="20260305;104500" putCall="P" tradeDate="20260305" buySell="SELL" transactionType="ExchTrade" quantity="-1" transactionID="9500000002" multiplier="100" strike="20" expiry="20260320" ibCommission="-0.65" ibCommissionCurrency="USD" netCash="249.35" cost="-249.35" tradePrice="2.5" proceeds="250" />';
const FOREX_TRADE =
  '<Trade accountId="U0000001" currency="USD" assetCategory="CASH" symbol="EUR.USD" description="EUR.USD" tradeID="9000000003" dateTime="20260115;110000" putCall="" buySell="SELL" quantity="-1000" transactionID="9500000003" multiplier="1" strike="" expiry="" ibCommission="-2" ibCommissionCurrency="EUR" tradePrice="1.1" proceeds="1100" />';
const DEPOSIT =
  '<CashTransaction accountId="U0000001" symbol="" description="CASH RECEIPTS / ELECTRONIC FUND TRANSFERS" dateTime="20260105" amount="2500" type="Deposits/Withdrawals" transactionID="9500000004" currency="EUR" assetCategory="" reportDate="20260106" />';
const TAX =
  '<CashTransaction accountId="U0000001" symbol="" description="WITHHOLDING @ 20% ON CREDIT INT FOR JAN-2026" dateTime="20260203" amount="-0.25" type="Withholding Tax" transactionID="9500000005" currency="USD" />';
const CORPORATE_ACTION =
  '<CorporateAction accountId="U0000001" symbol="TESTX" description="TESTX(US0000000000) SPLIT 2 FOR 1" assetCategory="STK" dateTime="20260530;200000" quantity="100" proceeds="0" transactionID="7000000001" currency="USD" />';
const STOCK_POSITION =
  '<OpenPosition accountId="U0000001" currency="USD" fxRateToBase="1" assetCategory="STK" subCategory="COMMON" symbol="SYMA" description="SYMA HOLDINGS INC" conid="123" listingExchange="NASDAQ" underlyingSymbol="SYMA" multiplier="1" strike="" expiry="" putCall="" reportDate="20260902" position="200" markPrice="3.43" positionValue="686" openPrice="4.2" costBasisPrice="4.2" costBasisMoney="840" percentOfNAV="8.66" fifoPnlUnrealized="-154" side="Long" levelOfDetail="SUMMARY" />';
const OPTION_POSITION =
  '<OpenPosition accountId="U0000001" currency="USD" fxRateToBase="1" assetCategory="OPT" subCategory="C" symbol="SYMB  280121C00002500" description="SYMB 21JAN28 2.5 C" conid="456" listingExchange="CBOE" underlyingConid="789" underlyingSymbol="SYMB" multiplier="100" strike="2.5" expiry="20280121" putCall="C" reportDate="20260902" position="-2" markPrice="0.4982" positionValue="-99.64" openPrice="1.1" costBasisPrice="1.1" costBasisMoney="-220" percentOfNAV="-2.31" fifoPnlUnrealized="120.36" side="Short" levelOfDetail="SUMMARY" />';
const LOT_POSITION = STOCK_POSITION.replace('levelOfDetail="SUMMARY"', 'levelOfDetail="LOT"').replace('position="200"', 'position="50"');
const CASH_REPORT =
  '<CashReport><CashReportCurrency accountId="U0000001" currency="BASE_SUMMARY" levelOfDetail="BaseCurrency" fromDate="20250903" toDate="20260902" startingCash="1000" endingCash="9999.99" endingSettledCash="9999.99" /><CashReportCurrency accountId="U0000001" currency="USD" levelOfDetail="Currency" fromDate="20250903" toDate="20260902" startingCash="1000" endingCash="12345.67" endingSettledCash="12000" /></CashReport>';
const CASH_REPORT_EUR_ONLY = CASH_REPORT.replace('currency="USD"', 'currency="EUR"');
/** Every section the history and the positions need, with no row in the history ones. */
const COMPLETE = `<Trades/><CashTransactions/><OpenPositions>${STOCK_POSITION}${OPTION_POSITION}</OpenPositions>${CASH_REPORT}`;
const TRADE_WITH_CONID = STOCK_TRADE.replace('symbol="SYMA"', 'symbol="SYMA" conid="123" isin="US0000000001"');
const CA_WITH_CONID =
  '<CorporateAction accountId="U0000001" symbol="SYMC" description="SYMA(US0000000001) CUSIP/ISIN Change to (US0000000002) (SYMC, SYM C INC, US0000000002)" assetCategory="STK" dateTime="20260530;200000" quantity="100" proceeds="0" fifoPnlRealized="12.5" transactionID="7000000002" currency="USD" conid="124" isin="US0000000002" />';

describe("parseFlexXml", () => {
  it("reads the statement header", () => {
    const result = parseFlexXml(flex(`<Trades>${STOCK_TRADE}</Trades><CashTransactions/>`), TARGET);
    expect(result.statement).toEqual({
      ibAccountId: "U0000001",
      fromDate: "2025-09-03",
      toDate: "2026-09-02",
      whenGenerated: "2026-09-03T01:00:01.000Z",
    });
  });

  it("normalizes a stock trade", () => {
    const [trade] = parseFlexXml(flex(`<Trades>${STOCK_TRADE}</Trades><CashTransactions/>`), TARGET).transactions;
    expect(trade).toEqual({
      accountId: "test",
      externalId: "flex:trade:9000000001",
      source: "flex",
      kind: "trade",
      symbol: "SYMA",
      secType: "STK",
      right: "",
      strike: null,
      expiry: null,
      quantity: 150,
      price: 4,
      amount: -600,
      commission: 0,
      currency: "USD",
      when: "2026-02-10T15:30:00.000Z",
      description: "SYMA HOLDINGS INC",
    });
  });

  it("normalizes an option trade with its contract", () => {
    const [trade] = parseFlexXml(flex(`<Trades>${OPTION_TRADE}</Trades><CashTransactions/>`), TARGET).transactions;
    expect(trade).toMatchObject({
      symbol: "SYMB  260320P00020000",
      secType: "OPT",
      right: "P",
      strike: 20,
      expiry: "2026-03-20",
      quantity: -1,
      price: 2.5,
      amount: 250,
      commission: -0.65,
    });
  });

  it("keeps a currency conversion as a trade on the pair, quote currency on the row", () => {
    const [trade] = parseFlexXml(flex(`<Trades>${FOREX_TRADE}</Trades><CashTransactions/>`), TARGET).transactions;
    expect(trade).toMatchObject({ symbol: "EUR.USD", secType: "CASH", quantity: -1000, amount: 1100, commission: -2, currency: "USD" });
  });

  it("maps cash transactions by their type label, with a bare day stamped at midnight", () => {
    const { transactions } = parseFlexXml(flex(`<Trades/><CashTransactions>${DEPOSIT}${TAX}</CashTransactions>`), TARGET);
    expect(transactions).toEqual([
      expect.objectContaining({
        externalId: "flex:cash:9500000004",
        kind: "transfer",
        amount: 2500,
        currency: "EUR",
        when: "2026-01-05T00:00:00.000Z",
        description: "CASH RECEIPTS / ELECTRONIC FUND TRANSFERS",
        quantity: null,
        price: null,
        commission: null,
      }),
      expect.objectContaining({ externalId: "flex:cash:9500000005", kind: "tax", amount: -0.25 }),
    ]);
  });

  it("classes an unknown cash type as a fee and says so, instead of silently", () => {
    const odd = TAX.replace('type="Withholding Tax"', 'type="Something New"');
    const result = parseFlexXml(flex(`<Trades/><CashTransactions>${odd}</CashTransactions>`), TARGET);
    expect(result.transactions[0].kind).toBe("fee");
    expect(result.issues).toContainEqual({
      severity: "warning",
      code: "unknown-cash-type",
      detail: 'Cash transaction type "Something New" classed as fee',
    });
  });

  it("normalizes a corporate action", () => {
    const [action] = parseFlexXml(
      flex(`<Trades/><CashTransactions/><CorporateActions>${CORPORATE_ACTION}</CorporateActions>`),
      TARGET,
    ).transactions;
    expect(action).toMatchObject({
      externalId: "flex:ca:7000000001",
      kind: "corporate_action",
      symbol: "TESTX",
      quantity: 100,
      amount: 0,
      when: "2026-05-30T20:00:00.000Z",
    });
  });

  it("refuses a file of another account and returns no rows", () => {
    const result = parseFlexXml(flex(`<Trades>${STOCK_TRADE}</Trades>`, "U9999999"), TARGET);
    expect(result.transactions).toEqual([]);
    expect(result.issues).toEqual([
      { severity: "error", code: "account-mismatch", detail: "File belongs to account U9999999, expected U0000001" },
    ]);
    expect(result.statement?.ibAccountId).toBe("U9999999");
  });

  it("reports missing sections as warnings and still returns the rows it has", () => {
    const result = parseFlexXml(flex(`<Trades>${STOCK_TRADE}</Trades>`), TARGET);
    expect(result.transactions).toHaveLength(1);
    expect(result.issues).toEqual([
      { severity: "warning", code: "section-missing", detail: "Cash Transactions" },
      { severity: "warning", code: "section-missing", detail: "Open Positions" },
      { severity: "warning", code: "section-missing", detail: "Cash Report" },
    ]);
  });

  it("warns when the response declares no window: what Flex owns then rests on its rows alone", () => {
    // `planFlex` bounds the range Flex claims by the window the response declares.
    // A blank `fromDate` silently disables that guard, so it must be visible.
    const xml = flex(`<Trades>${STOCK_TRADE}</Trades><CashTransactions/><OpenPositions/>${CASH_REPORT}`).replace(
      ' fromDate="20250903"',
      "",
    );
    const result = parseFlexXml(xml, TARGET);
    expect(result.statement?.fromDate).toBe("");
    expect(result.issues).toEqual([{ severity: "warning", code: "column-missing", detail: "FlexStatement: fromDate" }]);
  });

  it("reports a money column missing from the query definition: absent on every row", () => {
    const bare = STOCK_TRADE.replace(' tradePrice="4"', "").replace(' proceeds="-600"', "");
    const result = parseFlexXml(flex(`<Trades>${bare}${bare.replace("9000000001", "2")}</Trades><CashTransactions/><OpenPositions/>${CASH_REPORT}`), TARGET);
    expect(result.transactions[0].price).toBeNull();
    expect(result.issues).toEqual([
      { severity: "warning", code: "column-missing", detail: "Trades: tradePrice" },
      { severity: "warning", code: "column-missing", detail: "Trades: proceeds" },
    ]);
  });

  it("does not flag option columns on a stock-only batch", () => {
    const noOptionCols = STOCK_TRADE.replace(' strike=""', "").replace(' expiry=""', "").replace(' putCall=""', "");
    const result = parseFlexXml(flex(`<Trades>${noOptionCols}</Trades><CashTransactions/><OpenPositions/>${CASH_REPORT}`), TARGET);
    expect(result.issues).toEqual([]);
  });

  it("flags option columns missing on every option row", () => {
    const noStrike = OPTION_TRADE.replace(' strike="20"', "");
    const result = parseFlexXml(flex(`<Trades>${noStrike}</Trades><CashTransactions/><OpenPositions/>${CASH_REPORT}`), TARGET);
    expect(result.issues).toEqual([{ severity: "warning", code: "column-missing", detail: "Trades: strike" }]);
  });

  it("warns that a Transfers section is present but not read", () => {
    const result = parseFlexXml(flex(`<Trades/><CashTransactions/><OpenPositions/>${CASH_REPORT}<Transfers><Transfer transactionID="1"/></Transfers>`), TARGET);
    expect(result.issues).toEqual([{ severity: "warning", code: "section-unread", detail: "Transfers" }]);
  });

  it("cancels everything on an unreadable value", () => {
    const broken = STOCK_TRADE.replace('tradePrice="4"', 'tradePrice="six"');
    const result = parseFlexXml(flex(`<Trades>${broken}</Trades><CashTransactions/>`), TARGET);
    expect(result.transactions).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ severity: "error", code: "normalization" }));
  });

  it("cancels everything on a trade without any id", () => {
    const noId = STOCK_TRADE.replace(' tradeID="9000000001"', "").replace(' transactionID="9500000001"', "");
    const result = parseFlexXml(flex(`<Trades>${noId}</Trades><CashTransactions/>`), TARGET);
    expect(result.transactions).toEqual([]);
    expect(result.issues[0]).toMatchObject({ severity: "error", code: "normalization" });
  });

  it("rejects something that is not a Flex response", () => {
    const result = parseFlexXml("<html><body>nope</body></html>", TARGET);
    expect(result.statement).toBeNull();
    expect(result.issues).toEqual([
      { severity: "error", code: "normalization", detail: "Not a Flex query response" },
    ]);
  });
});

describe("parseFlexXml: open positions and cash report", () => {
  it("reads the open positions into a snapshot dated by reportDate", () => {
    const { snapshot, issues } = parseFlexXml(flex(COMPLETE), TARGET);
    expect(issues).toEqual([]);
    expect(snapshot?.asOf).toBe("2026-09-02");
    expect(snapshot?.positions[0]).toEqual({
      symbol: "SYMA",
      secType: "STK",
      right: "",
      strike: null,
      expiry: null,
      multiplier: 1,
      quantity: 200,
      avgPrice: 4.2,
      marketPrice: 3.43,
      marketValue: 686,
      unrealizedPnl: -154,
      dailyPnl: null,
      dayChange: null,
      currency: "USD",
      conid: "123",
      description: "SYMA HOLDINGS INC",
    });
  });

  it("keys an option on its underlying, with its contract and a per-unit cost basis", () => {
    const { snapshot } = parseFlexXml(flex(COMPLETE), TARGET);
    expect(snapshot?.positions[1]).toEqual({
      symbol: "SYMB",
      secType: "OPT",
      right: "C",
      strike: 2.5,
      expiry: "2028-01-21",
      multiplier: 100,
      quantity: -2,
      avgPrice: 1.1,
      marketPrice: 0.4982,
      marketValue: -99.64,
      unrealizedPnl: 120.36,
      dailyPnl: null,
      dayChange: null,
      currency: "USD",
      conid: "456",
      description: "SYMB 21JAN28 2.5 C",
    });
  });

  it("gives a Flex position no day values: a file has no today", () => {
    const { snapshot } = parseFlexXml(flex(COMPLETE), TARGET);
    expect(snapshot?.positions[0].dailyPnl).toBeNull();
    expect(snapshot?.positions[0].dayChange).toBeNull();
  });

  it("ignores LOT rows: a lot would double the summary's quantity", () => {
    const body = `<Trades/><CashTransactions/><OpenPositions>${STOCK_POSITION}${LOT_POSITION}</OpenPositions>${CASH_REPORT}`;
    const { snapshot } = parseFlexXml(flex(body), TARGET);
    expect(snapshot?.positions.map((p) => p.quantity)).toEqual([200]);
  });

  it("dates an empty Open Positions section by the statement's toDate", () => {
    const { snapshot } = parseFlexXml(flex(`<Trades/><CashTransactions/><OpenPositions/>${CASH_REPORT}`), TARGET);
    expect(snapshot).toEqual({ asOf: "2026-09-02", positions: [], cashAvailable: 12345.67 });
  });

  it("has no snapshot without an Open Positions section, and says so", () => {
    const result = parseFlexXml(flex(`<Trades/><CashTransactions/>${CASH_REPORT}`), TARGET);
    expect(result.snapshot).toBeNull();
    expect(result.issues).toEqual([{ severity: "warning", code: "section-missing", detail: "Open Positions" }]);
  });

  it("reads the USD ending cash of the Cash Report, never the base summary", () => {
    expect(parseFlexXml(flex(COMPLETE), TARGET).snapshot?.cashAvailable).toBe(12345.67);
  });

  it("leaves the cash unknown when the Cash Report has no USD line", () => {
    const body = `<Trades/><CashTransactions/><OpenPositions>${STOCK_POSITION}</OpenPositions>${CASH_REPORT_EUR_ONLY}`;
    const result = parseFlexXml(flex(body), TARGET);
    expect(result.snapshot?.cashAvailable).toBeNull();
    expect(result.issues).toEqual([{ severity: "warning", code: "currency-missing", detail: "Cash Report: USD" }]);
  });

  it("leaves the cash unknown when the Cash Report section is absent", () => {
    const body = `<Trades/><CashTransactions/><OpenPositions>${STOCK_POSITION}</OpenPositions>`;
    const result = parseFlexXml(flex(body), TARGET);
    expect(result.snapshot?.cashAvailable).toBeNull();
    expect(result.issues).toEqual([{ severity: "warning", code: "section-missing", detail: "Cash Report" }]);
  });

  it("reports an Open Positions column missing from the query definition", () => {
    const bare = STOCK_POSITION.replace(' markPrice="3.43"', "");
    const body = `<Trades/><CashTransactions/><OpenPositions>${bare}</OpenPositions>${CASH_REPORT}`;
    const result = parseFlexXml(flex(body), TARGET);
    expect(result.snapshot?.positions[0].marketPrice).toBeNull();
    expect(result.issues).toEqual([{ severity: "warning", code: "column-missing", detail: "Open Positions: markPrice" }]);
  });

  it("checks the option columns on option rows only", () => {
    const noStrike = OPTION_POSITION.replace(' strike="2.5"', "");
    const stockNoStrike = STOCK_POSITION.replace(' strike=""', "");
    const body = `<Trades/><CashTransactions/><OpenPositions>${stockNoStrike}${noStrike}</OpenPositions>${CASH_REPORT}`;
    expect(parseFlexXml(flex(body), TARGET).issues).toEqual([
      { severity: "warning", code: "column-missing", detail: "Open Positions: strike" },
    ]);
  });

  it("skips the snapshot on an open position without quantity, but keeps the file's transactions", () => {
    const noQuantity = STOCK_POSITION.replace(' position="200"', "");
    const body = `<Trades>${STOCK_TRADE}</Trades><CashTransactions/><OpenPositions>${noQuantity}</OpenPositions>${CASH_REPORT}`;
    const result = parseFlexXml(flex(body), TARGET);
    expect(result.snapshot).toBeNull();
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({ externalId: "flex:trade:9000000001" });
    expect(result.issues).toContainEqual({
      severity: "warning",
      code: "row-skipped",
      detail: "Open Positions: Open position without quantity (SYMA)",
    });
  });

  it("reports the position column as missing, now reachable before the row-skipping throw", () => {
    const noQuantity = STOCK_POSITION.replace(' position="200"', "");
    const body = `<Trades/><CashTransactions/><OpenPositions>${noQuantity}</OpenPositions>${CASH_REPORT}`;
    const result = parseFlexXml(flex(body), TARGET);
    expect(result.issues).toContainEqual({
      severity: "warning",
      code: "column-missing",
      detail: "Open Positions: position",
    });
  });
});

describe("parseFlexXml contract identities", () => {
  it("derives an identity from an open position, which always carries a conid", () => {
    const { identities } = parseFlexXml(flex(COMPLETE), TARGET);
    expect(identities.find((i) => i.conid === "123")).toEqual({
      conid: "123",
      isin: "",
      secType: "STK",
      currency: "USD",
      description: "SYMA HOLDINGS INC",
      tickers: ["SYMA"],
    });
  });

  it("derives an identity from a trade when the query carries the column", () => {
    const { identities } = parseFlexXml(flex(`<Trades>${TRADE_WITH_CONID}</Trades><CashTransactions/>`), TARGET);
    expect(identities).toEqual([
      { conid: "123", isin: "US0000000001", secType: "STK", currency: "USD", description: "SYMA HOLDINGS INC", tickers: ["SYMA"] },
    ]);
  });

  it("yields nothing from a trade without the column, and does not complain", () => {
    const result = parseFlexXml(flex(`<Trades>${STOCK_TRADE}</Trades><CashTransactions/>`), TARGET);
    expect(result.identities).toEqual([]);
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("folds the two spellings of one respelled option conid into a single identity", () => {
    // What the whole option-rename rule rests on: IB respells an option when
    // its underlying is renamed, without ever changing the contract's conid.
    const before = OPTION_TRADE.replace('symbol="SYMB  260320P00020000"', 'symbol="SYMB  260320P00020000" conid="900000109"');
    const after = before
      .replace("SYMB  260320P00020000", "SYMC  260320P00020000")
      .replace('tradeID="9000000002"', 'tradeID="9000000009"')
      .replace('transactionID="9500000002"', 'transactionID="9500000009"');
    const { identities } = parseFlexXml(flex(`<Trades>${before}${after}</Trades><CashTransactions/>`), TARGET);
    expect(identities).toEqual([
      { conid: "900000109", isin: "", secType: "OPT", currency: "USD", description: "SYMB 20MAR26 20 P", tickers: ["SYMB  260320P00020000", "SYMC  260320P00020000"] },
    ]);
  });

  it("orders the spellings of one conid by date, not by the order Flex lists them", () => {
    // Flex sorts its trades by asset category then by *symbol*, so document
    // order is alphabetical, not chronological. `canonicalOf` breaks a tie on
    // the import window by the alias's rank — the last alias being the
    // current name — so a rename to an alphabetically earlier ticker would
    // otherwise elect the dead spelling.
    const older = OPTION_TRADE.replace('symbol="SYMB  260320P00020000"', 'symbol="SYMB  260320P00020000" conid="900000109"');
    const newer = older
      .replace("SYMB  260320P00020000", "AAAA  260320P00020000")
      .replace('dateTime="20260305;104500"', 'dateTime="20260610;104500"')
      .replace('tradeID="9000000002"', 'tradeID="9000000009"')
      .replace('transactionID="9500000002"', 'transactionID="9500000009"');
    // The newer spelling first, exactly as an alphabetical file would list it.
    const { identities } = parseFlexXml(flex(`<Trades>${newer}${older}</Trades><CashTransactions/>`), TARGET);
    expect(identities[0].tickers).toEqual(["SYMB  260320P00020000", "AAAA  260320P00020000"]);
  });

  it("folds one conid seen on a trade and on a position into a single identity", () => {
    const { identities } = parseFlexXml(flex(`<Trades>${TRADE_WITH_CONID}</Trades><CashTransactions/><OpenPositions>${STOCK_POSITION}</OpenPositions>${CASH_REPORT}`), TARGET);
    expect(identities.filter((i) => i.conid === "123")).toHaveLength(1);
    expect(identities.find((i) => i.conid === "123")?.isin).toBe("US0000000001");
  });
});

describe("parseFlexXml corporate actions", () => {
  it("reads fifoPnlRealized into realizedPnl", () => {
    const [ca] = parseFlexXml(flex(`<Trades/><CashTransactions/><CorporateActions>${CA_WITH_CONID}</CorporateActions>`), TARGET).transactions;
    expect(ca).toMatchObject({ kind: "corporate_action", symbol: "SYMC", quantity: 100, amount: 0, realizedPnl: 12.5 });
  });

  it("leaves realizedPnl null when the attribute is absent", () => {
    const [ca] = parseFlexXml(flex(`<Trades/><CashTransactions/><CorporateActions>${CORPORATE_ACTION}</CorporateActions>`), TARGET).transactions;
    expect(ca.realizedPnl).toBeNull();
  });
});

describe("parseFlexXml: cash report points", () => {
  const CASH_REPORT_BOTH = CASH_REPORT.replace(
    "</CashReport>",
    '<CashReportCurrency accountId="U0000001" currency="EUR" levelOfDetail="Currency" fromDate="20250903" toDate="20260902" startingCash="10" endingCash="12.5" endingSettledCash="12.5" /></CashReport>',
  );

  it("reads Starting Cash and Ending Cash per currency, dated by the window, never the base summary", () => {
    const result = parseFlexXml(flex(`<Trades/><CashTransactions/><OpenPositions/>${CASH_REPORT_BOTH}`), TARGET);
    expect(result.issues).toEqual([]);
    expect(result.cashReport).toEqual({
      start: { asOf: "2025-09-03", balances: { USD: 1000, EUR: 10 } },
      end: { asOf: "2026-09-02", balances: { USD: 12345.67, EUR: 12.5 } },
    });
  });

  it("has no cash report without the section", () => {
    expect(parseFlexXml(flex("<Trades/><CashTransactions/><OpenPositions/>"), TARGET).cashReport).toBeNull();
  });

  it("drops a currency line missing one of its two amounts, and says so", () => {
    const halfUsd = CASH_REPORT.replace(' startingCash="1000" endingCash="12345.67"', ' endingCash="12345.67"');
    const result = parseFlexXml(flex(`<Trades/><CashTransactions/><OpenPositions/>${halfUsd}`), TARGET);
    expect(result.cashReport).toBeNull();
    expect(result.issues).toContainEqual({
      severity: "warning",
      code: "row-skipped",
      detail: "Cash Report: USD without startingCash or endingCash",
    });
  });

  it("drops a currency whose amount cannot be read, keeps cashAvailable from the endingCash-only summary", () => {
    const unreadable = CASH_REPORT.replace(' startingCash="1000" endingCash="12345.67"', ' startingCash="abc" endingCash="12345.67"');
    expect(unreadable).not.toBe(CASH_REPORT);
    const result = parseFlexXml(flex(`<Trades/><CashTransactions/><OpenPositions/>${unreadable}`), TARGET);
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.cashReport).toBeNull();
    expect(result.snapshot?.cashAvailable).toBe(12345.67);
    expect(result.issues).toContainEqual({
      severity: "warning",
      code: "row-skipped",
      detail: "Cash Report: USD amount unreadable",
    });
  });

  it("has no cash report when the response declares no window to date it by", () => {
    const xml = flex(`<Trades/><CashTransactions/><OpenPositions/>${CASH_REPORT}`).replace(' toDate="20260902"', "");
    expect(parseFlexXml(xml, TARGET).cashReport).toBeNull();
  });

  it("returns no cash report on a file of another account", () => {
    expect(parseFlexXml(flex(CASH_REPORT, "U7777777"), TARGET).cashReport).toBeNull();
  });
});
