import type { Transaction } from "../types.ts";
import { newLot, type Lot, type LotBook } from "./book.ts";
import { sharesContract } from "./contract.ts";
import { closeLot, uniqueId, type ReplayContext } from "./context.ts";
import type { IdentityIssue } from "./identities.ts";

/**
 * One corporate action, both legs folded. `from` is what leaves the account,
 * `to` what arrives; `cash` is the consideration a mixed merger paid on top
 * of the new shares.
 */
export interface CorporateActionEvent {
  when: string;
  from: CorporateActionLeg;
  to: CorporateActionLeg;
  cash: { amount: number; realizedPnl: number | null } | null;
  /** externalIds of both legs, outgoing first: the rows a mixed merger emits cite them. */
  ids: string[];
}

/**
 * One side of an action: the contract it names, and how much of it moves.
 * `isin` is `""` on a row whose description carries no triple to read it
 * from — a legacy import, or an event IB described without one.
 */
export interface CorporateActionLeg {
  ticker: string;
  isin: string;
  /** Signed: negative on `from`, positive on `to`. */
  quantity: number;
}

/**
 * Both rows of one action share their description up to the trailing
 * "(TICKER, NAME, ISIN)" triple that names the leg, so stripping the triple
 * yields the event's own name. A description without a triple is its own
 * name, which is why a lone legacy row still groups with itself and is then
 * reported unpaired rather than silently dropped.
 */
function eventName(description: string): string {
  return description.replace(/\s*\([^()]*\)\s*$/, "").trim();
}

/**
 * The ticker and the ISIN the trailing "(TICKER, NAME, ISIN)" triple names,
 * i.e. the security *this* row concerns; `null` when there is no triple to
 * read.
 *
 * Deliberately duplicates `legFromDescription`
 * (`packages/ib-parsers/src/common.ts`), which applies the same rule at parse
 * time: `packages/ledger` may not import `@ib/ib-parsers`, the dependency
 * runs the other way. Keep the two in step.
 *
 * The duplication earns its keep: rows imported before the parser learned
 * this rule carry the *event prefix* on both legs, so a merger read from
 * `tx.symbol` alone pairs a ticker with itself and rescales a position that
 * never existed — silently, since the pairing succeeds. Reading the triple
 * here replays those rows correctly without a re-import.
 *
 * The ISIN matters as much as the ticker: it is the only thing that says
 * *which* contract the spelling meant on the day of the event, and IB reuses
 * a ticker for the new contract of a CUSIP change often enough that the
 * spelling alone points at the dead one (`buildIdentities`, rule 8).
 */
function legFromDescription(description: string): { ticker: string; isin: string } | null {
  const match = /\(([^()]+)\)\s*$/.exec(description.trim());
  if (!match) return null;
  const parts = match[1].split(",").map((part) => part.trim());
  if (parts.length < 2) return null;
  const ticker = parts[0];
  if (!/^[A-Za-z0-9.]+$/.test(ticker)) return null;
  return { ticker, isin: parts[parts.length - 1] };
}

