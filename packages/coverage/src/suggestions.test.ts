import { describe, expect, it } from "vitest";
import type { Position } from "@ib/ledger";
import { MAX_SUGGESTIONS } from "./constants.ts";
import { option, stock } from "./fixtures.ts";
import { buildRiskReport } from "./report.ts";
import { positionSuggestions, type PositionSuggestion, type SectorEntry } from "./suggestions.ts";

function entry(ticker: string, category: string, score: number | null, status = "on"): SectorEntry {
  return { ticker, category, score, status };
}

function report(...positions: Position[]) {
  return buildRiskReport(positions, null);
}

const tickers = (suggestions: PositionSuggestion[]) => suggestions.map((s) => s.ticker);

describe("positionSuggestions — ported from select_put_sell_candidates", () => {
  it("orders by sector exposure, then by score", () => {
    // Tech is held, Energy is not; PAD, without a sector, only keeps AAA under the 5% cap.
    const result = positionSuggestions(
      [entry("AAA", "Tech", 7), entry("BBB", "Tech", 6.5), entry("CCC", "Energy", 9)],
      report(stock({ symbol: "AAA", marketValue: 1000 }), stock({ symbol: "PAD", marketValue: 100_000 })),
    );
    expect(tickers(result)).toEqual(["CCC", "AAA", "BBB"]);
  });

  it("excludes scores below the minimum", () => {
    expect(tickers(positionSuggestions([entry("AAA", "Tech", 5.9), entry("BBB", "Tech", 6)], null))).toEqual(["BBB"]);
  });

  it("excludes an inactive status", () => {
    expect(tickers(positionSuggestions([entry("AAA", "Tech", 9, "off"), entry("BBB", "Tech", 6)], null))).toEqual(["BBB"]);
  });

  it("excludes a missing score or a missing sector", () => {
    expect(tickers(positionSuggestions([entry("AAA", "Tech", null), entry("BBB", "", 9), entry("CCC", "Tech", 6)], null))).toEqual(["CCC"]);
  });

  it("caps the list", () => {
    const entries = Array.from({ length: 25 }, (_, i) => entry(`T${String(i).padStart(2, "0")}`, "Tech", 7));
    expect(positionSuggestions(entries, null)).toHaveLength(MAX_SUGGESTIONS);
    expect(MAX_SUGGESTIONS).toBe(20);
  });

  it("puts the ticker least held first within one sector and one score", () => {
    const result = positionSuggestions(
      [entry("AAA", "Tech", 7), entry("BBB", "Tech", 7)],
      report(stock({ symbol: "AAA", marketValue: 200 }), stock({ symbol: "BBB", marketValue: 50 }), stock({ symbol: "PAD", marketValue: 100_000 })),
    );
    expect(tickers(result)).toEqual(["BBB", "AAA"]);
  });

  it("drops a ticker at exactly 5% of the risk, whatever its score", () => {
    const result = positionSuggestions(
      [entry("AAA", "Tech", 9.9), entry("BBB", "Tech", 6)],
      report(stock({ symbol: "AAA", marketValue: 5_000 }), stock({ symbol: "PAD", marketValue: 95_000 })),
    );
    expect(tickers(result)).toEqual(["BBB"]);
  });

  it("measures exposure in risk value: a sold put weighs its assignment amount, not its premium", () => {
    const result = positionSuggestions(
      [entry("AAA", "Tech", 9.9), entry("BBB", "Tech", 6)],
      report(option({ symbol: "AAA", right: "P", quantity: -1, strike: 100, marketValue: -200 }), stock({ symbol: "PAD", marketValue: 100_000 })),
    );
    expect(tickers(result)).toEqual(["BBB"]);
  });
});

describe("positionSuggestions — what the TypeScript port adds", () => {
  it("gives each suggestion its rank and the share of risk its sector and its ticker already carry", () => {
    const result = positionSuggestions(
      [entry("AAA", "Tech", 7), entry("BBB", "Tech", 8)],
      report(stock({ symbol: "AAA", marketValue: 1000 }), stock({ symbol: "PAD", marketValue: 99_000 })),
    );
    expect(result).toEqual([
      { rank: 1, ticker: "BBB", sector: "Tech", score: 8, sectorShare: 0.01, tickerShare: 0 },
      { rank: 2, ticker: "AAA", sector: "Tech", score: 7, sectorShare: 0.01, tickerShare: 0.01 },
    ]);
  });

  it("reads the status and the sector without case or surrounding spaces", () => {
    expect(positionSuggestions([entry(" aaa ", "  Tech ", 7, " On ")], null)).toEqual([
      { rank: 1, ticker: "AAA", sector: "Tech", score: 7, sectorShare: 0, tickerShare: 0 },
    ]);
  });

  it("counts an unknown risk value as nothing", () => {
    const result = positionSuggestions(
      [entry("AAA", "Tech", 7)],
      report(stock({ symbol: "AAA", marketValue: null }), stock({ symbol: "PAD", marketValue: 100 })),
    );
    expect(result).toEqual([{ rank: 1, ticker: "AAA", sector: "Tech", score: 7, sectorShare: 0, tickerShare: 0 }]);
  });

  it("still suggests without a snapshot, by score, every share at 0", () => {
    expect(positionSuggestions([entry("AAA", "Tech", 6), entry("BBB", "Energy", 9)], null)).toEqual([
      { rank: 1, ticker: "BBB", sector: "Energy", score: 9, sectorShare: 0, tickerShare: 0 },
      { rank: 2, ticker: "AAA", sector: "Tech", score: 6, sectorShare: 0, tickerShare: 0 },
    ]);
  });
});
