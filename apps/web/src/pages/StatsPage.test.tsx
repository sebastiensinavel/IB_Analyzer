import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createRequire } from "node:module";
import type * as ECharts from "echarts";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import { ACTIVABLE_STRATEGIES, type StatsStrategy } from "@ib/ledger";
import i18n from "@/i18n";
import { db } from "@/db/schema";
import { StatsPage } from "@/pages/StatsPage";
import { WithAccountData } from "@/test/WithAccountData";
import { SAMPLE_JOURNAL_TRANSACTIONS } from "@/mocks/journals";

function renderStats(strategy: StatsStrategy) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[`/accounts/beta/stats/${strategy}`]}>
        <Routes>
          <Route
            path="/accounts/:accountId/stats/:strategy"
            element={
              <WithAccountData>
                <StatsPage strategy={strategy} />
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
  // Every strategy on: these tests read the LEAPS and the condors (the default is the Wheel alone).
  await db.accounts.put({ id: "beta", label: "beta", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [], strategies: [...ACTIVABLE_STRATEGIES] });
  await db.transactions.bulkAdd(SAMPLE_JOURNAL_TRANSACTIONS);
});

/** An XOM 110 put sold on 2026-08-10, still open: 11,000 of cash beside the 3,400 of MQZA shares assigned. */
const XOM_PUT = {
  ...SAMPLE_JOURNAL_TRANSACTIONS[0],
  externalId: "flex:trade:301",
  symbol: "XOM   261016P00110000",
  strike: 110,
  expiry: "2026-10-16",
  quantity: -1,
  price: 1.2,
  amount: 120,
  when: "2026-08-10T14:30:00.000Z",
};

const ENERGY = { ticker: "XOM", name: "Exxon Mobil", category: "Energy", score: null, status: "off", updatedAt: "2026-09-03T08:00:00.000Z" };

