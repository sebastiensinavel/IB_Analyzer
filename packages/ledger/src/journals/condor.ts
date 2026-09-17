import { newLot, type Exit, type Lot } from "./book.ts";
import { contractOf, formatCondorLabel } from "./contract.ts";
import { uniqueId, type ReplayContext } from "./context.ts";
import { buildRow, share } from "./rows.ts";
import type { CloseEvent, JournalRow } from "./types.ts";
import { openLot, type Opening } from "./classify.ts";

export interface CondorLegs {
  /** Long put, short put, short call, long call: strikes ascending. */
  legs: [Opening, Opening, Opening, Opening];
  strikes: [number, number, number, number];
  quantity: number;
}

/** Four legs, one expiry, equal quantities, long put < short put < short call < long call. */
export function detectCondor(group: Opening[]): CondorLegs | null {
  if (group.length !== 4) return null;
  const quantity = Math.abs(group[0].quantity);
  if (!group.every((o) => Math.abs(o.quantity) === quantity && o.tx.strike !== null && !o.orphan)) return null;
  const pick = (right: "C" | "P", sign: number) => group.filter((o) => o.tx.right === right && Math.sign(o.quantity) === sign);
  const [lp] = pick("P", 1);
  const [sp] = pick("P", -1);
  const [sc] = pick("C", -1);
  const [lc] = pick("C", 1);
  if (!lp || !sp || !sc || !lc || pick("P", 1).length + pick("P", -1).length + pick("C", -1).length + pick("C", 1).length !== 4) return null;
  const strikes = [lp.tx.strike, sp.tx.strike, sc.tx.strike, lc.tx.strike] as [number, number, number, number];
  if (!(strikes[0] < strikes[1] && strikes[1] < strikes[2] && strikes[2] < strikes[3])) return null;
  return { legs: [lp, sp, sc, lc], strikes, quantity };
}

function sum(values: (number | null)[]): number | null {
  let total = 0;
  for (const value of values) {
    if (value === null) return null;
    total += value;
  }
  return total;
}

/** Net credit per share: what the short legs bring minus what the long legs cost. */
function netPrice(legs: Lot[], prices: (number | null)[]): number | null {
  const signed = legs.map((leg, i) => (prices[i] === null ? null : -Math.sign(leg.quantity) * (prices[i] ?? 0)));
  return sum(signed);
}

export function openCondor(ctx: ReplayContext, condor: CondorLegs): void {
  const legs = condor.legs.map((opening) => openLot(ctx, opening, "condors", null));
  const contract = contractOf(condor.legs[1].tx);
  const composite = newLot({
    id: uniqueId(ctx, `${condor.legs[1].tx.externalId}~ic`),
    contract: { ...contract, right: "", strike: null },
    strategy: "condors",
    kind: "condor",
    openWhen: condor.legs[1].tx.when,
    openPrice: netPrice(legs, legs.map((leg) => leg.openPrice)),
    openAmount: sum(legs.map((leg) => leg.openAmount)),
    openCommission: sum(legs.map((leg) => leg.openCommission)),
    // A sold condor is a short position: negative, like a put sold.
    quantity: -condor.quantity,
    openIds: legs.flatMap((leg) => leg.openIds),
    legs,
    label: formatCondorLabel(contract.ticker, contract.expiry ?? "", condor.strikes),
  });
  for (const leg of legs) leg.parent = composite;
  ctx.composites.push(composite);
}

/** Index of the exit of `leg` that covers unit `unit` (0-based), -1 while that unit is open. */
function exitIndex(leg: Lot, unit: number): number {
  let covered = 0;
  for (let i = 0; i < leg.exitLog.length; i++) {
    covered += leg.exitLog[i].quantity;
    if (unit < covered) return i;
  }
  return -1;
}

function scaleExit(exit: Exit, part: number, whole: number): Exit {
  return { ...exit, amount: share(exit.amount, part, whole), commission: share(exit.commission, part, whole), closeIds: [...exit.closeIds] };
}

function compositeEvent(events: CloseEvent[]): CloseEvent {
  if (events.some((e) => e === "assigned" || e === "exercised")) return "assigned";
  if (events.every((e) => e === "expired")) return "expired";
  return "buyback";
}

/**
 * One row per group of condor units that share the same exits on every leg
 * (spec §3.5): all open, all closed the same way, or a partial buyback.
 */
export function condorRows(composite: Lot): JournalRow[] {
  const legs = composite.legs ?? [];
  const total = Math.abs(composite.quantity);
  const groups = new Map<string, { units: number; indices: number[] }>();
  for (let unit = 0; unit < total; unit++) {
    const indices = legs.map((leg) => exitIndex(leg, unit));
    const key = indices.join(",");
    const group = groups.get(key);
    if (group) group.units += 1;
    else groups.set(key, { units: 1, indices });
  }
  return [...groups.values()].map(({ units, indices }) => {
    const exits = legs.map((leg, i) => (indices[i] >= 0 ? leg.exitLog[indices[i]] : null));
    const legRows = legs.map((leg, i) => {
      const entry = exits[i];
      return buildRow(leg, units, entry ? scaleExit(entry.exit, units, entry.quantity) : null);
    });
    const closed = exits.every((entry) => entry !== null);
    const exit: Exit | null = closed
      ? {
          when: exits.reduce((latest, entry) => (entry && entry.exit.when > latest ? entry.exit.when : latest), ""),
          price: netPrice(legs, legRows.map((row) => row.closePrice)),
          amount: sum(legRows.map((row) => row.closeTotal)),
          commission: sum(legRows.map((row) => row.closeCommission)),
          event: compositeEvent(legRows.map((row) => row.event ?? "buyback")),
          closeIds: legRows.flatMap((row) => row.closeIds),
        }
      : null;
    const row = buildRow(composite, units, exit);
    row.legs = legRows;
    return row;
  });
}
