import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router";
import { ACTIVABLE_STRATEGIES, type Position, type Transaction } from "@ib/ledger";
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

/** A MQZA 20 call sold on the 200 Wheel shares assigned at 17: struck above the assignment price. */
const MARA_CALL_20: Transaction = { ...MARA_CALL, externalId: "flex:trade:405", symbol: "MQZA  261016C00020000", strike: 20 };

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
  // Every strategy on: these tests read the LEAPS and the condors (the default is the Wheel alone).
  await db.accounts.put({ id: "beta", label: "beta", ibAccountId: "U0000001", createdAt: "", warnedDroppedKinds: [], strategies: [...ACTIVABLE_STRATEGIES] });
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
    const free = await rowIn("Actions assignées sans call", "MQZA");
    expect(texts(free)).toEqual(["MQZA", "", "100", "17.00", "—", "$1,700.00", "18.00", "—", "—", "$100.00", "unused"]);
    const covered = await rowIn("Actions assignées, call < assignation", "MQZA");
    expect(texts(covered)).toEqual(["MQZA", "", "100", "17.00", "15.00", "$1,700.00", "18.00", "—", "—", "$100.00", "used 100/100"]);
    expect(cells(covered)[4]).toHaveClass("bg-warning/25");
    expect(cells(covered)[3]).not.toHaveClass("bg-warning/25");
    expect(screen.queryByLabelText("Actions assignées, call ≥ assignation")).not.toBeInTheDocument();
  });

  it("puts shares under a call struck above the assignment price in their own box", async () => {
    await db.transactions.bulkAdd([...SAMPLE_JOURNAL_TRANSACTIONS, MARA_CALL_20]);
    await db.snapshots.put({
      ...SNAPSHOT,
      positions: SNAPSHOT.positions.map((position) =>
        position === SNAPSHOT.positions[4] ? { ...position, strike: 20, description: "MQZA 16OCT26 20 C" } : position,
      ),
    });
    renderPage("wheel");
    const covered = await rowIn("Actions assignées, call ≥ assignation", "MQZA");
    expect(texts(covered)).toEqual(["MQZA", "", "100", "17.00", "20.00", "$1,700.00", "18.00", "—", "—", "$100.00", "used 100/100"]);
    expect(cells(covered)[4]).not.toHaveClass("bg-warning/25");
    expect(screen.queryByLabelText("Actions assignées, call < assignation")).not.toBeInTheDocument();
  });

  it("lists the box titles in checkpoint order, only the boxes with lines", async () => {
    await seed();
    const { container } = renderPage("wheel");
    await screen.findByLabelText("Actions assignées sans call");
    const titles = [...container.querySelectorAll("[data-slot=card]")].map((card) => card.getAttribute("aria-label"));
    expect(titles).toEqual(["Ventes de puts", "Actions assignées sans call", "Actions assignées, call < assignation", "Ventes de calls"]);
  });

  it("lists the option sales: the Wheel's part priced from the snapshot, a line the snapshot lacks left blank", async () => {
    await seed();
    renderPage("wheel");
    const call = await rowIn("Ventes de calls", "MQZA Oct16'26 15 Call");
    expect(texts(call)).toEqual(["MQZA Oct16'26 15 Call", "sell of call", "", "-$100.00", "-1", "0.80", "1.00", "—", "—", "-$20.00", "keep", "stock ×1"]);
    const put = await rowIn("Ventes de puts", "XOM Oct16'26 110 Put");
    expect(texts(put)).toEqual(["XOM Oct16'26 110 Put", "sell of put", "", "—", "-1", "1.20", "—", "—", "—", "—", "", ""]);
    // The LEAPS call is not the Wheel's.
    expect(within(screen.getByLabelText("Ventes de calls")).queryByText("ZZZ Sep18'26 20 Call")).not.toBeInTheDocument();
  });

  it("shows no box at all, and says so once, when the Wheel holds nothing open", async () => {
    renderPage("wheel");
    expect(await screen.findByText("Aucune position ne correspond.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Actions assignées sans call")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Actions assignées, call < assignation")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Actions assignées, call ≥ assignation")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Ventes de calls")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Ventes de puts")).not.toBeInTheDocument();
  });

  it("shows the day's move and P&L in their own cells, not just somewhere in the row", async () => {
    // The whole MQZA call belongs to the Wheel (quantity -1 on both sides), so its share is the
    // position's own dailyPnl/dayChange unprorated — a real, non-null, distinguishable pair.
    // SNAPSHOT.positions[4] is the MQZA call itself (index 2 is ZZZ's unrelated LEAPS call).
    await db.transactions.bulkAdd([...SAMPLE_JOURNAL_TRANSACTIONS, MARA_CALL, XOM_PUT]);
    await db.snapshots.put({
      ...SNAPSHOT,
      positions: SNAPSHOT.positions.map((position) =>
        position === SNAPSHOT.positions[4] ? { ...position, dailyPnl: -20, dayChange: 0.05 } : position,
      ),
    });
    renderPage("wheel");
    const call = await rowIn("Ventes de calls", "MQZA Oct16'26 15 Call");
    // dayChange is POSITION_COLUMNS[7], dailyPnl is [8]: a swap between the two would fail this.
    expect(cells(call)[7]).toHaveTextContent("+5.0%");
    expect(cells(call)[8]).toHaveTextContent("-$20.00");
  });

  it("prorates the assigned shares' day P&L to the Wheel's share of the position, day change unprorated", async () => {
    // 200 MQZA shares assigned, 100 of them sold off later: the Wheel still tracks 100, the snapshot
    // still reports the IB position at 200 — a real, non-null, distinguishable pair (1% / $20, not
    // $20 twice over): dailyPnl 40 × 100/200 = 20, dayChange 0.01 carried unprorated. The whole
    // position is covered by the one remaining call, so it lands in the covered box.
    await db.transactions.bulkAdd([...SAMPLE_JOURNAL_TRANSACTIONS, MARA_CALL, MARA_SHARES_SOLD]);
    await db.snapshots.put({
      ...SNAPSHOT,
      positions: SNAPSHOT.positions.map((position) => (position === SNAPSHOT.positions[0] ? { ...position, dailyPnl: 40, dayChange: 0.01 } : position)),
    });
    renderPage("wheel");
    const row = await rowIn("Actions assignées, call < assignation", "MQZA");
    // dayChange is WHEEL_SHARE_COLUMNS[7], dailyPnl is [8]: a swap between the two would fail this.
    expect(cells(row)[7]).toHaveTextContent("+1.0%");
    expect(cells(row)[8]).toHaveTextContent("$20.00");
    expect(screen.queryByLabelText("Actions assignées sans call")).not.toBeInTheDocument();
  });
});

