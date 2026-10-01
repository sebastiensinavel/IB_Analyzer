import { describe, expect, it } from "vitest";
import { indexExchangeOf } from "./marketIndices";

describe("marketIndices", () => {
  it("gives the exchange of an index, case-insensitively", () => {
    expect(indexExchangeOf("xsp")).toBe("CBOE");
  });
  it("gives null for a stock", () => {
    expect(indexExchangeOf("SPY")).toBeNull();
  });
});
