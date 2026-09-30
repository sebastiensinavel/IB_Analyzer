import { describe, expect, it } from "vitest";
import type { Position } from "@ib/ledger";
import type { PriceBar } from "@/agent/client";
import type { SnapshotRecord } from "@/db/schema";
import { withLiveClose } from "@/lib/chartLiveBar";

const BARS: PriceBar[] = [
  { date: "2026-09-29", open: 12, high: 13, low: 11, close: 12.5, volume: 1 },
  { date: "2026-09-30", open: 13, high: 14, low: 12, close: 13.5, volume: 1 },
];

function stock(overrides: Partial<Position> = {}): Position {
  return {
    symbol: "BTDR",
    secType: "STK",
    right: "",
    strike: null,
    expiry: null,
    multiplier: 1,
    quantity: 100,
    avgPrice: 10,
    marketPrice: 13.8,
    marketValue: 1380,
    unrealizedPnl: 380,
    dailyPnl: 30,
    dayChange: 0.02,
    currency: "USD",
    conid: "1",
    description: "BTDR",
    ...overrides,
  };
}

/** Un snapshot de l'agent : `asOf` est l'heure murale de New York stampée UTC. */
function snapshot(overrides: Partial<SnapshotRecord> = {}): SnapshotRecord {
  return {
    accountId: "alpha",
    source: "agent",
    asOf: "2026-09-30T11:15:00.000Z",
    importedAt: "2026-09-30T15:15:02.000Z",
    positions: [stock()],
    cashAvailable: null,
    ...overrides,
  };
}

describe("withLiveClose", () => {
  it("clôture la bougie du jour sur le prix de l'action détenue", () => {
    const bars = withLiveClose(BARS, snapshot(), "BTDR", "USD");

    expect(bars).toEqual([BARS[0], { ...BARS[1], close: 13.8 }]);
  });

  it("élargit le haut de la bougie à un prix qui le dépasse", () => {
    const bars = withLiveClose(BARS, snapshot({ positions: [stock({ marketPrice: 14.4 })] }), "BTDR", "USD");

    expect(bars.at(-1)).toEqual({ ...BARS[1], close: 14.4, high: 14.4 });
  });

  it("élargit le bas de la bougie à un prix qui passe dessous", () => {
    const bars = withLiveClose(BARS, snapshot({ positions: [stock({ marketPrice: 11.7 })] }), "BTDR", "USD");

    expect(bars.at(-1)).toEqual({ ...BARS[1], close: 11.7, low: 11.7 });
  });

  it("lit le ticker sans égard à la casse", () => {
    expect(withLiveClose(BARS, snapshot(), "btdr", "usd").at(-1)!.close).toBe(13.8);
  });

  it("clôture encore à 09:30 et à 16:00, les bornes de la séance", () => {
    expect(withLiveClose(BARS, snapshot({ asOf: "2026-09-30T09:30:00.000Z" }), "BTDR", "USD").at(-1)!.close).toBe(13.8);
    expect(withLiveClose(BARS, snapshot({ asOf: "2026-09-30T16:00:00.000Z" }), "BTDR", "USD").at(-1)!.close).toBe(13.8);
  });

  it.each([
    ["sans snapshot", null],
    ["pendant le chargement du snapshot", undefined],
    ["pour un snapshot Flex", snapshot({ source: "flex", asOf: "2026-09-30" })],
    ["pour un snapshot de relevé", snapshot({ source: "statement_html", asOf: "2026-09-30" })],
    ["quand l'action n'est pas détenue", snapshot({ positions: [stock({ symbol: "AAPL" })] })],
    ["quand seule une option du ticker est détenue", snapshot({ positions: [stock({ secType: "OPT", right: "C" })] })],
    ["quand l'action détenue est dans une autre devise", snapshot({ positions: [stock({ currency: "CAD" })] })],
    ["quand le prix de l'action est absent", snapshot({ positions: [stock({ marketPrice: null })] })],
    ["quand la dernière bougie n'est pas celle du jour du snapshot", snapshot({ asOf: "2026-10-01T11:15:00.000Z" })],
    ["avant l'ouverture de la séance", snapshot({ asOf: "2026-09-30T09:29:59.000Z" })],
    ["après la clôture de la séance", snapshot({ asOf: "2026-09-30T16:00:01.000Z" })],
  ])("laisse les barres d'IB %s", (_, record) => {
    expect(withLiveClose(BARS, record, "BTDR", "USD")).toBe(BARS);
  });

  it("laisse une liste vide telle quelle", () => {
    const empty: PriceBar[] = [];

    expect(withLiveClose(empty, snapshot(), "BTDR", "USD")).toBe(empty);
  });
});