export function pairCorporateActions(transactions: readonly Transaction[]): {
  events: CorporateActionEvent[];
  issues: IdentityIssue[];
} {
  const groups = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    if (tx.kind !== "corporate_action") continue;
    const key = `${tx.when}|${eventName(tx.description)}`;
    const list = groups.get(key);
    if (list) list.push(tx);
    else groups.set(key, [tx]);
  }

  const events: CorporateActionEvent[] = [];
  const issues: IdentityIssue[] = [];
  for (const legs of groups.values()) {
    const outgoing = legs.filter((tx) => (tx.quantity ?? 0) < 0);
    const incoming = legs.filter((tx) => (tx.quantity ?? 0) > 0);
    if (legs.length !== 2 || outgoing.length !== 1 || incoming.length !== 1) {
      issues.push({
        ticker: legs[0].symbol,
        code: "action-unpaired",
        detail: `${eventName(legs[0].description)} at ${legs[0].when} has ${legs.length} leg${legs.length > 1 ? "s" : ""}, expected 2`,
      });
      continue;
    }
    const [out] = outgoing;
    const [inc] = incoming;
    const outLeg = legFromDescription(out.description);
    const incLeg = legFromDescription(inc.description);
    const from = outLeg?.ticker ?? out.symbol;
    const to = incLeg?.ticker ?? inc.symbol;
    if (outLeg === null && incLeg === null && from === to && inc.quantity !== -out.quantity!) {
      // Neither the description nor the symbols tell the two legs apart, and
      // the ratio is not 1: replaying would scale the old position instead of
      // moving it. That is exactly the shape a pre-parser row takes when its
      // description carried no triple either — refuse, and say what fixes it.
      issues.push({
        ticker: from,
        code: "action-unpaired",
        detail: `${eventName(out.description)} at ${out.when} names the same ticker on both legs: re-import the statement so each leg carries its own ticker`,
      });
      continue;
    }
    events.push({
      when: out.when,
      from: { ticker: from, isin: outLeg?.isin ?? "", quantity: out.quantity! },
      to: { ticker: to, isin: incLeg?.isin ?? "", quantity: inc.quantity! },
      // A pure conversion carries 0 on both legs; a mixed merger carries the
      // cash on the leg that leaves.
      cash: out.amount ? { amount: out.amount, realizedPnl: out.realizedPnl ?? null } : null,
      ids: [out.externalId, inc.externalId],
    });
    if (out.amount && (out.realizedPnl === null || out.realizedPnl === undefined)) {
      // A mixed merger without its realized P/L cannot be split (corporate.ts);
      // say so rather than let it look like an ordinary conversion.
      issues.push({
        ticker: from,
        code: "merger-basis-unknown",
        detail: `${eventName(out.description)} at ${out.when} pays cash but reports no realized P/L: not replayed`,
      });
    }
  }
  events.sort((a, b) => (a.when < b.when ? -1 : a.when > b.when ? 1 : 0));
  return { events, issues };
}

/**
 * IB relabels the outgoing leg of a corporate action "X.OLD" so it never
 * collides with a new contract that later reuses the plain ticker; the lot
 * that action is moving was never actually opened under that spelling. Only
 * the outgoing leg ever wears the suffix.
 *
 * The same IB convention is read from the other end by `isOld` / `canonicalOf`
 * in `identities.ts`, which rank a `.OLD` alias last when electing a
 * contract's canonical name. Both exist because they answer different
 * questions: this one asks "under which name is the lot actually filed", the
 * other "which of a class's names should the whole ledger wear". Change the
 * suffix in one place and the other stops agreeing.
 */
export function withoutOldSuffix(ticker: string): string {
  return ticker.endsWith(".OLD") ? ticker.slice(0, -".OLD".length) : ticker;
}

/**
 * A split, a CUSIP change or a stock-for-stock merger is not a sale: the
 * position changes shape, the money does not move. Every open lot of the old
 * contract becomes a lot of the new one, scaled by the ratio, keeping its
 * basis (`openAmount`, `openCommission`) and its age. `openPrice` divides by
 * the ratio rather than being recomputed from `openAmount`, so it stays what
 * it is everywhere else in the engine: a trade price, commissions excluded.
 *
 * The ratio is almost never representable in binary — 53.3333/1600 is not —
 * so scaling alone leaves a few 1e-14 of residue on the position, which the
 * reconciliation then reports as a difference against a snapshot holding a
 * round number. When the book held exactly what the event takes out, it must
 * hold exactly what the event brings in: the residue lands on the biggest lot
 * moved, the only one it cannot perturb. On the last one it could: a lot left
 * open on a few 1e-15 by a partial close of nearly its whole size would flip
 * short, and the book would carry a phantom short lot the journals would then
 * show as an ongoing row. When the book held less than the event takes out —
 * a history truncated before it — nothing is corrected, scaling being then
 * the only honest answer.
 *
 * No journal row is emitted — a conversion is not an exit.
 */