describe("StrategyPositionsPage — LEAPS", () => {
  it("lists the LEAPS bought and the calls sold against them, without a Shares card when none is held", async () => {
    await seed();
    renderPage("leaps");
    expect(await screen.findByText("Positions LEAPS")).toBeInTheDocument();
    const leaps = await rowIn("LEAPS avec call vendu", "ZZZ Jun18'27 15 Call");
    expect(texts(leaps)).toEqual(["ZZZ Jun18'27 15 Call", "buy of call", "", "$400.00", "1", "3.00", "4.00", "—", "—", "$100.00", "", "used 1/1"]);
    const call = await rowIn("Ventes de calls", "ZZZ Sep18'26 20 Call");
    expect(texts(call)).toEqual(["ZZZ Sep18'26 20 Call", "sell of call", "", "-$25.00", "-1", "0.50", "0.25", "—", "—", "$25.00", "buy back", "leaps ×1"]);
    expect(screen.queryByLabelText("Actions")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("LEAPS sans call vendu")).not.toBeInTheDocument();
  });

  it("splits two LEAPS into the one a call covers and the one it doesn't", async () => {
    // A second ZZZ LEAPS bought: two held, still only the one existing call sold against them.
    const ZZZ_LEAPS_2: Transaction = { ...SAMPLE_JOURNAL_TRANSACTIONS[5], externalId: "flex:trade:406", when: "2026-06-06T14:30:00.000Z" };
    await db.transactions.bulkAdd([...SAMPLE_JOURNAL_TRANSACTIONS, ZZZ_LEAPS_2]);
    await db.snapshots.put({
      ...SNAPSHOT,
      positions: SNAPSHOT.positions.map((position) => (position === SNAPSHOT.positions[1] ? { ...position, quantity: 2, marketValue: 800 } : position)),
    });
    const { container } = renderPage("leaps");
    const covered = await rowIn("LEAPS avec call vendu", "ZZZ Jun18'27 15 Call");
    expect(texts(covered)).toEqual(["ZZZ Jun18'27 15 Call", "buy of call", "", "$400.00", "1", "3.00", "4.00", "—", "—", "$100.00", "", "used 1/1"]);
    const uncovered = await rowIn("LEAPS sans call vendu", "ZZZ Jun18'27 15 Call");
    expect(texts(uncovered)).toEqual(["ZZZ Jun18'27 15 Call", "buy of call", "", "$400.00", "1", "3.00", "4.00", "—", "—", "$100.00", "", "unused"]);
    const titles = [...container.querySelectorAll("[data-slot=card]")].map((card) => card.getAttribute("aria-label"));
    expect(titles).toEqual(["LEAPS sans call vendu", "LEAPS avec call vendu", "Ventes de calls"]);
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
    const call = await rowIn("Ventes de calls", "MQZA Oct16'26 15 Call");
    expect(texts(call)).toEqual(["MQZA Oct16'26 15 Call", "sell of call", "", "-$100.00", "-1", "0.70", "1.00", "—", "—", "-$30.00", "keep", "stock ×1"]);
    const held = await rowIn("Actions assignées, call < assignation", "MQZA");
    expect(texts(held)).toEqual(["MQZA", "", "100", "17.00", "15.00", "$1,700.00", "18.00", "—", "—", "$100.00", "used 100/100"]);
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
    await screen.findByLabelText("Actions assignées sans call");
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Rechercher un ticker" }), "=XOM");
    await waitFor(() => expect(screen.queryByLabelText("Actions assignées sans call")).not.toBeInTheDocument());
    expect(within(screen.getByLabelText("Ventes de puts")).getByText("XOM Oct16'26 110 Put")).toBeInTheDocument();
  });

  it("offers only the expiries of the strategy's own options", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-02T12:00:00.000Z") });
    try {
      await seed();
      renderPage("leaps");
      await screen.findByLabelText("LEAPS avec call vendu");
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
      await screen.findByLabelText("Actions assignées sans call");
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(within(screen.getByRole("group", { name: "Filtrer par expiration" })).getByRole("button", { name: "Oct16'26" }));
      await waitFor(() => expect(screen.queryByLabelText("Actions assignées sans call")).not.toBeInTheDocument());
      expect(screen.queryByLabelText("Actions assignées, call < assignation")).not.toBeInTheDocument();
      expect(within(screen.getByLabelText("Ventes de calls")).getByText("Position : Oct16'26")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a box its own column filter empties, with a way back", async () => {
    await seed();
    renderPage("wheel");
    const box = await screen.findByLabelText("Ventes de puts");
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
    const box = await screen.findByLabelText("Actions assignées sans call");
    const user = userEvent.setup();
    const header = within(box).getByRole("columnheader", { name: /^Quantité/ });
    await user.click(within(header).getByRole("button", { name: /^Quantité/ }));
    expect(await screen.findByRole("button", { name: "Croissant" })).toBeInTheDocument();
  });

  it("remembers each box's view under its own key, per account and per strategy", async () => {
    // A criterion that would hide the XOM put too, were it to leak into "Ventes de puts": the
    // key must be scoped per box, not shared under "positions:wheel".
    await seed();
    window.localStorage.setItem(
      "ib2:tableView:beta:positions:wheel:callSells",
      JSON.stringify({ v: 1, sort: [], criteria: { position: "MQZA" } }),
    );
    renderPage("wheel");
    const calls = await screen.findByLabelText("Ventes de calls");
    expect(within(calls).getByText("MQZA Oct16'26 15 Call")).toBeInTheDocument();
    const puts = screen.getByLabelText("Ventes de puts");
    expect(within(puts).getByText("XOM Oct16'26 110 Put")).toBeInTheDocument();
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
