import { describe, expect, it } from "vitest";
import { STRATEGY_BOXES } from "@/lib/strategyBoxes";

describe("STRATEGY_BOXES", () => {
  it("opens the Wheel on its put sales, then the shares, the calls below the assignment price before those above", () => {
    expect(STRATEGY_BOXES.wheel.map((box) => box.id)).toEqual(["putSells", "sharesUncovered", "sharesCallBelow", "sharesCallAbove", "callSells"]);
  });
});
