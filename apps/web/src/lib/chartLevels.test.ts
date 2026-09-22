import { describe, expect, it } from "vitest";
import type { ChartLevel } from "@ib/ledger";
import { CHART_COLORS } from "@/lib/chartColors";
import { formatLevelValue, levelColor, levelFill, levelLabel, levelPrice } from "@/lib/chartLevels";

const bar = (date: string, high: number, low: number) => ({ date, open: low, high, low, close: high, volume: 1 });

describe("chartLevels", () => {
  it("donne à chaque nature la teinte du ton de journal correspondant", () => {
    expect(levelColor("shares", false)).toBe(CHART_COLORS.light.series[0]);
    expect(levelColor("shortCall", false)).toBe(CHART_COLORS.light.series[1]);
    expect(levelColor("shortPut", false)).toBe(CHART_COLORS.light.series[2]);
    expect(levelColor("leapsBuy", false)).toBe(CHART_COLORS.light.series[3]);
    expect(levelColor("shortPut", true)).toBe(CHART_COLORS.dark.series[2]);
  });

  it("voile le remplissage d'un condor plus fort sur le thème sombre", () => {
    // Sur fond sombre, l'opacité du thème clair ne se distingue plus du fond : elle double.
    expect(levelFill("condor", false)).toBe(`${CHART_COLORS.light.series[0]}33`);
    expect(levelFill("condor", true)).toBe(`${CHART_COLORS.dark.series[0]}66`);
  });

  it("lit le prix d'un achat LEAPS au milieu haut-bas de la barre du jour", () => {
    const level: ChartLevel = { kind: "leapsBuy", when: "2026-03-17", quantity: 2 };

    expect(levelPrice(level, [bar("2026-03-16", 9, 7), bar("2026-03-17", 10, 8)])).toBe(9);
  });

  it("rend null quand le jour d'achat n'a pas de barre", () => {
    const level: ChartLevel = { kind: "leapsBuy", when: "2024-01-02", quantity: 2 };

    expect(levelPrice(level, [bar("2026-03-17", 10, 8)])).toBeNull();
  });

  it("rend le prix porté par le niveau pour les autres natures", () => {
    expect(levelPrice({ kind: "shortPut", price: 17.5, quantity: -6, expiries: [] }, [])).toBe(17.5);
    expect(levelPrice({ kind: "condor", from: "", to: "", putStrikes: [8, 10], callStrikes: [16, 18], quantity: -1 }, [])).toBeNull();
  });

  it("écrit les nombres court, sans zéros inutiles, dans la locale", () => {
    expect(formatLevelValue(22, "fr")).toBe("22");
    expect(formatLevelValue(17.5, "fr")).toBe("17,5");
    expect(formatLevelValue(17.5, "en")).toBe("17.5");
  });

  it("compose l'étiquette : le niveau, la nature, la quantité signée", () => {
    expect(levelLabel({ kind: "shortPut", price: 17.5, quantity: -6, expiries: [] }, 17.5, "Put", "fr")).toBe("17,5 Put: -6");
    expect(levelLabel({ kind: "shares", price: 14.8, quantity: 700 }, 14.8, "Long", "fr")).toBe("14,8 Long: 700");
    expect(levelLabel({ kind: "leapsBuy", when: "2026-03-17", quantity: 2 }, 9, "LEAPS", "fr")).toBe("9 LEAPS: 2");
  });
});
