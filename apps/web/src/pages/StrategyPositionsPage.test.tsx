import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import type { Transaction } from "@ib/ledger";
import i18n from "@/i18n";
import { db, type SnapshotRecord } from "@/db/schema";
import { StrategyPositionsPage, type PositionsStrategy } from "@/pages/StrategyPositionsPage";
import { WithAccountData } from "@/test/WithAccountData";
import { SAMPLE_JOURNAL_SNAPSHOT, SAMPLE_JOURNAL_TRANSACTIONS } from "@/mocks/journals";

function renderPage(strategy: PositionsStrategy) {
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

/** A MQZA 15 call sold on the 200 Wheel shares assigned at 17: struck below the assignment price. */
const MARA_CALL: Transaction = {
  ...SAMPLE_JOURNAL_TRANSACTIONS[0],
  externalId: "flex:trade:401",
  symbol: "MQZA  261016C00015000",
  right: "C",
  strike: 15,
  expiry: "2026-10-16",
  quantity: -1,
  price: 0.8,
  amount: 80,
  when: "2026-08-25T14:30:00.000Z",
};

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

/** The sample snapshot, priced, with the MQZA call. */
const SNAPSHOT: SnapshotRecord = {
  ...SAMPLE_JOURNAL_SNAPSHOT,
  positions: [
    { ...maraShares, marketPrice: 18, marketValue: 3600 },
    { ...zzzLeaps, marketPrice: 4, marketValue: 400 },
    { ...zzzCall, marketPrice: 0.25, marketValue: -25 },
    aapl,
    { ...zzzLeaps, symbol: "MQZA", strike: 15, expiry: "2026-10-16", quantity: -1, marketPrice: 1, marketValue: -100, description: "MQZA 16OCT26 15 C" },
  ],
};

beforeEach(async () => {
  await Promise.all([db.transactions.clear(), db.snapshots.clear(), db.sectors.clear(), db.contracts.clear()]);
});

async function seed() {
  await db.transactions.bulkAdd([...SAMPLE_JOURNAL_TRANSACTIONS, MARA_CALL, XOM_PUT]);
  await db.snapshots.put(SNAPSHOT);
}

async function rowIn(card: string, text: string): Promise<HTMLElement> {
  const found = await within(await screen.findByLabelText(card)).findByText(text);
  return found.closest("tr") as HTMLElement;
}

function cells(row: HTMLElement): HTMLElement[] {
  return within(row).getAllByRole("cell");
}

function texts(row: HTMLElement): string[] {
  return cells(row).map((cell) => cell.textContent ?? "");
}

describe("StrategyPositionsPage — Wheel", () => {
  it("lists the assigned shares: assignment price, call strike in yellow below it, value and Wheel coverage", async () => {
    await seed();
    renderPage("wheel");
    expect(await screen.findByText("Positions Wheel")).toBeInTheDocument();
    const row = await rowIn("Actions assignées", "MQZA");
    expect(texts(row)).toEqual(["MQZA", "", "200", "17.00", "15.00", "$3,400.00", "18.00", "$200.00", "used 100/200"]);
    expect(cells(row)[4]).toHaveClass("bg-warning/25");
    expect(cells(row)[3]).not.toHaveClass("bg-warning/25");
  });

  it("lists the option sales: the Wheel's part priced from the snapshot, a line the snapshot lacks left blank", async () => {
    await seed();
    renderPage("wheel");
    const call = await rowIn("Ventes d'options", "MQZA Oct16'26 15 Call");
    expect(texts(call)).toEqual(["MQZA Oct16'26 15 Call", "sell of call", "", "-$100.00", "-1", "0.80", "1.00", "-$20.00", "keep", "stock ×1"]);
    const put = await rowIn("Ventes d'options", "XOM Oct16'26 110 Put");
    expect(texts(put)).toEqual(["XOM Oct16'26 110 Put", "sell of put", "", "—", "-1", "1.20", "—", "—", "", ""]);
    // The LEAPS call is not the Wheel's.
    expect(within(screen.getByLabelText("Ventes d'options")).queryByText("ZZZ Sep18'26 20 Call")).not.toBeInTheDocument();
  });

  it("says so in each card when the Wheel holds nothing open", async () => {
    renderPage("wheel");
    expect(await screen.findAllByText("Aucune position ouverte dans cette stratégie.")).toHaveLength(2);
  });
});

describe("StrategyPositionsPage — LEAPS", () => {
  it("lists the LEAPS bought and the calls sold against them, without a Shares card when none is held", async () => {
    await seed();
    renderPage("leaps");
    expect(await screen.findByText("Positions LEAPS")).toBeInTheDocument();
    const leaps = await rowIn("Achats d'options", "ZZZ Jun18'27 15 Call");
    expect(texts(leaps)).toEqual(["ZZZ Jun18'27 15 Call", "buy of call", "", "$400.00", "1", "3.00", "4.00", "$100.00", "", "used 1/1"]);
    const call = await rowIn("Ventes d'options", "ZZZ Sep18'26 20 Call");
    expect(texts(call)).toEqual(["ZZZ Sep18'26 20 Call", "sell of call", "", "-$25.00", "-1", "0.50", "0.25", "$25.00", "buy back", "leaps ×1"]);
    expect(screen.queryByLabelText("Actions")).not.toBeInTheDocument();
  });
});
