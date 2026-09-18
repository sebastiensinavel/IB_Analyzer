import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import type { Position, Transaction } from "@ib/ledger";
import i18n from "@/i18n";
import { db, type SnapshotRecord } from "@/db/schema";
import { StrategyPositionsPage, type PositionsStrategy } from "@/pages/StrategyPositionsPage";
import { WithAccountData } from "@/test/WithAccountData";
import { DEMO_TRANSACTIONS, SAMPLE_JOURNAL_SNAPSHOT, SAMPLE_JOURNAL_TRANSACTIONS } from "@/mocks/journals";

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
  window.localStorage.clear();
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
    expect(texts(call)).toEqual(["MQZA Oct16'26 15 Call", "sell of call", "", "-$100.00", "-1", "0.80", "1.00", "—", "—", "-$20.00", "keep", "stock ×1"]);
    const put = await rowIn("Ventes d'options", "XOM Oct16'26 110 Put");
    expect(texts(put)).toEqual(["XOM Oct16'26 110 Put", "sell of put", "", "—", "-1", "1.20", "—", "—", "—", "—", "", ""]);
    // The LEAPS call is not the Wheel's.
    expect(within(screen.getByLabelText("Ventes d'options")).queryByText("ZZZ Sep18'26 20 Call")).not.toBeInTheDocument();
  });

  it("shows no box at all, and says so once, when the Wheel holds nothing open", async () => {
    renderPage("wheel");
    expect(await screen.findByText("Aucune position ne correspond.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Actions assignées")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Ventes d'options")).not.toBeInTheDocument();
  });
});

describe("StrategyPositionsPage — LEAPS", () => {
  it("lists the LEAPS bought and the calls sold against them, without a Shares card when none is held", async () => {
    await seed();
    renderPage("leaps");
    expect(await screen.findByText("Positions LEAPS")).toBeInTheDocument();
    const leaps = await rowIn("Achats d'options", "ZZZ Jun18'27 15 Call");
    expect(texts(leaps)).toEqual(["ZZZ Jun18'27 15 Call", "buy of call", "", "$400.00", "1", "3.00", "4.00", "—", "—", "$100.00", "", "used 1/1"]);
    const call = await rowIn("Ventes d'options", "ZZZ Sep18'26 20 Call");
    expect(texts(call)).toEqual(["ZZZ Sep18'26 20 Call", "sell of call", "", "-$25.00", "-1", "0.50", "0.25", "—", "—", "$25.00", "buy back", "leaps ×1"]);
    expect(screen.queryByLabelText("Actions")).not.toBeInTheDocument();
  });
});

/** A second MQZA 15 call, sold while the 200 assigned shares still covered two. */
const MARA_CALL_2: Transaction = { ...MARA_CALL, externalId: "flex:trade:403", price: 0.6, amount: 60, when: "2026-08-26T14:30:00.000Z" };

/** 100 of the 200 assigned shares sold afterwards: one of the two calls loses its cover. */
const MARA_SHARES_SOLD: Transaction = {
  ...MARA_CALL,
  externalId: "flex:trade:404",
  symbol: "MQZA",
  secType: "STK",
  right: "",
  strike: null,
  expiry: null,
  quantity: -100,
  price: 18,
  amount: 1800,
  when: "2026-08-27T14:30:00.000Z",
};

/** What IB holds then: 100 shares and the two calls, one of which nothing covers. */
const NAKED_SNAPSHOT: SnapshotRecord = {
  ...SAMPLE_JOURNAL_SNAPSHOT,
  positions: [
    { ...maraShares, quantity: 100, marketPrice: 18, marketValue: 1800 },
    { ...zzzLeaps, marketPrice: 4, marketValue: 400 },
    { ...zzzCall, marketPrice: 0.25, marketValue: -25 },
    aapl,
    { ...zzzLeaps, symbol: "MQZA", strike: 15, expiry: "2026-10-16", quantity: -2, marketPrice: 1, marketValue: -200, description: "MQZA 16OCT26 15 C" },
  ],
};

async function seedNaked() {
  await db.transactions.bulkAdd([...SAMPLE_JOURNAL_TRANSACTIONS, MARA_CALL, MARA_CALL_2, MARA_SHARES_SOLD]);
  await db.snapshots.put(NAKED_SNAPSHOT);
}

