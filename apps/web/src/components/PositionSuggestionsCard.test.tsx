/**
 * The card's own chart, injected under its clicked ticker row: same patron as
 * `pages/PositionsChart.test.tsx`, rendered through `DashboardPage` since the card takes its
 * `report` as a prop from there rather than computing it itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import { mergeQuotes, resetQuotes } from "@/agent/quotes";
import i18n from "@/i18n";
import { db } from "@/db/schema";
import { DashboardPage } from "@/pages/DashboardPage";
import { WithAccountData } from "@/test/WithAccountData";

vi.mock("lightweight-charts", () => {
  const series = {
    setData: vi.fn(),
    createPriceLine: vi.fn(() => ({})),
    removePriceLine: vi.fn(),
    attachPrimitive: vi.fn(),
    detachPrimitive: vi.fn(),
  };
  return {
    CandlestickSeries: {},
    createChart: vi.fn(() => ({
      addSeries: vi.fn(() => series),
      timeScale: vi.fn(() => ({ setVisibleLogicalRange: vi.fn(), timeToCoordinate: vi.fn(() => 10) })),
      remove: vi.fn(),
    })),
  };
});

function renderSuggestions(accountId = "alpha") {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[`/accounts/${accountId}/dashboard`]}>
        <Routes>
          <Route
            path="/accounts/:accountId/dashboard"
            element={
              <WithAccountData>
                <DashboardPage />
              </WithAccountData>
            }
          />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  await Promise.all([db.transactions.clear(), db.snapshots.clear(), db.sectors.clear()]);
  await db.accounts.put({ id: "alpha", label: "alpha", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [] });
  await db.sectors.put({ ticker: "BTDR", name: "", category: "Crypto", score: 9, status: "on", updatedAt: "2026-09-03T08:00:00.000Z" });
});

describe("the chart row of the suggestion card", () => {
  it("ouvre le graphe du ticker suggéré sous sa ligne, sur sept colonnes", async () => {
    const user = userEvent.setup();
    renderSuggestions();
    const row = (await screen.findByText("BTDR")).closest("tr") as HTMLTableRowElement;

    await user.click(row);

    const cell = (await screen.findByTestId("position-chart-row")).querySelector("td");
    expect(cell).toHaveAttribute("colspan", "7");
  });

  it("ferme le graphe en cliquant à nouveau la même ligne", async () => {
    const user = userEvent.setup();
    renderSuggestions();
    const row = (await screen.findByText("BTDR")).closest("tr") as HTMLTableRowElement;

    await user.click(row);
    await screen.findByTestId("position-chart-row");
    await user.click(row);

    expect(screen.queryByTestId("position-chart-row")).not.toBeInTheDocument();
  });
});

describe("the Var. jour action column of the suggestion card", () => {
  afterEach(() => {
    resetQuotes();
  });

  it("shows the underlying's day move first, and keeps the rank order", async () => {
    // BTDR (score 9) ranks first, MSFT (score 7) second: both sector and ticker exposures are
    // 0 with no report positions, so the tie breaks on score alone.
    await db.sectors.put({ ticker: "MSFT", name: "", category: "Tech", score: 7, status: "on", updatedAt: "2026-09-03T08:00:00.000Z" });
    mergeQuotes(new Map([["BTDR", 0.01], ["MSFT", -0.05]]));
    renderSuggestions();

    const rows = (await screen.findAllByRole("row")).slice(1); // without the header row
    expect(within(rows[0]).getAllByRole("cell")[0]).toHaveTextContent("+1.0%");
    expect(within(rows[0]).getAllByRole("cell")[1]).toHaveTextContent("1"); // rank stays the second column
    expect(within(rows[1]).getAllByRole("cell")[0]).toHaveTextContent("-5.0%");
    expect(screen.getAllByRole("columnheader")[0]).toHaveTextContent("Var. jour action");
  });
});
