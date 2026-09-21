import { describe, expect, it } from "vitest";
import { strategyLevels, type ChartLevel } from "../src/journals/levels.ts";
import type { JournalRow, Strategy } from "../src/journals/types.ts";

const ALL: Strategy[] = ["wheel", "leaps", "condors", "others"];

function row(over: Partial<JournalRow> & Pick<JournalRow, "kind" | "strategy">): JournalRow {
  const strike = over.strike ?? null;
  return {
    id: over.id ?? `${over.kind}-${strike ?? "x"}`,
    strategy: over.strategy,
    kind: over.kind,
    ticker: over.ticker ?? "BTDR",
    label: "",
    currency: "USD",
    contract: {
      ticker: over.ticker ?? "BTDR",
      secType: over.kind === "shares" ? "STK" : "OPT",
      right: over.kind === "short_put" ? "P" : over.kind === "shares" ? "" : "C",
      strike,
      expiry: over.contract?.expiry ?? null,
      currency: "USD",
    },
    startWhen: over.startWhen ?? "2026-05-29T14:30:00.000Z",
    quantity: over.quantity ?? null,
    strike,
    openPrice: over.openPrice ?? null,
    openTotal: null,
    openCommission: null,
    openNet: null,
    assigned: over.assigned ?? false,
    endWhen: over.endWhen ?? null,
    closePrice: null,
    closeTotal: null,
    closeCommission: null,
    closeNet: null,
    pnl: null,
    ongoing: over.ongoing ?? true,
    event: over.event ?? null,
    orphan: false,
    note: null,
    openIds: [],
    closeIds: [],
    ...(over.legs ? { legs: over.legs } : {}),
  } as JournalRow;
}

const find = (levels: ChartLevel[], kind: ChartLevel["kind"]) => levels.filter((l) => l.kind === kind);