describe("StrategyPositionsPage — a call that lost its cover", () => {
  it("shows the Wheel only the covered call, and its shares card says used 100/100", async () => {
    await seedNaked();
    renderPage("wheel");
    const call = await rowIn("Ventes d'options", "MQZA Oct16'26 15 Call");
    expect(texts(call)).toEqual(["MQZA Oct16'26 15 Call", "sell of call", "", "-$100.00", "-1", "0.70", "1.00", "—", "—", "-$30.00", "keep", "stock ×1"]);
    const held = await rowIn("Actions assignées", "MQZA");
    expect(texts(held)).toEqual(["MQZA", "", "100", "17.00", "15.00", "$1,700.00", "18.00", "$100.00", "used 100/100"]);
  });

  it("shows the naked contract on Others, without naming where it comes from", async () => {
    await seedNaked();
    renderPage("others");
    const call = await rowIn("Ventes d'options", "MQZA Oct16'26 15 Call");
    expect(texts(call)).toEqual(["MQZA Oct16'26 15 Call", "sell of call", "", "-$100.00", "-1", "0.70", "1.00", "—", "—", "-$30.00", "keep", "UNCOVERED ×1"]);
    expect(within(screen.getByLabelText("Ventes d'options")).queryByText("Wheel")).not.toBeInTheDocument();
  });
});

