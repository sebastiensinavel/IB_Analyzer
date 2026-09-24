import { describe, expect, it } from "vitest";
import type { ChartLevel } from "@ib/ledger";
import { CHART_COLORS } from "@/lib/chartColors";
import { formatLevelValue, labelInk, levelColor, levelFill, levelLabel, levelPrice } from "@/lib/chartLevels";

/** Ratio de contraste WCAG, recalculé indépendamment de `labelInk` pour vérifier son résultat. */
function contrastRatio(a: string, b: string): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex: string) =>
    0.2126 * channel(parseInt(hex.slice(1, 3), 16)) +
    0.7152 * channel(parseInt(hex.slice(3, 5), 16)) +
    0.0722 * channel(parseInt(hex.slice(5, 7), 16));
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

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

  describe("labelInk", () => {
    it("choisit l'encre sombre sur l'or des calls vendus en sombre, le blanc n'y tenant plus 4,5", () => {
      // #e6b04a (dark.series[1]) : blanc ~1,97, encre sombre ~8,98.
      expect(labelInk("#e6b04a")).toBe("#0d1a22");
    });

    it("choisit le blanc sur le violet des LEAPS en clair, le plus foncé des deux teintes", () => {
      // #7b5ce5 (light.series[3]) : blanc ~4,66, encre sombre ~3,79 — le blanc gagne ici.
      expect(labelInk("#7b5ce5")).toBe("#ffffff");
    });

    it("choisit toujours l'encre au contraste le plus haut, sur chaque teinte de série des deux thèmes", () => {
      for (const hue of [...CHART_COLORS.light.series, ...CHART_COLORS.dark.series]) {
        const ink = labelInk(hue);
        const other = ink === "#ffffff" ? "#0d1a22" : "#ffffff";
        const chosen = contrastRatio(ink, hue);
        const rejected = contrastRatio(other, hue);
        // Soit l'encre choisie atteint le seuil AA (4,5), soit elle est simplement la meilleure
        // des deux disponibles : aucune teinte de la palette n'est forcée à un contraste illisible.
        expect(chosen >= 4.5 || chosen >= rejected).toBe(true);
        expect(chosen).toBeGreaterThanOrEqual(rejected);
      }
    });
  });
});
