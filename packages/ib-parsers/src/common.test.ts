import { describe, expect, it } from "vitest";
import {
  NormalizationError,
  flexDateToIsoDay,
  legFromDescription,
  parseFlexDateTime,
  parseNumber,
  parseStatementDateTime,
  splitOptionSymbol,
  symbolFromDescription,
  toReportTime,
} from "./common.ts";

describe("parseNumber", () => {
  it("reads IB's thousands separators and signs", () => {
    expect(parseNumber("-1,732.00", "proceeds")).toBe(-1732);
  });

  it("returns null, never zero, for a blank or non-breaking-space cell", () => {
    expect(parseNumber(" ", "price")).toBeNull();
    expect(parseNumber("", "price")).toBeNull();
    expect(parseNumber(null, "price")).toBeNull();
  });

  it("refuses garbage", () => {
    expect(() => parseNumber("abc", "price")).toThrow(NormalizationError);
  });
});

describe("Flex dates", () => {
  it("reads a timestamp and a bare day", () => {
    expect(parseFlexDateTime("20260814;162000", "trade")).toBe("2026-08-14T16:20:00.000Z");
    expect(parseFlexDateTime("20251217", "cash")).toBe("2025-12-17T00:00:00.000Z");
  });

  it("converts an expiry to YYYY-MM-DD and keeps a blank one null", () => {
    expect(flexDateToIsoDay("20260220")).toBe("2026-02-20");
    expect(flexDateToIsoDay("")).toBeNull();
  });

  it("refuses an impossible date", () => {
    expect(() => parseFlexDateTime("20261340", "trade")).toThrow(NormalizationError);
  });
});

describe("Statement dates", () => {
  it("reads a timestamp and a bare day", () => {
    expect(parseStatementDateTime("2025-01-02, 09:30:00", "trade")).toBe("2025-01-02T09:30:00.000Z");
    expect(parseStatementDateTime("2025-03-15", "dividend")).toBe("2025-03-15T00:00:00.000Z");
  });
});

describe("splitOptionSymbol", () => {
  it("splits an option contract", () => {
    expect(splitOptionSymbol("ZQX 15AUG25 500 P")).toEqual({
      symbol: "ZQX",
      expiry: "2025-08-15",
      strike: 500,
      right: "P",
    });
  });

  it("passes a stock symbol through", () => {
    expect(splitOptionSymbol("TESTX")).toEqual({ symbol: "TESTX", expiry: null, strike: null, right: "" });
  });
});

describe("symbolFromDescription", () => {
  it("pulls the leading ticker", () => {
    expect(symbolFromDescription("TESTX(US0000000000) Cash Dividend USD 0.10 per Share")).toBe("TESTX");
  });

  it("is empty for a plain cash description", () => {
    expect(symbolFromDescription("Electronic Fund Transfer")).toBe("");
  });
});

describe("toReportTime", () => {
  it("brings a true UTC instant to New York's wall clock, stamped UTC like the files", () => {
    // EDT, UTC-4: an evening in New York is already the next day in UTC.
    expect(toReportTime("2026-09-16T02:13:46.000Z")).toBe("2026-09-15T22:13:46.000Z");
    // EST, UTC-5.
    expect(toReportTime("2026-01-15T15:30:00.000Z")).toBe("2026-01-15T10:30:00.000Z");
    // Just after the spring change (2026-03-08, 07:00 UTC).
    expect(toReportTime("2026-03-08T07:30:00.000Z")).toBe("2026-03-08T03:30:00.000Z");
  });

  it("keeps the milliseconds and reads an offset", () => {
    expect(toReportTime("2026-09-06T13:02:11.482Z")).toBe("2026-09-06T09:02:11.482Z");
    expect(toReportTime("2026-09-06T14:31:02+00:00")).toBe("2026-09-06T10:31:02.000Z");
  });

  it("refuses an unreadable instant", () => {
    expect(() => toReportTime("yesterday")).toThrow(NormalizationError);
  });
});

describe("legFromDescription", () => {
  it("reads the leg of a CUSIP/ISIN change", () => {
    expect(
      legFromDescription("ZXAJ(US9228000000) CUSIP/ISIN Change to (US7411000000) (ZXAH, EXAMPLE AUTOMATION INC, US7411000000)"),
    ).toEqual({ ticker: "ZXAH", isin: "US7411000000" });
  });

  it("reads a .OLD leg of a split", () => {
    expect(
      legFromDescription("ZXAA(US8194000000) Split 1 for 8 (ZXAA.OLD, EXAMPLE HOLDINGS INC, US8194000000)"),
    ).toEqual({ ticker: "ZXAA.OLD", isin: "US8194000000" });
  });

  it("is not fooled by an earlier parenthesis in the sentence", () => {
    expect(
      legFromDescription("ZXAO(US8780000000) Merged(Acquisition) WITH US0065000000 15117 FOR 10000 (ZXAI, EXAMPLE THERAPEUTICS-ADR, US0065000000)"),
    ).toEqual({ ticker: "ZXAI", isin: "US0065000000" });
  });

  it("reads the leg of a cash and stock merger", () => {
    expect(
      legFromDescription("ZXAE(CA4083000000) Cash and Stock Merger (Acquisition) CA2257000000 534 FOR 1000 AND USD 11.75236923 (ZQB, EXAMPLE ENERGY CORP, CA2257000000)"),
    ).toEqual({ ticker: "ZQB", isin: "CA2257000000" });
  });

  it("gives up on a description with no trailing triple", () => {
    expect(legFromDescription("TESTX(US0000000000) Split 2 for 1")).toBeNull();
  });

  it("gives up on a trailing parenthesis that is not a triple", () => {
    expect(legFromDescription("TESTX(US0000000000) Something (US1111111111)")).toBeNull();
  });

  it("gives up on a ticker that is not a ticker", () => {
    expect(legFromDescription("TESTX Something (not a ticker, NAME, US1111111111)")).toBeNull();
  });
});