describe("strategyLevels", () => {
  it("fond deux échéances au même strike en une ligne aux quantités cumulées", () => {
    const rows = [
      row({ kind: "short_put", strategy: "wheel", strike: 17.5, quantity: -4, contract: { expiry: "2026-10-16" } as never }),
      row({ id: "p2", kind: "short_put", strategy: "wheel", strike: 17.5, quantity: -2, contract: { expiry: "2026-11-20" } as never }),
    ];

    const puts = find(strategyLevels(rows, "BTDR", ALL), "shortPut");

    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ price: 17.5, quantity: -6, expiries: ["2026-10-16", "2026-11-20"] });
  });

  it("garde deux strikes distincts séparés, et sépare puts et calls", () => {
    const rows = [
      row({ kind: "short_put", strategy: "wheel", strike: 17.5, quantity: -4, contract: { expiry: "2026-10-16" } as never }),
      row({ id: "p3", kind: "short_put", strategy: "wheel", strike: 15, quantity: -1, contract: { expiry: "2026-10-16" } as never }),
      row({ id: "c1", kind: "short_call", strategy: "wheel", strike: 22, quantity: -3, contract: { expiry: "2026-10-16" } as never }),
    ];

    const levels = strategyLevels(rows, "BTDR", ALL);

    expect(find(levels, "shortPut").map((l) => (l as { price: number }).price)).toEqual([15, 17.5]);
    expect(find(levels, "shortCall")).toMatchObject([{ price: 22, quantity: -3 }]);
  });

  it("ne compte plus un put clos, même s'il reste ongoing après assignation", () => {
    const rows = [
      row({
        kind: "short_put",
        strategy: "wheel",
        strike: 17.5,
        quantity: -4,
        contract: { expiry: "2026-05-15" } as never,
        endWhen: "2026-05-15T20:00:00.000Z",
        event: "assigned",
        assigned: true,
        ongoing: true,
      }),
    ];

    expect(find(strategyLevels(rows, "BTDR", ALL), "shortPut")).toEqual([]);
  });

  it("rend les actions assignées au prix moyen d'assignation", () => {
    const rows = [
      row({ kind: "shares", strategy: "wheel", quantity: 400, openPrice: 17.5, assigned: true }),
      row({ id: "s2", kind: "shares", strategy: "wheel", quantity: 300, openPrice: 14, assigned: true }),
    ];

    const shares = find(strategyLevels(rows, "BTDR", ALL), "shares");

    expect(shares).toHaveLength(1);
    expect(shares[0]).toMatchObject({ quantity: 700 });
    expect((shares[0] as { price: number }).price).toBeCloseTo(16, 10);
  });

  it("ne retient que les lignes du ticker demandé et des stratégies demandées", () => {
    const rows = [
      row({ kind: "short_put", strategy: "wheel", strike: 17.5, quantity: -4, contract: { expiry: "2026-10-16" } as never }),
      row({ id: "o1", kind: "short_put", strategy: "others", strike: 9, quantity: -1, contract: { expiry: "2026-10-16" } as never }),
      row({ id: "x1", ticker: "AAPL", kind: "short_put", strategy: "wheel", strike: 200, quantity: -1, contract: { expiry: "2026-10-16" } as never }),
    ];

    const levels = strategyLevels(rows, "BTDR", ["wheel"]);

    expect(find(levels, "shortPut")).toMatchObject([{ price: 17.5 }]);
  });

  it("ignore une vente d'option sans strike ou sans échéance", () => {
    const rows = [
      row({ kind: "short_put", strategy: "wheel", strike: null, quantity: -4, contract: { expiry: "2026-10-16" } as never }),
      row({ id: "p9", kind: "short_put", strategy: "wheel", strike: 17.5, quantity: -4 }),
    ];

    expect(find(strategyLevels(rows, "BTDR", ALL), "shortPut")).toEqual([]);
  });

  it("rend un achat de call LEAPS au jour de l'achat, sans prix", () => {
    const rows = [
      row({
        kind: "long_call",
        strategy: "leaps",
        strike: 12,
        quantity: 2,
        openPrice: 4.2,
        startWhen: "2026-03-17T15:02:00.000Z",
        contract: { expiry: "2027-01-15" } as never,
      }),
    ];

    expect(find(strategyLevels(rows, "BTDR", ALL), "leapsBuy")).toEqual([
      { kind: "leapsBuy", when: "2026-03-17", quantity: 2 },
    ]);
  });

  it("ne rend pas un call acheté hors LEAPS", () => {
    const rows = [
      row({ kind: "long_call", strategy: "others", strike: 12, quantity: 1, contract: { expiry: "2026-10-16" } as never }),
    ];

    expect(find(strategyLevels(rows, "BTDR", ALL), "leapsBuy")).toEqual([]);
  });

  it("rend un condor de son ouverture à son échéance, strikes croissants", () => {
    const legs = [
      row({ id: "lp", kind: "long_put", strategy: "condors", strike: 8, quantity: 1 }),
      row({ id: "sp", kind: "short_put", strategy: "condors", strike: 10, quantity: -1 }),
      row({ id: "sc", kind: "short_call", strategy: "condors", strike: 16, quantity: -1 }),
      row({ id: "lc", kind: "long_call", strategy: "condors", strike: 18, quantity: 1 }),
    ];
    const rows = [
      row({
        id: "ic",
        kind: "condor",
        strategy: "condors",
        quantity: -1,
        startWhen: "2026-04-02T13:45:00.000Z",
        contract: { expiry: "2026-06-19" } as never,
        legs,
      }),
      ...legs,
    ];

    expect(find(strategyLevels(rows, "BTDR", ALL), "condor")).toEqual([
      {
        kind: "condor",
        from: "2026-04-02",
        to: "2026-06-19",
        putStrikes: [8, 10],
        callStrikes: [16, 18],
        quantity: -1,
      },
    ]);
  });

  it("ignore un condor dont une jambe n'a pas de strike", () => {
    const legs = [
      row({ id: "lp", kind: "long_put", strategy: "condors", strike: null, quantity: 1 }),
      row({ id: "sp", kind: "short_put", strategy: "condors", strike: 10, quantity: -1 }),
      row({ id: "sc", kind: "short_call", strategy: "condors", strike: 16, quantity: -1 }),
      row({ id: "lc", kind: "long_call", strategy: "condors", strike: 18, quantity: 1 }),
    ];
    const rows = [
      row({ id: "ic", kind: "condor", strategy: "condors", quantity: -1, contract: { expiry: "2026-06-19" } as never, legs }),
    ];

    expect(find(strategyLevels(rows, "BTDR", ALL), "condor")).toEqual([]);
  });
});
