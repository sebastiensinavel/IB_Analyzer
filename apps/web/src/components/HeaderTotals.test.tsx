import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import { HeaderTotals, headerTotals } from "@/components/HeaderTotals";

const renderTotals = (totals: Parameters<typeof HeaderTotals>[0]["totals"]) =>
  render(<I18nextProvider i18n={i18n}><HeaderTotals totals={totals} /></I18nextProvider>);

type R = { c: string; d: number | null; v: number | null; p: number | null };
const build = (rows: R[]) => headerTotals(rows, (r) => r.c, { daily: (r) => r.d, value: (r) => r.v, pnl: (r) => r.p });

describe("HeaderTotals", () => {
  it("shows the day P/L, the value and the P/L, signed tones on the two P/L", () => {
    renderTotals(build([{ c: "USD", d: -215.4, v: 42310, p: 1830 }]));
    const line = screen.getByTestId("header-totals-USD");
    expect(line).toHaveTextContent("-215.40");
    expect(line).toHaveTextContent("42,310.00");
    expect(line).toHaveTextContent("1,830.00");
    expect(line).toHaveTextContent("USD");
    expect(screen.getByText("-215.40")).toHaveClass("text-destructive");
    expect(screen.getByText("1,830.00")).toHaveClass("text-success");
    expect(screen.getByText("42,310.00")).not.toHaveClass("text-success");
  });

  it("shows — for a day P/L nobody knows, never 0.00", () => {
    renderTotals(build([{ c: "USD", d: null, v: 100, p: 5 }]));
    expect(screen.getByTestId("header-totals-USD")).toHaveTextContent("—");
    expect(screen.getByTestId("header-totals-USD")).not.toHaveTextContent("0.00 ·");
  });

  it("marks a partial sum with an asterisk", () => {
    renderTotals(build([{ c: "USD", d: 10, v: 1, p: 1 }, { c: "USD", d: null, v: 1, p: 1 }]));
    expect(screen.getByTestId("header-totals-USD")).toHaveTextContent("10.00*");
  });

  it("writes one line per currency", () => {
    renderTotals(build([{ c: "USD", d: 1, v: 1, p: 1 }, { c: "EUR", d: 2, v: 2, p: 2 }]));
    expect(screen.getByTestId("header-totals-EUR")).toBeInTheDocument();
    expect(screen.getByTestId("header-totals-USD")).toBeInTheDocument();
  });

  it("renders nothing without a line", () => {
    const { container } = renderTotals(build([]));
    expect(container).toBeEmptyDOMElement();
  });
});
