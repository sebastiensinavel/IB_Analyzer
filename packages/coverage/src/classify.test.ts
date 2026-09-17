import { describe, expect, it } from "vitest";
import type { Position } from "@ib/ledger";
import { DEFAULT_MULTIPLIER } from "./constants.ts";
import { classify, contractMultiplier, describeContract } from "./classify.ts";
import { option, stock } from "./fixtures.ts";

// `right` is typed "C" | "P" | "" on Position; the engine still tolerates the
// full word and lower case the way the Python did, so the adapters of the
// next sub-projects cannot break it. The cast keeps those cases in the suite.
const right = (value: string) => value as Position["right"];

describe("classify", () => {
  it.each([
    ["C", -1, "short_call"],
    ["C", 1, "long_call"],
    ["P", -1, "short_put"],
    ["P", 1, "long_put"],
    ["CALL", -2, "short_call"],
    ["PUT", 3, "long_put"],
    ["c", -1, "short_call"],
    ["put", -1, "short_put"],
  ])("classifies right=%s quantity=%s as %s", (r, quantity, expected) => {
    expect(classify(option({ right: right(r), quantity }))).toBe(expected);
  });

  it("treats a futures option exactly like an option", () => {
    expect(classify(option({ secType: "FOP", right: "C", quantity: -1 }))).toBe("short_call");
  });

  it.each(["", "X"])("classifies an option without a usable right (%j) as other", (r) => {
    expect(classify(option({ right: right(r), quantity: -1 }))).toBe("other");
  });

  it.each([
    [100, "long_stock"],
    [-100, "short_stock"],
    [0, "other"],
  ])("classifies a stock with quantity %s as %s", (quantity, expected) => {
    expect(classify(stock({ quantity }))).toBe(expected);
  });

  it("classifies a zero-quantity option as long, not short", () => {
    expect(classify(option({ right: "C", quantity: 0 }))).toBe("long_call");
  });
});

describe("contractMultiplier", () => {
  it.each([
    [100, 100],
    [50, 50],
    [12.5, 12.5],
    [null, DEFAULT_MULTIPLIER],
    [0, DEFAULT_MULTIPLIER],
    [-100, DEFAULT_MULTIPLIER],
  ])("maps a reported multiplier of %s to %s", (multiplier, expected) => {
    expect(contractMultiplier(option({ multiplier }))).toBe(expected);
  });
});

describe("describeContract", () => {
  it("formats expiry and strike", () => {
    expect(describeContract(option({ symbol: "AAPL", right: "C", strike: 150, expiry: "2026-01-16" }))).toBe(
      "AAPL 2026-01-16 C 150",
    );
  });

  it("keeps a decimal strike", () => {
    expect(describeContract(option({ symbol: "SPY", right: "P", strike: 452.5, expiry: "2026-03-20" }))).toBe(
      "SPY 2026-03-20 P 452.5",
    );
  });

  it("truncates a full right word", () => {
    expect(describeContract(option({ symbol: "MSFT", right: right("CALL"), strike: 400, expiry: "2026-12-18" }))).toBe(
      "MSFT 2026-12-18 C 400",
    );
  });

  it.each(["", "2026-01"])("passes an expiry through as given (%j)", (expiry) => {
    expect(describeContract(option({ symbol: "AAPL", right: "C", strike: 150, expiry }))).toBe(`AAPL ${expiry} C 150`);
  });

  it("describes a stock by its symbol and security type", () => {
    expect(describeContract(stock({ symbol: "AAPL" }))).toBe("AAPL (STK)");
  });

  it("leaves a double space when the option has no right", () => {
    expect(describeContract(option({ symbol: "AAPL", right: "", strike: 150, expiry: "2026-01-16" }))).toBe(
      "AAPL 2026-01-16  150",
    );
  });

  it("writes nothing for a missing strike", () => {
    expect(describeContract(option({ strike: null }))).toBe("AAPL 2026-01-16 C ");
  });
});
