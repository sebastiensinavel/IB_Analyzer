/**
 * Same patron as `PositionsChart.test.tsx`, on the two encarts of a strategy page: `LinesBox`
 * (option sells) and `SharesBox` (the Wheel's assigned shares), which do not share a box
 * identifier, so the same contract could in principle appear under both without colliding.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import type { Transaction } from "@ib/ledger";
import i18n from "@/i18n";
import { db, type SnapshotRecord } from "@/db/schema";
import { StrategyPositionsPage, type PositionsStrategy } from "@/pages/StrategyPositionsPage";
import { WithAccountData } from "@/test/WithAccountData";
import { SAMPLE_JOURNAL_SNAPSHOT, SAMPLE_JOURNAL_TRANSACTIONS } from "@/mocks/journals";

vi.mock("lightweight-charts", () => {
  const series = {
    setData: vi.fn(),
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

function renderStrategy(strategy: PositionsStrategy) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[`/accounts/beta/positions/${strategy}`]}>
        <Routes>
          <Route
            path="/accounts/:accountId/positions/:strategy"
            element={
              <WithAccountData>
                <StrategyPositionsPage strategy={strategy} />
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

/** An XOM 110 put sold on 2026-08-10, absent from the snapshot below. */
const XOM_PUT: Transaction = {
  ...SAMPLE_JOURNAL_TRANSACTIONS[0],
  externalId: "flex:trade:402",
  symbol: "XOM   261016P00110000",
  strike: 110,
  expiry: "2026-10-16",
  quantity: -1,
  price: 1.2,
  amount: 120,
  when: "2026-08-10T14:30:00.000Z",
};

const [maraShares, zzzLeaps, zzzCall, aapl] = SAMPLE_JOURNAL_SNAPSHOT.positions;

/** The sample snapshot, priced, with the MQZA assigned shares and its option sells. */
const SNAPSHOT: SnapshotRecord = {
  ...SAMPLE_JOURNAL_SNAPSHOT,
  positions: [
    { ...maraShares, marketPrice: 18, marketValue: 3600 },
    { ...zzzLeaps, marketPrice: 4, marketValue: 400 },
    { ...zzzCall, marketPrice: 0.25, marketValue: -25 },
    aapl,
  ],
};

beforeEach(async () => {
  window.localStorage.clear();
  await Promise.all([db.transactions.clear(), db.snapshots.clear(), db.sectors.clear(), db.contracts.clear()]);
  await db.accounts.put({ id: "beta", label: "beta", ibAccountId: "U0000002", createdAt: "", warnedDroppedKinds: [] });
  await db.transactions.bulkAdd([...SAMPLE_JOURNAL_TRANSACTIONS, XOM_PUT]);
  await db.snapshots.put(SNAPSHOT);
});

describe("the chart row of the strategy pages", () => {
  it("ouvre le graphe sous une vente d'options de la stratégie", async () => {
    const user = userEvent.setup();
    renderStrategy("wheel");
    const row = await rowFor("XOM Oct16'26 110 Put");

    await user.click(row);

    expect(row.nextElementSibling).toBe(await screen.findByTestId("position-chart-row"));
  });

  it("ouvre le graphe sous une ligne d'actions assignées, sur onze colonnes", async () => {
    const user = userEvent.setup();
    renderStrategy("wheel");
    const row = await rowFor("MQZA");

    await user.click(row);

    const cell = (await screen.findByTestId("position-chart-row")).querySelector("td");
    expect(cell).toHaveAttribute("colspan", "11");
  });

  it("ferme le graphe d'un encart quand on clique une ligne d'un autre", async () => {
    const user = userEvent.setup();
    renderStrategy("wheel");

    await user.click(await rowFor("MQZA"));
    await screen.findByTestId("position-chart-row");
    await user.click(await rowFor("XOM Oct16'26 110 Put"));

    expect(screen.getAllByTestId("position-chart-row")).toHaveLength(1);
  });
});
