import { describe, expect, it } from "vitest";
import type { ChartLevel } from "@ib/ledger";
import { timeExtent } from "@/lib/levelsPrimitive";

const bar = (date: string) => ({ date, open: 1, high: 1, low: 1, close: 1, volume: 1 });

describe("timeExtent", () => {
  it("prolonge l'axe jusqu'à l'échéance la plus lointaine, jours ouvrés seulement", () => {
    const levels: ChartLevel[] = [
      { kind: "shortPut", price: 17.5, quantity: -4, expiries: ["2026-09-25"] },
      { kind: "shortCall", price: 22, quantity: -1, expiries: ["2026-09-23"] },
    ];

    const days = timeExtent([bar("2026-09-21"), bar("2026-09-22")], levels);

    expect(days).toEqual(["2026-09-23", "2026-09-24", "2026-09-25"]);
  });

  it("ne prolonge rien quand tout est déjà couvert par les barres", () => {
    const levels: ChartLevel[] = [{ kind: "shortPut", price: 17.5, quantity: -4, expiries: ["2026-09-21"] }];

    expect(timeExtent([bar("2026-09-21"), bar("2026-09-22")], levels)).toEqual([]);
  });

  it("compte l'échéance d'un condor comme une date à couvrir", () => {
    const levels: ChartLevel[] = [
      { kind: "condor", from: "2026-04-02", to: "2026-09-24", putStrikes: [8, 10], callStrikes: [16, 18], quantity: -1 },
    ];

    expect(timeExtent([bar("2026-09-22")], levels)).toEqual(["2026-09-23", "2026-09-24"]);
  });

  it("ne prolonge rien sans barre : il n'y a alors rien à dessiner", () => {
    const levels: ChartLevel[] = [{ kind: "shortPut", price: 17.5, quantity: -4, expiries: ["2026-12-18"] }];

    expect(timeExtent([], levels)).toEqual([]);
  });

  it("place la date la plus lointaine même si elle tombe un week-end", () => {
    const levels: ChartLevel[] = [
      { kind: "shortPut", price: 17.5, quantity: -4, expiries: ["2026-09-26"] },
    ];

    // 2026-09-26 est un samedi : les jours intermédiaires restent ouvrés, mais la date
    // demandée doit exister, sinon rien ne peut la placer.
    expect(timeExtent([bar("2026-09-22")], levels)).toEqual(["2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26"]);
  });
});
