import { describe, expect, it } from "vitest";
import { NAV_SECTIONS } from "@/lib/navigation";

describe("NAV_SECTIONS", () => {
  it("groups each strategy's journal, then its positions and its statistics when it has them, in a section of its own", () => {
    const strategies = NAV_SECTIONS.filter((section) => section.labelKey.startsWith("nav.sections.strategy"));
    expect(
      strategies.map((section) => ({
        section: section.labelKey,
        items: section.items.map((item) => [item.labelKey, item.to("beta")]),
      })),
    ).toEqual([
      {
        section: "nav.sections.strategyWheel",
        items: [
          ["nav.journal", "/accounts/beta/journal/wheel"],
          ["nav.positions", "/accounts/beta/positions/wheel"],
          ["nav.stats", "/accounts/beta/stats/wheel"],
        ],
      },
      {
        section: "nav.sections.strategyLeaps",
        items: [
          ["nav.journal", "/accounts/beta/journal/leaps"],
          ["nav.positions", "/accounts/beta/positions/leaps"],
          ["nav.stats", "/accounts/beta/stats/leaps"],
        ],
      },
      {
        section: "nav.sections.strategyCondors",
        items: [
          ["nav.journal", "/accounts/beta/journal/condors"],
          ["nav.stats", "/accounts/beta/stats/condors"],
        ],
      },
      { section: "nav.sections.strategyOthers", items: [["nav.journal", "/accounts/beta/journal/others"]] },
    ]);
    expect(NAV_SECTIONS.map((section) => section.labelKey)).toEqual([
      "nav.sections.overview",
      "nav.sections.strategyWheel",
      "nav.sections.strategyLeaps",
      "nav.sections.strategyCondors",
      "nav.sections.strategyOthers",
      "nav.sections.configuration",
    ]);
  });

  it("puts Sector and Score right after Data sources, under the account", () => {
    const items = NAV_SECTIONS.find((section) => section.labelKey === "nav.sections.configuration")!.items;
    const keys = items.map((item) => item.labelKey);
    expect(keys.indexOf("nav.sectors")).toBe(keys.indexOf("nav.sources") + 1);
    expect(items.find((item) => item.labelKey === "nav.sectors")!.to("beta")).toBe("/accounts/beta/sectors");
  });
});
