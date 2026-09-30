import { describe, expect, it } from "vitest";
import { directionFor, manualAlerts, roundToCent } from "./manual.ts";

describe("alertes manuelles", () => {
  it("convertit une définition : ticker en majuscules, USD, un seuil", () => {
    expect(manualAlerts([{ id: "manual:1", ticker: "aapl", price: 250, direction: "above", note: "n", createdAt: "2026-09-30T14:00:00Z" }])).toEqual([
      { id: "manual:1", kind: "manual", ticker: "AAPL", currency: "USD", thresholds: [{ price: 250, direction: "above" }], note: "n", createdAt: "2026-09-30T14:00:00Z" },
    ]);
  });
  it("arrondit au cent", () => {
    expect(roundToCent(245.304)).toBe(245.3);
    expect(roundToCent(245.305)).toBe(245.31);
  });
  it("lit la direction depuis le cours du moment", () => {
    expect(directionFor(250, 245)).toBe("above");
    expect(directionFor(245, 245)).toBe("above");
    expect(directionFor(240, 245)).toBe("below");
  });
});
