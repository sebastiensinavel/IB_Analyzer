import { describe, expect, it } from "vitest";
import { buildRiskReport } from "@ib/coverage";
import { POSITION_COLUMNS, positionColumnSpecs } from "@/lib/positionColumns";
import { SAMPLE_POSITIONS } from "@/mocks/positions";

describe("positionColumnSpecs", () => {
  it("types every shared column, in its order, coverage filterable but not sortable", () => {
    const specs = positionColumnSpecs(() => null);
    expect(specs.map((spec) => spec.key)).toEqual(POSITION_COLUMNS.map((column) => column.key));
    expect(specs.map((spec) => spec.type)).toEqual(["text", "enum", "enum", "number", "number", "number", "number", "number", "enum", "enum"]);
    expect(specs.filter((spec) => !spec.sortable).map((spec) => spec.key)).toEqual(["coverage"]);
  });

  it("compares what the row shows, the sector read through sectorOf", () => {
    const report = buildRiskReport(SAMPLE_POSITIONS, 42000);
    const put = report.positions.find((position) => position.symbol === "XOM")!;
    const specs = Object.fromEntries(positionColumnSpecs((symbol) => (symbol === "XOM" ? "Energy" : null)).map((spec) => [spec.key, spec]));
    expect(specs.position.value(put)).toBe("XOM Mar20'26 100 Put");
    expect(specs.type.value(put)).toBe("short_put");
    expect(specs.type.label?.("short_put")).toBe("sell of put");
    expect(specs.sector.value(put)).toBe("Energy");
    expect(specs.unrealizedPnl.value(put)).toBe(490);
    expect(specs.decision.value(put)).toBe(put.decision);
    expect(specs.coverage.value(put)).toEqual(["cash"]);
  });
});

describe("POSITION_COLUMNS widths", () => {
  it("add up to 100%, so a rebalancing never silently drops a column's share", () => {
    const total = POSITION_COLUMNS.reduce((sum, column) => sum + Number.parseFloat(column.width), 0);
    expect(total).toBeCloseTo(100, 5);
  });
});
