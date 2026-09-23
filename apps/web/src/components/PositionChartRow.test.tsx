import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import { createChart } from "lightweight-charts";
import { ACTIVABLE_STRATEGIES, type ChartLevel, type Strategy } from "@ib/ledger";
import i18n from "@/i18n";
import { db } from "@/db/schema";
import * as agent from "@/agent/client";
import { PositionChartRow } from "@/components/PositionChartRow";
import { CHART_MARGIN_DAYS } from "@/lib/levelsPrimitive";
import { WithAccountData } from "@/test/WithAccountData";
import { SAMPLE_JOURNAL_SNAPSHOT, SAMPLE_JOURNAL_TRANSACTIONS } from "@/mocks/journals";

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
      timeScale: vi.fn(() => ({ setVisibleLogicalRange: vi.fn(), timeToCoordinate: vi.fn(() => 10) })),
      remove: vi.fn(),
    })),
  };
});

function renderRow(
  overrides: {
    accountId?: string;
    ticker?: string;
    strategies?: readonly Strategy[];
    columnCount?: number;
    currency?: string;
  } = {},
) {
  const { accountId = "alpha", ticker = "BTDR", strategies = ["wheel"], columnCount = 12, currency } = overrides;
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[`/accounts/${accountId}/positions`]}>
        <Routes>
          <Route
            path="/accounts/:accountId/positions"
            element={
              <WithAccountData>
                <table>
                  <tbody>
                    <PositionChartRow ticker={ticker} strategies={strategies} columnCount={columnCount} currency={currency} />
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

/** La plage logique posée sur le dernier graphe : ce que l'axe du temps montre vraiment. */
async function lastVisibleRange(): Promise<{ from: number; to: number }> {
  await screen.findByTestId("price-chart");
  const chart = vi.mocked(createChart).mock.results.at(-1)!.value;
  const timeScale = chart.timeScale.mock.results.at(-1)!.value;
  return timeScale.setVisibleLogicalRange.mock.calls.at(-1)![0];
}

/** Les niveaux passés à la dernière primitive attachée : ce que `PriceChart` a reçu à dessiner. */
async function lastDrawnLevels(): Promise<ChartLevel[]> {
  await screen.findByTestId("price-chart");
  const chart = vi.mocked(createChart).mock.results.at(-1)!.value;
  const series = chart.addSeries.mock.results.at(-1)!.value;
  const primitive = series.attachPrimitive.mock.calls.at(-1)![0] as unknown as { drawn: { level: ChartLevel }[] };
  return primitive.drawn.map((d) => d.level);
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([db.transactions.clear(), db.snapshots.clear(), db.contracts.clear()]);
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

  it("pousse l'axe au-delà de la dernière barre, marge des deux côtés", async () => {
    await db.accounts.update("alpha", { twsPort: 7501 });
    vi.spyOn(agent, "fetchBars").mockResolvedValue({
      ok: true,
      payload: { symbol: "BTDR", fetchedAt: "2026-09-21T20:00:00Z", bars: BARS },
    });

    renderRow();

    // Une seule barre, donc l'indice 0 : le bord droit doit tomber `CHART_MARGIN_DAYS` créneaux
    // plus loin, et le gauche autant avant. `fitContent` recollerait le bord droit sur la barre.
    expect(await lastVisibleRange()).toEqual({ from: -CHART_MARGIN_DAYS, to: CHART_MARGIN_DAYS });
  });

  it("occupe toute la largeur de la table", async () => {
    renderRow();

    const cell = (await screen.findByTestId("position-chart-row")).querySelector("td");
    expect(cell).toHaveAttribute("colspan", "12");
  });

  it("dit que l'agent a répondu une erreur, sans renvoyer vers la page Aide", async () => {
    await db.accounts.update("alpha", { twsPort: 7501 });
    vi.spyOn(agent, "fetchBars").mockResolvedValue({ ok: false, code: "agent-error" });

    renderRow();

    expect(await screen.findByText("L'agent local a répondu une erreur")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Comment l'installer" })).not.toBeInTheDocument();
  });

  it("transmet le port, le ticker et la devise à fetchBars", async () => {
    await db.accounts.update("alpha", { twsPort: 7501 });
    const fetchBars = vi.spyOn(agent, "fetchBars").mockResolvedValue({
      ok: true,
      payload: { symbol: "SAP", fetchedAt: "2026-09-21T20:00:00Z", bars: BARS },
    });

    renderRow({ ticker: "SAP", currency: "EUR" });

    await screen.findByTestId("price-chart");
    expect(fetchBars).toHaveBeenCalledWith(7501, "SAP", "EUR");
  });

  it("ouvre avec les niveaux de sa portée, jamais ceux d'une autre stratégie", async () => {
    // ZZZ porte un achat LEAPS et un call vendu dessus (stratégie leaps), rien pour la Wheel.
    await db.accounts.put({
      id: "beta",
      label: "beta",
      ibAccountId: "U0000002",
      createdAt: "",
      warnedDroppedKinds: [],
      twsPort: 7501,
    });
    await db.transactions.bulkAdd(SAMPLE_JOURNAL_TRANSACTIONS);
    await db.snapshots.put(SAMPLE_JOURNAL_SNAPSHOT);
    vi.spyOn(agent, "fetchBars").mockResolvedValue({
      ok: true,
      payload: { symbol: "ZZZ", fetchedAt: "2026-09-21T20:00:00Z", bars: BARS },
    });

    renderRow({ accountId: "beta", ticker: "ZZZ", strategies: ["wheel"] });

    expect(await lastDrawnLevels()).toEqual([]);
  });

  it("porte bien les niveaux de la stratégie demandée quand elle en a", async () => {
    await db.accounts.put({
      id: "beta",
      label: "beta",
      ibAccountId: "U0000002",
      createdAt: "",
      warnedDroppedKinds: [],
      twsPort: 7501,
      strategies: [...ACTIVABLE_STRATEGIES],
    });
    await db.transactions.bulkAdd(SAMPLE_JOURNAL_TRANSACTIONS);
    await db.snapshots.put(SAMPLE_JOURNAL_SNAPSHOT);
    vi.spyOn(agent, "fetchBars").mockResolvedValue({
      ok: true,
      payload: { symbol: "ZZZ", fetchedAt: "2026-09-21T20:00:00Z", bars: BARS },
    });

    renderRow({ accountId: "beta", ticker: "ZZZ", strategies: ["leaps"] });

    const kinds = (await lastDrawnLevels()).map((level) => level.kind).sort();
    expect(kinds).toEqual(["leapsBuy", "shortCall"]);
  });

  it("demande son substitut pour un ticker qu'IB ne sert pas, et dit lequel il montre", async () => {
    await db.accounts.update("alpha", { twsPort: 7501 });
    const fetchBars = vi.spyOn(agent, "fetchBars").mockResolvedValue({
      ok: true,
      payload: { symbol: "SPY", fetchedAt: "2026-09-21T20:00:00Z", bars: BARS },
    });

    renderRow({ ticker: "XSP" });

    await screen.findByTestId("price-chart");
    expect(fetchBars).toHaveBeenCalledWith(7501, "SPY", undefined);
    expect(
      screen.getByText("Cours de SPY : Interactive Brokers ne cote pas XSP. Les niveaux restent aux prix de XSP."),
    ).toBeInTheDocument();
  });

  it("ne dit rien de substitut quand IB sert le ticker lui-même", async () => {
    await db.accounts.update("alpha", { twsPort: 7501 });
    vi.spyOn(agent, "fetchBars").mockResolvedValue({
      ok: true,
      payload: { symbol: "BTDR", fetchedAt: "2026-09-21T20:00:00Z", bars: BARS },
    });

    renderRow();

    await screen.findByTestId("price-chart");
    expect(screen.queryByText(/Cours de/)).not.toBeInTheDocument();
  });

  it("nomme le ticker réellement demandé quand même le substitut ne rend rien", async () => {
    await db.accounts.update("alpha", { twsPort: 7501 });
    vi.spyOn(agent, "fetchBars").mockResolvedValue({
      ok: true,
      payload: { symbol: "SPY", fetchedAt: "2026-09-21T20:00:00Z", bars: [] },
    });

    renderRow({ ticker: "XSP" });

    expect(await screen.findByText("Interactive Brokers ne rend aucun historique pour SPY")).toBeInTheDocument();
  });

  it("garde les niveaux du vrai sous-jacent, jamais ceux du substitut", async () => {
    await db.accounts.put({
      id: "beta",
      label: "beta",
      ibAccountId: "U0000002",
      createdAt: "",
      warnedDroppedKinds: [],
      twsPort: 7501,
    });
    // Un put XSP vendu, toujours ouvert : la Wheel lui doit un niveau. Demandés sur "SPY", les
    // journaux n'en rendraient aucun.
    await db.transactions.add({
      accountId: "beta", externalId: "flex:trade:901", source: "flex", kind: "trade",
      symbol: "XSP   261016P00650000", secType: "OPT", right: "P", strike: 650, expiry: "2026-10-16",
      quantity: -1, price: 1, amount: 100, commission: -1, currency: "USD",
      when: "2026-08-03T14:30:00.000Z", description: "XSP 16OCT26 650 P",
    });
    vi.spyOn(agent, "fetchBars").mockResolvedValue({
      ok: true,
      payload: { symbol: "SPY", fetchedAt: "2026-09-21T20:00:00Z", bars: BARS },
    });

    renderRow({ accountId: "beta", ticker: "XSP", strategies: ["wheel"] });

    expect((await lastDrawnLevels()).map((level) => level.kind)).toEqual(["shortPut"]);
  });
});
