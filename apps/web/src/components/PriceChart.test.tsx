import { describe, expect, it } from "vitest";
import type { ChartLevel, ChartLevelKind } from "@ib/ledger";
import { CHART_COLORS } from "@/lib/chartColors";
import { drawnLevels } from "@/components/PriceChart";

const WORDS: Record<ChartLevelKind, string> = {
  shares: "Long",
  shortPut: "Put",
  shortCall: "Call",
  leapsBuy: "LEAPS",
  condor: "",
};
const word = (kind: ChartLevelKind) => WORDS[kind];
const bar = (date: string, high: number, low: number) => ({ date, open: low, high, low, close: high, volume: 1 });

describe("drawnLevels", () => {
  it("assemble couleur, prix et étiquette d'une vente de puts", () => {
    const levels: ChartLevel[] = [{ kind: "shortPut", price: 17.5, quantity: -6, expiries: ["2026-10-16"] }];

    expect(drawnLevels(levels, [], false, word, "fr")).toEqual([
      { level: levels[0], color: CHART_COLORS.light.series[2], price: 17.5, label: "17,5 Put: -6" },
    ]);
  });

  it("résout le prix d'un achat LEAPS sur la barre du jour", () => {
    const levels: ChartLevel[] = [{ kind: "leapsBuy", when: "2026-03-17", quantity: 2 }];

    expect(drawnLevels(levels, [bar("2026-03-17", 10, 8)], false, word, "fr")[0]).toMatchObject({ price: 9, label: "9 LEAPS: 2" });
  });

  it("laisse un condor sans prix ni étiquette", () => {
    const levels: ChartLevel[] = [
      { kind: "condor", from: "2026-04-02", to: "2026-06-19", putStrikes: [8, 10], callStrikes: [16, 18], quantity: -1 },
    ];

    expect(drawnLevels(levels, [], false, word, "fr")[0]).toMatchObject({ price: null, label: null });
  });

  it("laisse sans étiquette un achat LEAPS dont le jour n'a pas de barre", () => {
    const levels: ChartLevel[] = [{ kind: "leapsBuy", when: "2024-01-02", quantity: 2 }];

    expect(drawnLevels(levels, [bar("2026-03-17", 10, 8)], false, word, "fr")[0]).toMatchObject({ price: null, label: null });
  });
});
