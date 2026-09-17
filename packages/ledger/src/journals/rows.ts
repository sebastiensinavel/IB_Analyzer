import type { Exit, Lot } from "./book.ts";
import { formatContractLabel } from "./contract.ts";
import type { JournalRow, RowNote } from "./types.ts";

/** `part / whole` of a figure; a whole is returned untouched so no float noise appears on an unsplit lot. */
export function share(value: number | null, part: number, whole: number): number | null {
  if (value === null) return null;
  if (part === whole) return value;
  return (value * part) / whole;
}

export function net(total: number | null, commission: number | null): number | null {
  return total === null ? null : total + (commission ?? 0);
}

/**
 * Why this line is where it is. What the engine knew explicitly wins — a Wheel
 * takeover names the call that caused it, and only the engine saw that call —
 * and the rest is read off the line. A condor leg is never annotated: its own
 * strategy lives on the composite.
 */
function noteOf(lot: Lot, exit: Exit | null): RowNote | null {
  if (exit?.note) return exit.note;
  if (lot.note) return lot.note;
  if (lot.parent) return null;
  if (lot.orphan) return { code: "truncatedHistory" };
  if (lot.kind === "short_call" && lot.cover === null && lot.strategy === "others") return { code: "nakedCall" };
  return null;
}

/**
 * One row for `quantity` (unsigned) units of `lot`, closed by `exit` or
 * still open. Numbers the row on the lot: call it in exit order.
 */
export function buildRow(lot: Lot, quantity: number, exit: Exit | null): JournalRow {
  const whole = Math.abs(lot.quantity);
  const openTotal = share(lot.openAmount, quantity, whole);
  const openCommission = share(lot.openCommission, quantity, whole);
  const openNet = net(openTotal, openCommission);
  const closeNet = exit ? net(exit.amount, exit.commission) : null;
  const delivered = exit?.event === "assigned" || exit?.event === "exercised";
  lot.exits += 1;
  return {
    id: `${lot.id}#${lot.exits}`,
    strategy: lot.strategy,
    kind: lot.kind,
    ticker: lot.contract.ticker,
    label: lot.label ?? formatContractLabel(lot.contract),
    currency: lot.contract.currency,
    // A copy: a corporate action later moves the lot to another contract, never this row.
    contract: { ...lot.contract },
    startWhen: lot.openWhen,
    quantity: Math.sign(lot.quantity) * quantity,
    strike: lot.contract.strike,
    openPrice: lot.openPrice,
    openTotal,
    openCommission,
    openNet,
    assigned: lot.assigned || delivered,
    endWhen: exit ? exit.when : null,
    closePrice: exit ? exit.price : null,
    closeTotal: exit ? exit.amount : null,
    closeCommission: exit ? exit.commission : null,
    closeNet,
    pnl: exit && openNet !== null && closeNet !== null ? openNet + closeNet : null,
    ongoing: exit === null,
    event: exit ? exit.event : null,
    orphan: lot.orphan,
    note: noteOf(lot, exit),
    openIds: [...lot.openIds],
    closeIds: exit ? [...exit.closeIds] : [],
  };
}
