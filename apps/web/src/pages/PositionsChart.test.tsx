/**
 * Prototype (branche `prototype-graphes`) : one chart at a time, injected under the line it
 * belongs to. Lightweight Charts is stubbed - jsdom has no 2D canvas context (vitest.setup.ts
 * returns null on purpose), so the real library cannot draw here; what this file fixes is the
 * behaviour of the table, not what the canvas ends up holding.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import i18n from "@/i18n";
import { db } from "@/db/schema";
import { PositionsPage } from "@/pages/PositionsPage";
import { WithAccountData } from "@/test/WithAccountData";
import { SAMPLE_SNAPSHOT } from "@/mocks/positions";

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
      timeScale: vi.fn(() => ({ fitContent: vi.fn(), timeToCoordinate: vi.fn(() => 10) })),
      remove: vi.fn(),
    })),
  };
});

function renderPositions(accountId = "alpha") {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[`/accounts/${accountId}/positions`]}>
        <Routes>
          <Route
            path="/accounts/:accountId/positions"
            element={
              <WithAccountData>
                <PositionsPage />
              </WithAccountData>
            }
          />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

const rowFor = async (description: string) =>
  (await screen.findByText(description)).closest("tr") as HTMLTableRowElement;

beforeEach(async () => {
  window.localStorage.clear();
  await Promise.all([db.snapshots.clear(), db.sectors.clear(), db.transactions.clear(), db.cashPoints.clear()]);
  await db.snapshots.put(SAMPLE_SNAPSHOT);
});

describe("the chart row of the Positions page", () => {
  it("opens under the clicked line and closes when it is clicked again", async () => {
    const user = userEvent.setup();
    renderPositions();
    const row = await rowFor("XOM Mar20'26 100 Put");

    await user.click(row);
    const chart = await screen.findByTestId("position-chart-row");
    expect(row.nextElementSibling).toBe(chart);
    expect(row).toHaveAttribute("data-state", "selected");

    await user.click(row);
    await waitFor(() => expect(screen.queryByTestId("position-chart-row")).not.toBeInTheDocument());
    expect(row).not.toHaveAttribute("data-state", "selected");
  });

  it("keeps a single chart open across every card of the page", async () => {
    const user = userEvent.setup();
    renderPositions();
    const put = await rowFor("XOM Mar20'26 100 Put");
    const stock = await rowFor("AAPL");

    await user.click(put);
    await screen.findByTestId("position-chart-row");
    await user.click(stock);

    await waitFor(() => expect(screen.getAllByTestId("position-chart-row")).toHaveLength(1));
    expect(stock.nextElementSibling).toBe(screen.getByTestId("position-chart-row"));
  });

  it("spans the whole table, so the chart is not squeezed into one column", async () => {
    const user = userEvent.setup();
    renderPositions();
    await user.click(await rowFor("XOM Mar20'26 100 Put"));

    const cell = (await screen.findByTestId("position-chart-row")).querySelector("td");
    expect(cell).toHaveAttribute("colspan", "12");
  });

  it("says so when the bars are a stand-in, TWS being out of reach", async () => {
    const user = userEvent.setup();
    renderPositions();
    await user.click(await rowFor("XOM Mar20'26 100 Put"));

    expect(await screen.findByText("Données de démonstration")).toBeInTheDocument();
    expect(screen.getByTestId("price-chart")).toBeInTheDocument();
  });
});
