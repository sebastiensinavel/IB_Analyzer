import { describe, expect, it } from "vitest";
import { buildRiskReport, type AnalyzedPosition, type StrategyLine } from "@ib/coverage";
import { formatContract } from "@/lib/format";
import { SAMPLE_POSITIONS } from "@/mocks/positions";
import {
  allocationBadges,
  coverageBadges,
  coverageValues,
  decisionBadge,
  groupTitleKey,
  strategyCoverageBadges,
  strategyCoverageValues,
  usedBadge,
} from "@/lib/riskReport";

function position(overrides: Partial<AnalyzedPosition>): AnalyzedPosition {
  return {
    description: "TEST",
    kind: "short_put",
    label: "sell of put",
    marketValue: 0,
    quantity: -1,
    avgPrice: 1,
    lastPrice: 1,
    dailyPnl: null,
    dayChange: null,
    unrealizedPnl: 0,
    action: "to evaluate",
    decision: "keep",
    symbol: "TEST",
    secType: "OPT",
    currency: "USD",
    right: "P",
    strike: 100,
    expiry: "2026-01-01",
    multiplier: 100,
    allocations: [],
    uncoveredQuantity: 0,
    usedQuantity: 0,
    requiredCash: 0,
    riskNotes: [],
    ...overrides,
  };
}

describe("groupTitleKey", () => {
  it("maps a group id to its i18n key", () => {
    expect(groupTitleKey("optionSells")).toBe("positions.groups.optionSells");
  });
});

describe("decisionBadge", () => {
  it("maps 'keep' to a success badge", () => {
    expect(decisionBadge("keep")).toEqual({ variant: "success", label: "keep" });
  });

  it("maps 'buy back' to a destructive badge", () => {
    expect(decisionBadge("buy back")).toEqual({ variant: "destructive", label: "buy back" });
  });

  it("returns null when there is no decision", () => {
    expect(decisionBadge(null)).toBeNull();
  });
});

describe("coverageBadges", () => {
  it("renders one badge per allocation plus an UNCOVERED badge for a short leg", () => {
    const p = position({
      kind: "short_call",
      allocations: [{ source: "leaps", quantity: 1, detail: "AAPL 2028-01-21 C 100" }],
      uncoveredQuantity: 1,
    });

    expect(coverageBadges(p)).toEqual([
      { variant: "secondary", label: "leaps ×1", tooltip: "AAPL 2028-01-21 C 100" },
      { variant: "destructive", label: "UNCOVERED ×1", tooltip: null },
    ]);
  });

  it("renders a single UNCOVERED badge for a short leg with no allocation at all", () => {
    const p = position({ kind: "short_put", allocations: [], uncoveredQuantity: 0 });
    expect(coverageBadges(p)).toEqual([{ variant: "destructive", label: "UNCOVERED", tooltip: null }]);
  });

  it("renders 'used X/Y' for a long cover partially or fully consumed", () => {
    const p = position({ kind: "long_stock", quantity: 200, usedQuantity: 100 });
    expect(coverageBadges(p)).toEqual([{ variant: "success", label: "used 100/200", tooltip: null }]);
  });

  it("renders 'unused' for a long cover backing nothing", () => {
    const p = position({ kind: "long_call", quantity: 2, usedQuantity: 0 });
    expect(coverageBadges(p)).toEqual([{ variant: "outline", label: "unused", tooltip: null }]);
  });

  it("renders nothing for a kind that is neither a short option nor a long cover", () => {
    expect(coverageBadges(position({ kind: "short_stock" }))).toEqual([]);
  });

  it("renders nothing without a position, for a line the snapshot does not hold", () => {
    expect(coverageBadges(null)).toEqual([]);
  });
});

/** A Wheel call sold on TEST, one contract. */
function line(overrides: Partial<StrategyLine>): StrategyLine {
  return {
    contract: { ticker: "TEST", secType: "OPT", right: "C", strike: 20, expiry: "2026-11-20", currency: "USD" },
    kind: "short_call",
    label: "sell of call",
    quantity: -1,
    avgPrice: 1,
    lastPrice: 1,
    marketValue: -100,
    dailyPnl: null,
    dayChange: null,
    unrealizedPnl: 0,
    decision: "keep",
    position: null,
    coverage: [],
    used: null,
    ...overrides,
  };
}

describe("usedBadge", () => {
  it("reads 'used X/Y' as soon as something covers, partly or fully, and 'unused' otherwise", () => {
    expect(usedBadge(400, 400)).toEqual({ variant: "success", label: "used 400/400", tooltip: null });
    expect(usedBadge(100, 200)).toEqual({ variant: "success", label: "used 100/200", tooltip: null });
    expect(usedBadge(0, 75)).toEqual({ variant: "outline", label: "unused", tooltip: null });
  });
});

describe("allocationBadges", () => {
  it("renders one badge per allocation, with its detail as tooltip", () => {
    expect(
      allocationBadges([
        { source: "stock", quantity: 2, detail: "" },
        { source: "leaps", quantity: 1, detail: "TEST 2028-01-21 C 15" },
      ]),
    ).toEqual([
      { variant: "success", label: "stock ×2", tooltip: null },
      { variant: "secondary", label: "leaps ×1", tooltip: "TEST 2028-01-21 C 15" },
    ]);
  });
});

