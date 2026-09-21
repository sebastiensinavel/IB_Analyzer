import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import i18n from "@/i18n";
import { db } from "@/db/schema";
import * as agent from "@/agent/client";
import { PositionChartRow } from "@/components/PositionChartRow";
import { WithAccountData } from "@/test/WithAccountData";

vi.mock("lightweight-charts", () => {
  const series = {
    setData: vi.fn(),
    attachPrimitive: vi.fn(),
    detachPrimitive: vi.fn(),
    priceToCoordinate: vi.fn(() => 10),
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

function renderRow() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={["/accounts/alpha/positions"]}>
        <Routes>
          <Route
            path="/accounts/:accountId/positions"
            element={
              <WithAccountData>
                <table>
                  <tbody>
                    <PositionChartRow ticker="BTDR" strategies={["wheel"]} columnCount={12} />
                  </tbody>
                </table>
              </WithAccountData>
            }
          />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

const BARS = [{ date: "2026-09-21", open: 13, high: 14, low: 12, close: 13.5, volume: 1 }];

beforeEach(async () => {
  vi.restoreAllMocks();
  await db.accounts.put({
    id: "alpha",
    label: "alpha",
    ibAccountId: "U0000001",
    createdAt: "",
    warnedDroppedKinds: [],
  });
});

describe("PositionChartRow", () => {
  it("dit d'installer l'agent quand le compte n'a pas de port TWS", async () => {
    renderRow();

    expect(await screen.findByText("Ce graphe demande l'agent local")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Comment l'installer" })).toHaveAttribute("href", "/help");
  });

  it("dit que TWS ne répond pas quand l'agent rend 503", async () => {
    await db.accounts.update("alpha", { twsPort: 7501 });
    vi.spyOn(agent, "fetchBars").mockResolvedValue({ ok: false, code: "tws-unreachable" });

    renderRow();

    expect(await screen.findByText("TWS ne répond pas sur le port 7501")).toBeInTheDocument();
  });

  it("dit qu'IB ne rend aucun historique quand la réponse est vide", async () => {
    await db.accounts.update("alpha", { twsPort: 7501 });
    vi.spyOn(agent, "fetchBars").mockResolvedValue({
      ok: true,
      payload: { symbol: "BTDR", fetchedAt: "2026-09-21T20:00:00Z", bars: [] },
    });

    renderRow();

    expect(await screen.findByText("Interactive Brokers ne rend aucun historique pour BTDR")).toBeInTheDocument();
  });

  it("dessine le graphe quand les barres arrivent", async () => {
    await db.accounts.update("alpha", { twsPort: 7501 });
    vi.spyOn(agent, "fetchBars").mockResolvedValue({
      ok: true,
      payload: { symbol: "BTDR", fetchedAt: "2026-09-21T20:00:00Z", bars: BARS },
    });

    renderRow();

    expect(await screen.findByTestId("price-chart")).toBeInTheDocument();
    expect(screen.queryByText(/agent local/)).not.toBeInTheDocument();
  });

  it("occupe toute la largeur de la table", async () => {
    renderRow();

    const cell = (await screen.findByTestId("position-chart-row")).querySelector("td");
    expect(cell).toHaveAttribute("colspan", "12");
  });
});
