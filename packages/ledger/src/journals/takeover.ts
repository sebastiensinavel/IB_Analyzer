import { newLot, sharesPerContract, type Lot, type LotBook } from "./book.ts";
import type { ContractKey } from "./contract.ts";
import { formatContractLabel } from "./contract.ts";
import { uniqueId, type ReplayContext } from "./context.ts";
import { buildRow, share } from "./rows.ts";

/**
 * Long share lots of one underlying, in book order — which is FIFO order: what
 * a call sold on it can cover. Assignment is no longer the test (spec §3) — a
 * call sold on shares bought on the market is a covered call like any other —
 * so the only conditions left are being long, being shares, and being this
 * contract.
 */
export function coverableLots(book: LotBook, shares: ContractKey): Lot[] {
  return book.openLots(shares).filter((lot) => lot.kind === "shares" && lot.remaining > 0);
}

/**
 * Below this, a fraction of a share is floating-point noise, not a real
 * position: `toTake` is decremented by divisions and subtractions across
 * several lots (real fractional lots exist, spec's 226.49-share case
 * included), and its residue can land a hair off zero without ever hitting
 * it exactly.
 */
const SHARE_EPSILON = 1e-9;

export interface TakeoverRequest {
  /** The underlying's share contract. */
  shares: ContractKey;
  /** The call being sold: its strike sets the price, its label names the note. */
  call: ContractKey;
  when: string;
  /** Identifiers of the call sale: they close the shares it takes over. */
  callIds: string[];
  /** Contracts this call covers. */
  contracts: number;
  /** Contracts the other covered calls still open already back: Wheel shares that are not free. */
  alreadyCovered: number;
}

/**
 * Moves into the Wheel the shares this call lacks (spec 17, §3). The Wheel
 * covers first: its open shares, in contracts, less the covered calls still
 * open, are what it can still back. Only the missing contracts are taken, from
 * the lots outside the Wheel, in book order: each portion is cut out of its lot,
 * closed in its own strategy at the strike, and reopened in the Wheel at the
 * strike (spec 8, §5).
 *
 * Counting the Wheel rather than walking it is what makes this stable over
 * time: a call bought back frees its shares without taking them out of the
 * Wheel, so the next call finds them free and takes nothing, and an older lot
 * outside the Wheel is never taken while the Wheel alone can cover the call.
 */
export function takeOverShares(ctx: ReplayContext, request: TakeoverRequest): void {
  const strike = request.call.strike;
  if (strike === null) return;
  const lots = coverableLots(ctx.book, request.shares);
  const wheel = lots.filter((lot) => lot.strategy === "wheel").reduce((n, lot) => n + lot.remaining / sharesPerContract(lot), 0);
  let toTake = request.contracts - Math.max(0, wheel - request.alreadyCovered);
  for (const lot of lots) {
    if (toTake <= SHARE_EPSILON) return;
    if (lot.strategy === "wheel") continue;
    const per = sharesPerContract(lot);
    const available = lot.remaining / per;
    const take = Math.min(available, toTake);
    // A residue at or below SHARE_EPSILON is noise, not a real fraction of a
    // contract: taking it over would emit a phantom `integrated` row and a
    // phantom Wheel lot for a share that was never really left uncovered.
    if (take <= SHARE_EPSILON) continue;
    toTake -= take;
    // `take === available`: take the remaining shares themselves rather than
    // a product, so no float noise appears on a lot taken over whole.
    takeOverLot(ctx, lot, take === available ? lot.remaining : take * per, strike, request);
  }
}

/** Cuts `shares` out of `lot`, closes them in their own strategy at `strike`, reopens them in the Wheel. */
function takeOverLot(ctx: ReplayContext, lot: Lot, shares: number, strike: number, request: TakeoverRequest): void {
  const contract = formatContractLabel(request.call);
  const whole = Math.abs(lot.quantity);
  let rest = lot.remaining - shares;
  // A remainder at or below SHARE_EPSILON is the same noise as above: folding
  // it into the taken portion keeps every share accounted for instead of
  // opening a leftover lot that would never close.
  if (rest > 0 && rest <= SHARE_EPSILON) {
    shares = lot.remaining;
    rest = 0;
  }
  ctx.rows.push(
    buildRow(lot, shares, {
      when: request.when,
      price: strike,
      amount: strike * shares,
      commission: 0,
      event: "integrated",
      closeIds: [...request.callIds],
      note: { code: "handedToWheel", contract },
    }),
  );
  lot.remaining = 0;
  const taken = newLot({
    id: uniqueId(ctx, lot.id),
    contract: lot.contract,
    strategy: "wheel",
    kind: "shares",
    openWhen: request.when,
    rankWhen: lot.rankWhen,
    openPrice: strike,
    openAmount: -strike * shares,
    openCommission: 0,
    quantity: shares,
    openIds: [...lot.openIds],
    ratio: sharesPerContract(lot),
    note: { code: "takenOverAtStrike", contract },
  });
  const successors: Lot[] = [taken];
  if (rest > 0) {
    successors.push(
      newLot({
        id: uniqueId(ctx, lot.id),
        contract: lot.contract,
        strategy: lot.strategy,
        kind: lot.kind,
        openWhen: lot.openWhen,
        rankWhen: lot.rankWhen,
        openPrice: lot.openPrice,
        openAmount: share(lot.openAmount, rest, whole),
        openCommission: share(lot.openCommission, rest, whole),
        quantity: rest,
        openIds: [...lot.openIds],
        assigned: lot.assigned,
        orphan: lot.orphan,
        ratio: lot.ratio,
        deliveredBy: lot.deliveredBy,
      }),
    );
  }
  ctx.book.insertAfter(lot, successors);
  // A put's delivered shares are already Wheel, so the loop above never cuts
  // them: the only lot that can land here already tracked in `ctx.delivered`
  // is one a long call — LEAPS or Others — delivered on exercise. Its row
  // stays "ongoing" while its shares are, which `ctx.delivered` follows by
  // the shares themselves, not by the lot object they were cut from: without
  // this, a takeover would make that row look settled while its shares are
  // still open in the Wheel.
  for (const lots of ctx.delivered.values()) if (lots.includes(lot)) lots.push(...successors);
}