describe("StrategyPositionsPage — search, expiries and column filters", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("searches every box of the page on the ticker and drops the ones it empties", async () => {
    await seed();
    renderPage("wheel");
    await screen.findByLabelText("Actions assignées");
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Rechercher un ticker" }), "=XOM");
    await waitFor(() => expect(screen.queryByLabelText("Actions assignées")).not.toBeInTheDocument());
    expect(within(screen.getByLabelText("Ventes d'options")).getByText("XOM Oct16'26 110 Put")).toBeInTheDocument();
  });

  it("offers only the expiries of the strategy's own options", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-02T12:00:00.000Z") });
    try {
      await seed();
      renderPage("leaps");
      await screen.findByLabelText("Achats d'options");
      const bar = screen.getByRole("group", { name: "Filtrer par expiration" });
      // The Wheel's MQZA and XOM expiries are not the LEAPS': only ZZZ's two are offered.
      expect(within(bar).getAllByRole("button").map((button) => button.textContent)).toEqual(["Sep18'26", "Jun18'27"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("filters every box on the chosen expiry and drops the shares, which have none", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-02T12:00:00.000Z") });
    try {
      await seed();
      renderPage("wheel");
      await screen.findByLabelText("Actions assignées");
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(within(screen.getByRole("group", { name: "Filtrer par expiration" })).getByRole("button", { name: "Oct16'26" }));
      await waitFor(() => expect(screen.queryByLabelText("Actions assignées")).not.toBeInTheDocument());
      expect(within(screen.getByLabelText("Ventes d'options")).getByText("Position : Oct16'26")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a box its own column filter empties, with a way back", async () => {
    await seed();
    renderPage("wheel");
    const box = await screen.findByLabelText("Ventes d'options");
    const user = userEvent.setup();
    const header = within(box).getByRole("columnheader", { name: /^Qté/ });
    await user.click(within(header).getByRole("button", { name: /^Qté/ }));
    await user.type(await screen.findByRole("textbox", { name: "Critère pour Qté" }), ">1000");
    expect(await within(box).findByText("Aucune position ne correspond.")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(within(box).getByRole("button", { name: "Tout effacer" }));
    expect(await within(box).findByText("XOM Oct16'26 110 Put")).toBeInTheDocument();
  });

  it("sorts the assigned shares on their own columns", async () => {
    await seed();
    renderPage("wheel");
    const box = await screen.findByLabelText("Actions assignées");
    const user = userEvent.setup();
    const header = within(box).getByRole("columnheader", { name: /^Quantité/ });
    await user.click(within(header).getByRole("button", { name: /^Quantité/ }));
    expect(await screen.findByRole("button", { name: "Croissant" })).toBeInTheDocument();
  });

  it("remembers each box's view under its own key, per account and per strategy", async () => {
    await seed();
    window.localStorage.setItem(
      "ib2:tableView:beta:positions:wheel:optionSells",
      JSON.stringify({ v: 1, sort: [], criteria: { position: "XOM" } }),
    );
    renderPage("wheel");
    const box = await screen.findByLabelText("Ventes d'options");
    expect(within(box).getByText("XOM Oct16'26 110 Put")).toBeInTheDocument();
    expect(within(box).queryByText("MQZA Oct16'26 15 Call")).not.toBeInTheDocument();
  });
});

/** A TSLA call sold on nothing at all: the Others journal's naked part. */
const TSLA_CALL: Transaction = {
  ...SAMPLE_JOURNAL_TRANSACTIONS[0],
  externalId: "flex:trade:403",
  symbol: "TSLA  261016C00300000",
  right: "C",
  strike: 300,
  expiry: "2026-10-16",
  quantity: -1,
  price: 1,
  amount: 100,
  when: "2026-08-04T14:30:00.000Z",
};

/**
 * The open QQQ condor of the demo ledger, priced. All four legs, because this reproduces the
 * real condor of the demo ledger, not because the engine requires them: `pairLegs`
 * (`packages/coverage/src/coverage.ts`) already pairs a single short leg with a single long leg
 * into a `call spread` or `put spread`, and only calls the pair an `iron condor` once both sides
 * of the same expiry are paired.
 */
const QQQ_LEG = { ...aapl, symbol: "QQQ", secType: "OPT" as const, multiplier: 100, expiry: "2026-10-16" };
const QQQ_POSITIONS: Position[] = [
  { ...QQQ_LEG, right: "P", strike: 480, quantity: 1, marketPrice: 0.1, marketValue: 10, description: "QQQ 16OCT26 480 P" },
  { ...QQQ_LEG, right: "P", strike: 485, quantity: -1, marketPrice: 0.3, marketValue: -30, description: "QQQ 16OCT26 485 P" },
  { ...QQQ_LEG, right: "C", strike: 520, quantity: -1, marketPrice: 0.2, marketValue: -20, description: "QQQ 16OCT26 520 C" },
  { ...QQQ_LEG, right: "C", strike: 525, quantity: 1, marketPrice: 0.1, marketValue: 10, description: "QQQ 16OCT26 525 C" },
];

async function seedCondor() {
  await db.transactions.bulkAdd([...SAMPLE_JOURNAL_TRANSACTIONS, ...DEMO_TRANSACTIONS]);
  await db.snapshots.put({ ...SNAPSHOT, positions: [...SNAPSHOT.positions, ...QQQ_POSITIONS] });
}

describe("StrategyPositionsPage — Condors", () => {
  it("reads an open condor on its legs, wings bought and body sold, and prices what the snapshot holds", async () => {
    await seedCondor();
    renderPage("condors");
    expect(await screen.findByText("Positions Condors")).toBeInTheDocument();
    const wing = await rowIn("Achats d'options", "QQQ Oct16'26 480 Put");
    expect(texts(wing).slice(0, 7)).toEqual(["QQQ Oct16'26 480 Put", "buy of put", "", "$10.00", "1", "0.25", "0.10"]);
    const sold = await rowIn("Ventes d'options", "QQQ Oct16'26 485 Put");
    expect(texts(sold)[1]).toBe("sell of put");
    expect(within(sold).getByText(/spread/)).toBeInTheDocument();
    // Never the composite: a condor is its legs.
    expect(screen.queryByText(/IC 480/)).not.toBeInTheDocument();
  });
});

describe("StrategyPositionsPage — Others", () => {
  it("groups what fits nowhere else like the overview does, and marks a naked sale UNCOVERED", async () => {
    await db.transactions.bulkAdd([...SAMPLE_JOURNAL_TRANSACTIONS, TSLA_CALL]);
    await db.snapshots.put(SNAPSHOT);
    renderPage("others");
    expect(await screen.findByText("Positions Autres")).toBeInTheDocument();
    expect(within(await screen.findByLabelText("Positions longues")).getByText("AAPL")).toBeInTheDocument();
    const naked = await rowIn("Ventes d'options", "TSLA Oct16'26 300 Call");
    expect(within(naked).getByText("UNCOVERED ×1")).toBeInTheDocument();
  });

  it("shows no cash on a strategy page", async () => {
    await db.transactions.bulkAdd(SAMPLE_JOURNAL_TRANSACTIONS);
    await db.snapshots.put(SNAPSHOT);
    renderPage("others");
    await screen.findByLabelText("Positions longues");
    expect(screen.queryByLabelText("Cash")).not.toBeInTheDocument();
  });
});
