import { beforeEach, describe, expect, it } from "vitest";
import { deliver, expire, option, resetIds } from "./fixtures.ts";
import { buildJournals } from "./replay.ts";
import type { JournalRow, JournalsReport } from "./types.ts";

beforeEach(resetIds);

const D1 = "2026-08-01T14:30:00.000Z";
const EXP = "2026-08-29";
const SPY = { ticker: "SPY", expiry: EXP };

/** A 620/625/660/665 iron condor sold `n` times at D1: legs 1..4 in strike order, 0.50 net credit per share. */
function condor(n = 1, when = D1) {
  return [
    option({ ...SPY, right: "P", strike: 620, quantity: n, price: 0.3, when }),
    option({ ...SPY, right: "P", strike: 625, quantity: -n, price: 0.6, when }),
    option({ ...SPY, right: "C", strike: 660, quantity: -n, price: 0.5, when }),
    option({ ...SPY, right: "C", strike: 665, quantity: n, price: 0.3, when }),
  ];
}

function condors(report: JournalsReport): JournalRow[] {
  return report.rows.filter((r) => r.strategy === "condors");
}

describe("condors", () => {
  it("folds four legs opened together into one Condors row, legs attached", () => {
    const report = buildJournals(condor());
    expect(report.rows).toHaveLength(1);
    const [row] = report.rows;
    expect(row).toMatchObject({
      id: "flex:trade:2~ic#1",
      strategy: "condors",
      kind: "condor",
      ticker: "SPY",
      label: "SPY Aug29'26 IC 620/625/660/665",
      startWhen: D1,
      quantity: -1,
      strike: null,
      openPrice: 0.5,
      openTotal: 50,
      openCommission: -4,
      openNet: 46,
      ongoing: true,
      endWhen: null,
      pnl: null,
    });
    expect(row.legs?.map((leg) => [leg.label, leg.quantity, leg.strategy, leg.ongoing])).toEqual([
      ["SPY Aug29'26 620 Put", 1, "condors", true],
      ["SPY Aug29'26 625 Put", -1, "condors", true],
      ["SPY Aug29'26 660 Call", -1, "condors", true],
      ["SPY Aug29'26 665 Call", 1, "condors", true],
    ]);
    expect(row.legs?.map((leg) => leg.strike)).toEqual([620, 625, 660, 665]);
  });

  it("closes when the four legs expire: the whole credit is the pnl", () => {
    const report = buildJournals([
      ...condor(),
      expire({ ...SPY, right: "P", strike: 620, quantity: -1 }),
      expire({ ...SPY, right: "P", strike: 625, quantity: 1 }),
      expire({ ...SPY, right: "C", strike: 660, quantity: 1 }),
      expire({ ...SPY, right: "C", strike: 665, quantity: -1 }),
    ]);
    expect(condors(report)).toHaveLength(1);
    expect(condors(report)[0]).toMatchObject({ endWhen: `${EXP}T20:00:00.000Z`, closePrice: 0, closeTotal: 0, closeCommission: null, closeNet: 0, pnl: 46, event: "expired", ongoing: false });
  });

  it("closes on the last leg bought back, netting every leg's exit", () => {
    const report = buildJournals([
      ...condor(),
      option({ ...SPY, right: "C", strike: 660, quantity: 1, price: 1.5, when: "2026-08-10T15:00:00.000Z" }),
      option({ ...SPY, right: "C", strike: 665, quantity: -1, price: 0.9, when: "2026-08-10T15:00:00.000Z" }),
      option({ ...SPY, right: "P", strike: 625, quantity: 1, price: 0.1, when: "2026-08-20T15:00:00.000Z" }),
      option({ ...SPY, right: "P", strike: 620, quantity: -1, price: 0.05, when: "2026-08-21T15:00:00.000Z" }),
    ]);
    const [row] = condors(report);
    // Debit per share: +1.5 - 0.9 + 0.1 - 0.05 = 0.65 paid back against 0.50 received.
    expect(row).toMatchObject({ endWhen: "2026-08-21T15:00:00.000Z", closeTotal: -65, closeCommission: -4, closeNet: -69, pnl: -23, event: "buyback", ongoing: false });
    expect(row.closePrice).toBeCloseTo(0.65);
    expect(row.legs?.map((leg) => leg.endWhen)).toEqual([
      "2026-08-21T15:00:00.000Z", "2026-08-20T15:00:00.000Z", "2026-08-10T15:00:00.000Z", "2026-08-10T15:00:00.000Z",
    ]);
  });

  it("splits by quantity: two of four condors bought back make two rows", () => {
    const report = buildJournals([
      ...condor(4),
      option({ ...SPY, right: "P", strike: 620, quantity: -2, price: 0.1, when: "2026-08-10T15:00:00.000Z" }),
      option({ ...SPY, right: "P", strike: 625, quantity: 2, price: 0.2, when: "2026-08-10T15:00:00.000Z" }),
      option({ ...SPY, right: "C", strike: 660, quantity: 2, price: 0.2, when: "2026-08-10T15:00:00.000Z" }),
      option({ ...SPY, right: "C", strike: 665, quantity: -2, price: 0.1, when: "2026-08-10T15:00:00.000Z" }),
    ]);
    const rows = condors(report);
    expect(rows.map((r) => [r.id, r.quantity, r.ongoing, r.openTotal, r.closeTotal])).toEqual([
      ["flex:trade:2~ic#1", -2, false, 100, -40],
      ["flex:trade:2~ic#2", -2, true, 100, null],
    ]);
  });

  it("sends three legs, or four legs out of order, to Others leg by leg", () => {
    const three = buildJournals(condor().slice(1));
    expect(three.rows.map((r) => r.strategy)).toEqual(["others", "others", "others"]);
    resetIds();
    const crossed = buildJournals([
      option({ ...SPY, right: "P", strike: 625, quantity: 1, price: 0.3, when: D1 }),
      option({ ...SPY, right: "P", strike: 620, quantity: -1, price: 0.6, when: D1 }),
      option({ ...SPY, right: "C", strike: 660, quantity: -1, price: 0.5, when: D1 }),
      option({ ...SPY, right: "C", strike: 665, quantity: 1, price: 0.3, when: D1 }),
    ]);
    expect(crossed.rows.map((r) => r.strategy)).toEqual(["others", "others", "others", "others"]);
  });

  it("books the shares a leg's assignment delivers in Others", () => {
    const report = buildJournals([...condor(), ...deliver({ ...SPY, right: "P", strike: 625, quantity: 1 })]);
    const shares = report.rows.find((r) => r.kind === "shares");
    expect(shares).toMatchObject({ strategy: "others", quantity: 100, openPrice: 625, assigned: true });
    expect(condors(report)[0]).toMatchObject({ ongoing: true });
  });

  it("keeps the legs in the reconciliation as ordinary contracts", () => {
    const report = buildJournals(condor(2));
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].legs?.map((leg) => leg.quantity)).toEqual([2, -2, -2, 2]);
  });
});