export function applyConversion(book: LotBook, event: CorporateActionEvent, currency: string): void {
  const ratio = event.to.quantity / Math.abs(event.from.quantity);
  if (!Number.isFinite(ratio) || ratio <= 0) return;
  const from = sharesContract(withoutOldSuffix(event.from.ticker), currency);
  const held = book.position(from);
  const moved = book.move(from, sharesContract(event.to.ticker, currency), (lot: Lot) => {
    lot.quantity *= ratio;
    lot.remaining *= ratio;
    if (lot.openPrice !== null) lot.openPrice /= ratio;
  });
  if (moved.length === 0 || held !== -event.from.quantity) return;
  const residue = event.to.quantity - moved.reduce((total, lot) => total + lot.remaining, 0);
  const biggest = moved.reduce((best, lot) => (Math.abs(lot.remaining) > Math.abs(best.remaining) ? lot : best));
  biggest.remaining += residue;
  biggest.quantity += residue;
}

/** What a long lot really cost: cash out plus commission, as a positive number. */
function basisOf(lot: Lot): number {
  return -((lot.openAmount ?? 0) + (lot.openCommission ?? 0));
}

/**
 * A cash-and-stock merger pays part of the position in money and the rest in
 * shares of another company. Nothing is "closed" in the ordinary sense — the
 * whole position leaves at once — so what splits is the basis, not the
 * quantity:
 *
 *   f = (cash - realizedPnl) / total basis      the fraction paid in cash
 *   the lots keep f of their basis and close for `cash`  -> P/L = realizedPnl
 *   a new lot opens on the new contract with (1 - f) of the basis
 *
 * IB's own split comes from the new share's market price on the day, which no
 * source of ours reports; its printed realized P/L is the only way back to
 * it. Without that number nothing is converted: the position stays open and
 * the reconciliation card says so, which beats inventing a P/L.
 */
export function applyMixedMerger(ctx: ReplayContext, event: CorporateActionEvent, currency: string): void {
  const cash = event.cash;
  if (!cash || cash.realizedPnl === null || cash.realizedPnl === undefined) return;
  // IB relabels the outgoing leg "X.OLD"; the lots this merger is moving were
  // opened under the plain ticker (see withoutOldSuffix above).
  const from = sharesContract(withoutOldSuffix(event.from.ticker), currency);
  const lots = ctx.book.openLots(from);
  if (lots.length === 0) return;
  const totalBasis = lots.reduce((sum, lot) => sum + basisOf(lot), 0);
  if (totalBasis <= 0) return;
  const f = (cash.amount - cash.realizedPnl) / totalBasis;
  if (!Number.isFinite(f) || f < 0 || f > 1) return;

  const template = lots[0];
  const position = lots.reduce((sum, lot) => sum + lot.remaining, 0);

  // Scale each lot's basis down to the part the cash actually paid for,
  // *before* closing: the rows take their open side from these figures.
  for (const lot of lots) {
    const share = basisOf(lot) / totalBasis;
    if (lot.openAmount !== null) lot.openAmount *= f;
    if (lot.openCommission !== null) lot.openCommission *= f;
    if (lot.openPrice !== null) lot.openPrice *= f;
    // Closed lot by lot, not through `book.close`: that one walks the
    // contract FIFO and would pair a lot with another lot's share of the cash.
    const quantity = Math.abs(lot.remaining);
    lot.remaining = 0;
    closeLot(ctx, lot, quantity, {
      when: event.when,
      price: cash.amount / Math.abs(position),
      amount: cash.amount * share,
      commission: null,
      event: "corporate_action",
      closeIds: event.ids,
    });
  }

  ctx.book.open(newLot({
    id: uniqueId(ctx, `${event.ids[0]}:merger`),
    contract: sharesContract(event.to.ticker, currency),
    strategy: template.strategy,
    kind: template.kind,
    // The merger's own instant: unlike a conversion, this lot has a new basis
    // and a new cost, so dating it back to the old purchase would be a lie.
    openWhen: event.when,
    openPrice: ((1 - f) * totalBasis) / event.to.quantity,
    openAmount: -(1 - f) * totalBasis,
    openCommission: 0,
    quantity: event.to.quantity,
    openIds: event.ids,
  }));
}