describe("StatsPage", () => {
  it("totals the Wheel in USD: two premiums netted, the shares not yet sold", async () => {
    renderStats("wheel");
    // Put 42 - 1, call 100 - 1, both expiries at 0: 140. The assigned shares count nothing until sold.
    const card = (await screen.findByText("Profit/Perte total")).closest("[data-slot=card]") as HTMLElement;
    expect(within(card).getByText("140.00 USD")).toBeInTheDocument();
    expect(screen.getByTestId("monthly-chart")).toBeInTheDocument();
    expect(screen.queryByLabelText("Devise")).not.toBeInTheDocument();
  });

  it("totals the LEAPS: the call bought counts nothing, the call sold counts its premium", async () => {
    renderStats("leaps");
    expect(await screen.findByText("49.00 USD")).toBeInTheDocument();
  });

  it("totals the condor: the whole credit, expired", async () => {
    renderStats("condors");
    expect(await screen.findByText("46.00 USD")).toBeInTheDocument();
  });

  it("says when there is nothing", async () => {
    await db.transactions.clear();
    renderStats("wheel");
    expect(await screen.findByText("Aucune donnée pour cette stratégie.")).toBeInTheDocument();
    expect(screen.queryByTestId("monthly-chart")).not.toBeInTheDocument();
  });

  it("offers a currency switch only when the strategy spans several", async () => {
    await db.transactions.bulkAdd([
      { ...SAMPLE_JOURNAL_TRANSACTIONS[0], externalId: "flex:trade:201", symbol: "SAP   261002P00017000", currency: "EUR", amount: 30 },
    ]);
    renderStats("wheel");
    expect(await screen.findByLabelText("Devise")).toBeInTheDocument();
    expect(screen.getByText("29.00 EUR")).toBeInTheDocument();
  });

  it("draws the Wheel's money in the currency displayed, never in another", async () => {
    // A SAP 150 put sold in EUR, still open: 15,000 of put cash. EUR sorts before USD, so it is displayed.
    await db.transactions.add({ ...SAMPLE_JOURNAL_TRANSACTIONS[0], externalId: "flex:trade:303", symbol: "SAP   261002P00150000", strike: 150, quantity: -1, price: 0.3, amount: 30, currency: "EUR" });
    renderStats("wheel");
    expect(await screen.findByText("29.00 EUR")).toBeInTheDocument();
    const card = screen.getByText("Exposition par secteur").closest("[data-slot=card]") as HTMLElement;
    const unclassified = within(card).getByRole("row", { name: /Non classé/ });
    expect(within(unclassified).getAllByText("15,000.00")).toHaveLength(2);
    expect(within(unclassified).getByText("100.0%")).toBeInTheDocument();
    // The USD Wheel's 3,400 of MQZA shares belong to the other currency.
    expect(within(card).queryByText("3,400.00")).not.toBeInTheDocument();
  });

  it("shows the Wheel's exposure by sector, a ticker the table does not know unclassified", async () => {
    await db.transactions.add(XOM_PUT);
    await db.sectors.add(ENERGY);
    renderStats("wheel");
    const card = (await screen.findByText("Exposition par secteur")).closest("[data-slot=card]") as HTMLElement;
    expect(within(card).getByTestId("exposure-chart")).toBeInTheDocument();
    // 11,000 of XOM put cash and 3,400 of MQZA shares assigned: 14,400 in all.
    const energy = within(card).getByRole("row", { name: /Energy/ });
    expect(within(energy).getAllByText("11,000.00")).toHaveLength(2);
    expect(within(energy).getByText("76.4%")).toBeInTheDocument();
    const unclassified = within(card).getByRole("row", { name: /Non classé/ });
    expect(within(unclassified).getAllByText("3,400.00")).toHaveLength(2);
    expect(within(unclassified).getByText("23.6%")).toBeInTheDocument();
    expect(screen.getByText("Capital de la stratégie")).toBeInTheDocument();
    expect(screen.getByTestId("capital-chart")).toBeInTheDocument();
    expect(screen.getByText("Rendement mensuel")).toBeInTheDocument();
    expect(screen.getByTestId("return-chart")).toBeInTheDocument();
  });

  it("says the Wheel holds nothing once its shares are sold, the capital still drawn", async () => {
    await db.transactions.add({ ...SAMPLE_JOURNAL_TRANSACTIONS[2], externalId: "flex:trade:302", quantity: -200, price: 18, amount: 3600, commission: -1, when: "2026-08-25T15:00:00.000Z" });
    renderStats("wheel");
    expect(await screen.findByText("Aucune position Wheel ouverte.")).toBeInTheDocument();
    expect(screen.queryByTestId("exposure-chart")).not.toBeInTheDocument();
    expect(screen.getByTestId("capital-chart")).toBeInTheDocument();
  });

  it("shows the LEAPS' exposure at their purchase price, with only a total and a share, beside their capital and return", async () => {
    renderStats("leaps");
    const card = (await screen.findByText("Exposition par secteur")).closest("[data-slot=card]") as HTMLElement;
    expect(within(card).getByTestId("exposure-chart")).toBeInTheDocument();
    // One ZZZ LEAPS bought at 3: 300. The call sold against it counts nothing.
    const unclassified = within(card).getByRole("row", { name: /Non classé/ });
    expect(within(unclassified).getByText("300.00")).toBeInTheDocument();
    expect(within(unclassified).getByText("100.0%")).toBeInTheDocument();
    expect(within(card).queryByText("Assigné")).not.toBeInTheDocument();
    expect(within(card).queryByText("Couverture des puts")).not.toBeInTheDocument();
    expect(screen.getByText("Capital de la stratégie")).toBeInTheDocument();
    expect(screen.getByTestId("capital-chart")).toBeInTheDocument();
    expect(screen.getByText("Rendement mensuel")).toBeInTheDocument();
    expect(screen.getByTestId("return-chart")).toBeInTheDocument();
  });

  it("says the LEAPS hold nothing once the LEAPS is sold, the capital still drawn", async () => {
    await db.transactions.add({ ...SAMPLE_JOURNAL_TRANSACTIONS[5], externalId: "flex:trade:304", quantity: -1, price: 4, amount: 400, when: "2026-08-25T15:00:00.000Z" });
    renderStats("leaps");
    expect(await screen.findByText("Aucune position LEAPS ouverte.")).toBeInTheDocument();
    expect(screen.queryByTestId("exposure-chart")).not.toBeInTheDocument();
    expect(screen.getByTestId("capital-chart")).toBeInTheDocument();
  });

  it("keeps no line of the Wheel when the same page moves on to the condors", async () => {
    // The three statistics routes render one StatsPage at one place: React keeps it, and its
    // charts, from one strategy to the next.
    const view = (strategy: StatsStrategy) => (
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={["/accounts/beta/stats"]}>
          <Routes>
            <Route
              path="/accounts/:accountId/stats"
              element={
                <WithAccountData>
                  <StatsPage strategy={strategy} />
                </WithAccountData>
              }
            />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    );
    const { rerender } = render(view("wheel"));
    await screen.findByText("140.00 USD");
    // echarts-for-react requires the CommonJS build, whose instance registry an ESM import of
    // "echarts" does not share.
    const echarts = createRequire(import.meta.url)("echarts") as typeof ECharts;
    const lines = () => {
      const chart = echarts.getInstanceByDom(screen.getByTestId("capital-chart").firstElementChild as HTMLElement);
      if (!chart) throw new Error("the capital chart has no ECharts instance");
      // A series replaced away leaves a null in its place.
      return (chart.getOption().series as ({ name: string } | null)[]).flatMap((s) => (s ? [s.name] : []));
    };
    expect(lines()).toContain("Assigné");

    rerender(view("condors"));
    await screen.findByText("46.00 USD");
    expect(lines()).toEqual(["Cumul des profits/pertes", "Alloué", "Cash investi"]);
  });

  it("draws the condors' capital and return, and no exposure by sector", async () => {
    renderStats("condors");
    expect(await screen.findByText("46.00 USD")).toBeInTheDocument();
    expect(screen.getByTestId("monthly-chart")).toBeInTheDocument();
    expect(screen.getByTestId("capital-chart")).toBeInTheDocument();
    expect(screen.getByTestId("return-chart")).toBeInTheDocument();
    expect(screen.queryByText("Exposition par secteur")).not.toBeInTheDocument();
  });
});
