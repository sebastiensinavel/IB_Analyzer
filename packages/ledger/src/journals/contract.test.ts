import { describe, expect, it } from "vitest";
import { tx } from "../fixtures.ts";
import {
  contractId,
  contractOf,
  expiryOfPacked,
  formatCondorLabel,
  formatContractLabel,
  isAtLeastMonthsAway,
  isPackedOptionSymbol,
  optionTerms,
  packedOptionSymbol,
  respellPackedOption,
  tickerOf,
} from "./contract.ts";

describe("tickerOf", () => {
  it("takes the first token: Flex packs the OCC symbol, statements give the underlying", () => {
    expect(tickerOf("SYMB  260320P00020000")).toBe("SYMB");
    expect(tickerOf("MQZA")).toBe("MQZA");
    expect(tickerOf("  AAPL ")).toBe("AAPL");
    expect(tickerOf("")).toBe("");
  });

  it("recognises the fixed-width OSI layout when a 6-character root leaves no padding space", () => {
    expect(tickerOf("ABCDEF260320P00020000")).toBe("ABCDEF");
  });

  it("still splits on the padding space for a shorter, padded root", () => {
    expect(tickerOf("SYMB  260320P00020000")).toBe("SYMB");
  });

  it("leaves a plain 21-character symbol that is not OSI-shaped unchanged", () => {
    expect(tickerOf("ABCDEFGHIJKLMNOPQRSTU")).toBe("ABCDEFGHIJKLMNOPQRSTU");
  });
});

describe("contractOf / contractId", () => {
  it("identifies an option by ticker, right, strike, expiry and currency, whatever the source spelled", () => {
    const flex = contractOf(tx({ symbol: "MQZA  261002C00017000", secType: "OPT", right: "C", strike: 17, expiry: "2026-10-02" }));
    const html = contractOf(tx({ symbol: "MQZA", secType: "OPT", right: "C", strike: 17, expiry: "2026-10-02" }));
    expect(contractId(flex)).toBe("MQZA|OPT|C|17|2026-10-02|USD");
    expect(contractId(html)).toBe(contractId(flex));
  });

  it("identifies shares with empty option fields", () => {
    expect(contractId(contractOf(tx({ symbol: "MQZA", secType: "STK" })))).toBe("MQZA|STK||||USD");
  });

  it("identifies the same contract whether Flex packs a 6-character root or the bare underlying is given", () => {
    const packed = contractOf(tx({ symbol: "ABCDEF260320P00020000", secType: "OPT", right: "P", strike: 20, expiry: "2026-03-20" }));
    const bare = contractOf(tx({ symbol: "ABCDEF", secType: "OPT", right: "P", strike: 20, expiry: "2026-03-20" }));
    expect(contractId(packed)).toBe(contractId(bare));
  });
});

describe("formatContractLabel", () => {
  it("spells an option like the positions do, strike without trailing zeros", () => {
    expect(formatContractLabel({ ticker: "MQZA", secType: "OPT", right: "C", strike: 17, expiry: "2026-10-02", currency: "USD" })).toBe("MQZA Oct02'26 17 Call");
    expect(formatContractLabel({ ticker: "XSP", secType: "OPT", right: "P", strike: 17.5, expiry: "2026-01-16", currency: "USD" })).toBe("XSP Jan16'26 17.5 Put");
  });

  it("spells shares by their ticker alone", () => {
    expect(formatContractLabel({ ticker: "MQZA", secType: "STK", right: "", strike: null, expiry: null, currency: "USD" })).toBe("MQZA");
  });

  it("spells a condor with its four strikes ascending", () => {
    expect(formatCondorLabel("SPY", "2026-08-29", [620, 625, 660, 665])).toBe("SPY Aug29'26 IC 620/625/660/665");
  });
});

describe("isAtLeastMonthsAway", () => {
  it("is true on the very day three months later, false the day before", () => {
    expect(isAtLeastMonthsAway("2026-03-15", "2026-06-15", 3)).toBe(true);
    expect(isAtLeastMonthsAway("2026-03-15", "2026-06-14", 3)).toBe(false);
  });

  it("clamps to the end of a shorter month: Nov 30 + 3 months is Feb 28", () => {
    expect(isAtLeastMonthsAway("2025-11-30", "2026-02-28", 3)).toBe(true);
    expect(isAtLeastMonthsAway("2025-11-30", "2026-02-27", 3)).toBe(false);
  });

  it("crosses the year", () => {
    expect(isAtLeastMonthsAway("2026-11-20", "2027-02-20", 3)).toBe(true);
  });
});

describe("packedOptionSymbol", () => {
  it("rebuilds the spelling Flex writes, from what a statement gives", () => {
    expect(packedOptionSymbol("TSTA", "2026-01-16", "C", 12.5)).toBe("TSTA  260116C00012500");
    expect(packedOptionSymbol("TSTC", "2027-01-15", "C", 2.5)).toBe("TSTC  270115C00002500");
  });

  it("leaves no padding space for a six-character root", () => {
    expect(packedOptionSymbol("ABCDEF", "2026-04-17", "P", 1)).toBe("ABCDEF260417P00001000");
  });

  it("is always a packed spelling, by the engine's own test", () => {
    expect(isPackedOptionSymbol(packedOptionSymbol("TSTA", "2026-01-16", "C", 12.5)!)).toBe(true);
  });

  it("refuses to invent a name it cannot spell", () => {
    // A root longer than six characters, or carrying anything but letters and
    // digits, has no OSI form at all; so has an option missing a term.
    expect(packedOptionSymbol("TOOLONGX", "2026-01-16", "C", 12.5)).toBeNull();
    expect(packedOptionSymbol("BRK.B", "2026-01-16", "C", 12.5)).toBeNull();
    expect(packedOptionSymbol("", "2026-01-16", "C", 12.5)).toBeNull();
    expect(packedOptionSymbol("TSTA", null, "C", 12.5)).toBeNull();
    expect(packedOptionSymbol("TSTA", "16/01/2026", "C", 12.5)).toBeNull();
    expect(packedOptionSymbol("TSTA", "2026-01-16", "", 12.5)).toBeNull();
    expect(packedOptionSymbol("TSTA", "2026-01-16", "C", null)).toBeNull();
    expect(packedOptionSymbol("TSTA", "2026-01-16", "C", 0)).toBeNull();
    // A strike finer than a thousandth would not survive the eight digits.
    expect(packedOptionSymbol("TSTA", "2026-01-16", "C", 1.23456)).toBeNull();
  });
});

describe("optionTerms, expiryOfPacked and respellPackedOption", () => {
  it("reads the terms and the expiry of a packed spelling", () => {
    expect(optionTerms("TSTA  260116C00012500")).toBe("260116C00012500");
    expect(expiryOfPacked("TSTA  260116C00012500")).toBe("2026-01-16");
  });

  it("has no expiry to give for a spelling that is not packed", () => {
    expect(expiryOfPacked("TSTA")).toBeNull();
  });

  it("puts the same terms under another root, and refuses a root it cannot spell", () => {
    expect(respellPackedOption("TSTC  270115C00002500", "TSTB")).toBe("TSTB  270115C00002500");
    expect(respellPackedOption("TSTC  270115C00002500", "TOOLONGX")).toBeNull();
    expect(respellPackedOption("TSTC", "TSTB")).toBeNull();
  });
});
