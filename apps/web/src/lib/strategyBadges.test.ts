import { describe, expect, it } from "vitest";
import { STRATEGIES } from "@ib/ledger";
import { STRATEGY_BADGE } from "@/lib/strategyBadges";

describe("STRATEGY_BADGE", () => {
  it("gives each strategy its role's hue, Others a neutral outline", () => {
    expect(Object.keys(STRATEGY_BADGE).sort()).toEqual([...STRATEGIES].sort());
    expect(STRATEGY_BADGE.wheel.variant).toBe("success");
    expect(STRATEGY_BADGE.condors.variant).toBe("warning");
    expect(STRATEGY_BADGE.others.variant).toBe("outline");
    expect(STRATEGY_BADGE.leaps.className).toContain("#7b5ce5");
    expect(STRATEGY_BADGE.leaps.className).toContain("#a28bf5");
  });
});
