import { describe, expect, it } from "vitest";
import { activeStrategies } from "@/lib/strategies";

describe("activeStrategies", () => {
  it("is the Wheel alone for an account that never chose", () => {
    expect(activeStrategies({})).toEqual(["wheel"]);
    expect(activeStrategies(null)).toEqual(["wheel"]);
  });

  it("keeps an empty choice empty: everything goes to Others", () => {
    expect(activeStrategies({ strategies: [] })).toEqual([]);
  });

  it("returns the canonical order, without duplicates nor values this browser does not know", () => {
    const written = ["condors", "future", "wheel", "condors"] as unknown as ("wheel" | "leaps" | "condors")[];
    expect(activeStrategies({ strategies: written })).toEqual(["wheel", "condors"]);
  });
});