describe("strategyCoverageBadges", () => {
  it("shows a sold option the strategy's cover only, never an UNCOVERED badge", () => {
    const whole = position({
      kind: "short_call",
      allocations: [
        { source: "stock", quantity: 1, detail: "" },
        { source: "leaps", quantity: 1, detail: "" },
      ],
      uncoveredQuantity: 1,
    });
    expect(strategyCoverageBadges(line({ position: whole, coverage: [{ source: "stock", quantity: 1, detail: "" }] }), "wheel")).toEqual([
      { variant: "success", label: "stock ×1", tooltip: null },
    ]);
    expect(strategyCoverageBadges(line({ position: whole, coverage: [] }), "wheel")).toEqual([]);
  });

  it("keeps 'used X/Y' on a LEAPS bought, and shows nothing on shares", () => {
    const bought = position({ kind: "long_call", quantity: 8, usedQuantity: 8 });
    expect(strategyCoverageBadges(line({ kind: "long_call", label: "buy of call", quantity: 8, position: bought }), "leaps")).toEqual([
      { variant: "success", label: "used 8/8", tooltip: null },
    ]);
    const held = position({ kind: "long_stock", quantity: 100, usedQuantity: 100 });
    expect(strategyCoverageBadges(line({ kind: "long_stock", label: "long", quantity: 100, position: held }), "leaps")).toEqual([]);
  });

  it("shows a sold option of Others the naked quantity only, never an allocation", () => {
    expect(strategyCoverageBadges(line({ kind: "short_call", quantity: -3, coverage: [{ source: "stock", quantity: 3, detail: "" }] }), "others")).toEqual(
      [{ variant: "destructive", label: "UNCOVERED ×3", tooltip: null }],
    );
  });
});

describe("strategyCoverageValues", () => {
  it("mirrors strategyCoverageBadges branch for branch, as filterable values", () => {
    const whole = position({
      kind: "short_call",
      allocations: [
        { source: "stock", quantity: 1, detail: "" },
        { source: "leaps", quantity: 1, detail: "" },
      ],
      uncoveredQuantity: 1,
    });
    expect(strategyCoverageValues(line({ position: whole, coverage: [{ source: "stock", quantity: 1, detail: "" }] }), "wheel")).toEqual(["stock"]);
    expect(strategyCoverageValues(line({ kind: "short_call", quantity: -3, coverage: [] }), "others")).toEqual(["UNCOVERED"]);
    const bought = position({ kind: "long_call", quantity: 8, usedQuantity: 8 });
    expect(strategyCoverageValues(line({ kind: "long_call", label: "buy of call", quantity: 8, position: bought }), "leaps")).toEqual(["used"]);
    // No position at all — the journal reads the wing open, the snapshot does not carry it — so
    // both halves of the mirror stay empty: an empty badge cell (nothing to render) and an empty
    // filterable value (facetValues files it under "—", the rule for any absent value).
    const wingWithoutPosition = line({ kind: "long_put", label: "buy of put", quantity: 1, position: null });
    expect(strategyCoverageBadges(wingWithoutPosition, "condors")).toEqual([]);
    expect(strategyCoverageValues(wingWithoutPosition, "condors")).toEqual([]);
    const held = position({ kind: "long_stock", quantity: 100, usedQuantity: 100 });
    expect(strategyCoverageValues(line({ kind: "long_stock", label: "long", quantity: 100, position: held }), "wheel")).toEqual([]);
  });
});

describe("coverageValues", () => {
  it("names the sources the badges show, UNCOVERED and used/unused included, never parsing a label", () => {
    const report = buildRiskReport(SAMPLE_POSITIONS, 42000);
    const bySpelling = new Map(report.positions.map((position) => [formatContract(position), position]));
    expect(coverageValues(bySpelling.get("XOM Mar20'26 100 Put")!)).toEqual(["cash"]);
    expect(coverageValues(bySpelling.get("AAPL Feb20'26 155 Call")!)).toEqual(["stock", "UNCOVERED"]);
    expect(coverageValues(bySpelling.get("MSFT Mar20'26 400 Call")!)).toEqual(["leaps"]);
    expect(coverageValues(bySpelling.get("AAPL")!)).toEqual(["used"]);
    for (const position of report.positions) {
      const badgeSources = coverageBadges(position).map((badge) => badge.label.split(" ")[0]);
      expect(coverageValues(position)).toEqual([...new Set(badgeSources)]);
    }
  });

  it("gives UNCOVERED to a sale without any allocation, unused to an idle long cover, nothing to other kinds", () => {
    const report = buildRiskReport(SAMPLE_POSITIONS, 42000);
    const sale = report.positions.find((position) => position.kind === "short_put")!;
    expect(coverageValues({ ...sale, allocations: [], uncoveredQuantity: 0 })).toEqual(["UNCOVERED"]);
    const long = report.positions.find((position) => position.kind === "long_stock")!;
    expect(coverageValues({ ...long, usedQuantity: 0 })).toEqual(["unused"]);
    expect(coverageValues({ ...long, kind: "other" })).toEqual([]);
  });
});
