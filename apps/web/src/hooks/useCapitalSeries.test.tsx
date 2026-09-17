import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import { useCapitalSeries } from "@/hooks/useCapitalSeries";

const wrapper = ({ children }: { children: ReactNode }) => <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;

describe("useCapitalSeries", () => {
  it("names the Wheel's four lines in the language on screen", () => {
    const { result } = renderHook(() => useCapitalSeries("wheel"), { wrapper });
    expect(result.current).toEqual([
      { key: "cumulativePnl", name: "Cumul des profits/pertes" },
      { key: "assigned", name: "Assigné" },
      { key: "allocated", name: "Alloué" },
      { key: "invested", name: "Cash investi" },
    ]);
  });

  it("names no assigned line for the portfolio", () => {
    const { result } = renderHook(() => useCapitalSeries("portfolio"), { wrapper });
    expect(result.current.map((s) => s.name)).toEqual(["Cumul des profits/pertes", "Alloué", "Cash investi"]);
  });
});
