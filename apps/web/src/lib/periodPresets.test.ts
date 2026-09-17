import { describe, expect, it } from "vitest";
import { activePreset, periodPresets, yearsOf } from "@/lib/periodPresets";

describe("yearsOf", () => {
  it("lists the years of the instants, newest first, once each", () => {
    expect(yearsOf(["2025-06-02T10:00:00.000Z", "2026-08-28T14:30:00.000Z", "2025-01-02T00:00:00.000Z", "2023-12-31T23:59:59.000Z"])).toEqual([2026, 2025, 2023]);
  });

  it("has no year without instants", () => {
    expect(yearsOf([])).toEqual([]);
  });
});

describe("periodPresets", () => {
  it("offers All, the last 30 days, the last 12 months, then each year, newest first", () => {
    expect(periodPresets([2026, 2025], "2026-09-11")).toEqual([
      { id: "all", from: "", to: "" },
      { id: "last30Days", from: "2026-08-12", to: "2026-09-11" },
      { id: "last12Months", from: "2025-09-11", to: "2026-09-11" },
      { id: "year:2026", from: "2026-01-01", to: "2026-12-31" },
      { id: "year:2025", from: "2025-01-01", to: "2025-12-31" },
    ]);
  });

  it("goes back a year from a February 29 to February 28", () => {
    expect(periodPresets([], "2024-02-29").find((preset) => preset.id === "last12Months")).toEqual({
      id: "last12Months",
      from: "2023-02-28",
      to: "2024-02-29",
    });
  });

  it("counts 30 days back across a month and across a year", () => {
    expect(periodPresets([], "2026-03-10").find((preset) => preset.id === "last30Days")?.from).toBe("2026-02-08");
    expect(periodPresets([], "2026-01-15").find((preset) => preset.id === "last30Days")?.from).toBe("2025-12-16");
  });
});

describe("activePreset", () => {
  const presets = periodPresets([2026, 2025], "2026-09-11");

  it("names the preset whose two dates are exactly in the fields", () => {
    expect(activePreset(presets, "2025-01-01", "2025-12-31")).toBe("year:2025");
    expect(activePreset(presets, "2025-09-11", "2026-09-11")).toBe("last12Months");
  });

  it("names none once a date is edited by hand", () => {
    expect(activePreset(presets, "2025-01-02", "2025-12-31")).toBeNull();
    expect(activePreset(presets, "2025-01-01", "")).toBeNull();
  });

  it("names All when both fields are empty", () => {
    expect(activePreset(presets, "", "")).toBe("all");
  });
});
