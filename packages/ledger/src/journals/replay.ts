import { dayOf } from "../filter.ts";
import { sortTransactions } from "../order.ts";
import type { Transaction } from "../types.ts";
import { isWheelCoveredCall, isWheelShares, newLot, type ClosedPortion, type Exit, type Lot, type LotBook, type OpenPosition } from "./book.ts";
import { contractId, contractOf, formatContractLabel, isPackedOptionSymbol, optionTerms, packedOptionSymbol, sharesContract, tickerOf, type ContractKey } from "./contract.ts";
import { classifyOpenings, type Opening } from "./classify.ts";
import { computeCapital } from "./capital.ts";
import { applyConversion, applyMixedMerger, pairCorporateActions, withoutOldSuffix, type CorporateActionEvent } from "./corporate.ts";
import { mergeFills } from "./fills.ts";
import { condorRows } from "./condor.ts";
import { closeLot, idsOf, kindOf, newContext, uniqueId, type ReplayContext } from "./context.ts";
import { NO_IDENTITIES, type ContractIdentities } from "./identities.ts";
import { reconcile } from "./reconcile.ts";
import { buildRow, net, share } from "./rows.ts";
import { computeStats } from "./stats.ts";
import { ACTIVABLE_STRATEGIES, scopeStrategies, type ActivableStrategy, type CapitalScope, type CloseEvent, type JournalRow, type JournalSnapshot, type JournalsReport, type Reconciliation } from "./types.ts";

function isReplayable(tx: Transaction): boolean {
  if (tx.kind !== "trade") return false;
  if (tx.secType === "STK") return tx.quantity !== null && tx.quantity !== 0;
  if (tx.secType === "OPT") return tx.quantity !== 0;
  return false;
}

/** The shape of an expiry, assignment or exercise on the option leg: nothing paid, nothing charged. */
function isSettlementShape(tx: Transaction): boolean {
  return tx.price === 0 && !tx.commission;
}

/** Sign of the share delivery a settlement of this option implies, for the side (`lotSign`) being closed. */
export function deliverySign(right: "C" | "P" | "", lotSign: number): number {
  return (right === "P" ? -1 : 1) * lotSign;
}

/**
 * Pairs an option leg with its share delivery by exact `when` string equality.
 * Sound today because every fixture and parser stamps both legs of one
 * settlement with the identical ISO string, and `sortTransactions` keeps ties
 * on `when` stable — but a source that formatted the two legs differently
 * (`...T20:00:00Z` vs `...T20:00:00.000Z`) would silently split them into two
 * groups and lose the assignment inference entirely.
 */
function groupByWhen(transactions: Transaction[]): Transaction[][] {
  const groups: Transaction[][] = [];
  for (const tx of transactions) {
    const last = groups[groups.length - 1];
    if (last && last[0].when === tx.when) last.push(tx);
    else groups.push([tx]);
  }
  return groups;
}

export function sortRows(rows: JournalRow[]): JournalRow[] {
  return [...rows].sort((a, b) => {
    if (a.startWhen !== b.startWhen) return a.startWhen < b.startWhen ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** A Flex `asOf` is a day, compared at its end; an agent `asOf` is an instant. */
function boundaryOf(asOf: string): string {
  return asOf.length === 10 ? `${asOf}T23:59:59.999Z` : asOf;
}

/**
 * The spelling the identity table knows a transaction's contract under.
 *
 * A stock wears its ticker. An option wears its packed OCC symbol, which Flex
 * writes but statements and the agent do not: they name the option by its
 * underlying and leave the terms in their own fields, from which the same
 * spelling is rebuilt (spec §4.2). Anything else — cash, warrants, a row with
 * no `secType` — has no identity to resolve.
 */
function identityKey(tx: Transaction): string | null {
  if (tx.secType === "STK") return tx.symbol;
  if (tx.secType !== "OPT") return null;
  if (isPackedOptionSymbol(tx.symbol)) return tx.symbol;
  return packedOptionSymbol(tickerOf(tx.symbol), tx.expiry, tx.right, tx.strike);
}

/**
 * Rewrites every trade's contract name to its class's canonical one.
 *
 * Only the root may change on an option: a canonical whose terms differ names
 * another contract entirely, and moving the lot there would invent a position
 * nobody holds. A Flex row keeps the packed form it came with, a statement or
 * agent row keeps the shape of its own source — both give `contractOf` the
 * same ticker, hence the same `contractId`.
 *
 * Corporate action rows are left alone, although they are `STK`: their two
 * legs must be resolved at two different instants (`resolveLegs` below), and
 * their tickers are read from the description rather than from `symbol`
 * anyway (`pairCorporateActions`).
 */
function canonicalize(transactions: readonly Transaction[], identities: ContractIdentities): Transaction[] {
  return transactions.map((tx) => {
    if (tx.kind === "corporate_action") return tx;
    const key = identityKey(tx);
    if (key === null) return tx;
    const canonical = identities.canonical(key, tx.when);
    if (canonical === key) return tx;
    if (tx.secType === "STK") return { ...tx, symbol: canonical };
    if (optionTerms(canonical) !== optionTerms(key)) return tx;
    return { ...tx, symbol: isPackedOptionSymbol(tx.symbol) ? canonical : tickerOf(canonical) };
  });
}

/**
 * The instant just before `when`. Rule 4 of §5.2 hands an ambiguous ticker
 * its *after* name from the event's own instant, bounds included — right for
 * the leg a corporate action brings in, wrong for the leg it takes out, whose
 * lots are filed under the name the contract wore before. One millisecond is
 * the finest grain any of our sources timestamps, so nothing can fall in the
 * gap; an unparseable instant simply resolves as it always did.
 */
function justBefore(when: string): string {
  const at = Date.parse(when);
  return Number.isNaN(at) ? when : new Date(at - 1).toISOString();
}

/**
 * Gives each leg of an event the canonical name of the contract it really
 * touches: the outgoing leg as the book knew it a moment before, the incoming
 * one as of the event itself. Resolving both at `when` would convert a
 * contract nobody holds and leave the ghost short this sub-project exists to
 * remove — invisibly, since the ticker resolved to something plausible.
 */
function resolveLegs(event: CorporateActionEvent, identities: ContractIdentities): CorporateActionEvent {
  return {
    ...event,
    from: { ...event.from, ticker: identities.canonical(event.from.ticker, justBefore(event.when)) },
    to: { ...event.to, ticker: identities.canonical(event.to.ticker, event.when) },
  };
}

export function buildJournals(
  transactions: readonly Transaction[],
  snapshot?: JournalSnapshot,
  identities: ContractIdentities = NO_IDENTITIES,
  active: readonly ActivableStrategy[] = ACTIVABLE_STRATEGIES,
): JournalsReport {
  const named = canonicalize(sortTransactions(transactions), identities);
  const { events: paired } = pairCorporateActions(named);
  const events = paired.map((event) => resolveLegs(event, identities));
  const { transactions: sorted, ids } = mergeFills(named.filter(isReplayable));
  const ctx = newContext(ids, active);
  for (const tx of sorted) {
    if (tx.quantity !== null) continue;
    const key = `${contractId(contractOf(tx))}@${dayOf(tx.when)}`;
    const list = ctx.settlements.get(key);
    if (list) list.push(tx);
    else ctx.settlements.set(key, [tx]);
  }
  const boundary = snapshot ? boundaryOf(snapshot.asOf) : null;
  let atBoundary: Map<string, OpenPosition> | null = null;
  let nextEvent = 0;
  const applyDueEvents = (limit: string): void => {
    // Bounds included, and *before* the trades of the same instant: a split
    // that leaves a fraction has that fraction sold at the very instant of
    // the split, and the other order would open a short.
    while (nextEvent < events.length && events[nextEvent].when <= limit) {
      applyEvent(ctx, events[nextEvent++]);
    }
  };
  // Captures the book exactly as the snapshot's own instant saw it: events at
  // or before the boundary are part of that, events after it are not. Must
  // run strictly between "apply what is due up to the boundary" and "apply
  // what is due for this group" — never after the group's own events, or a
  // trade group that lands long after the boundary would sweep in every
  // event up to itself first and the capture would see the wrong book.
  const captureBoundary = (limit: string): void => {
    if (boundary === null || atBoundary !== null || limit <= boundary) return;
    applyDueEvents(boundary);
    atBoundary = ctx.book.positions();
  };
  for (const group of groupByWhen(sorted.filter((tx) => tx.quantity !== null))) {
    captureBoundary(group[0].when);
    applyDueEvents(group[0].when);
    replayGroup(group, ctx);
  }
  captureBoundary("9999-12-31T23:59:59.999Z");
  applyDueEvents("9999-12-31T23:59:59.999Z");
  if (boundary !== null && atBoundary === null) atBoundary = ctx.book.positions();
  finalize(ctx);
  const rows = sortRows(ctx.rows);
  const reconciliation: Reconciliation = snapshot && atBoundary ? reconcile(atBoundary, snapshot) : { asOf: null, differences: [], orphans: [] };
  reconciliation.orphans = rows.filter((row) => row.orphan);
  const lastWhen = transactions.reduce<string | null>((latest, transaction) => (latest === null || transaction.when > latest ? transaction.when : latest), null);
  const statsOf = (scope: CapitalScope) => computeStats(rows, scopeStrategies(scope, active), lastWhen);
  const stats = { wheel: statsOf("wheel"), leaps: statsOf("leaps"), condors: statsOf("condors"), portfolio: statsOf("portfolio") };
  const capitalOf = (scope: CapitalScope) => computeCapital(rows, scopeStrategies(scope, active), stats[scope]);
  return {
    rows,
    reconciliation,
    stats,
    capital: { wheel: capitalOf("wheel"), leaps: capitalOf("leaps"), condors: capitalOf("condors"), portfolio: capitalOf("portfolio") },
  };
}

/** The currency of a corporate action, read from the lots it touches; USD when the book is empty. */
function currencyOf(ctx: ReplayContext, ticker: string): string {
  const lot = ctx.book.allOpen().find((l) => l.contract.ticker === ticker);
  return lot?.contract.currency ?? "USD";
}

function applyEvent(ctx: ReplayContext, event: CorporateActionEvent): void {
  // `withoutOldSuffix` here too: the lots this action touches were opened
  // under the plain ticker, never IB's "X.OLD" relabelling of the outgoing leg.
  const currency = currencyOf(ctx, withoutOldSuffix(event.from.ticker));
  if (event.cash) applyMixedMerger(ctx, event, currency);
  else applyConversion(ctx.book, event, currency);
}

// --- one instant ---------------------------------------------------------

/** Shares available at one strike, in one direction, at one instant, to serve settlement-shaped closes. */
interface DeliveryPool {
  txs: Transaction[];
  shares: number;
  consumed: Map<Transaction, number>;
}

interface Delivery {
  sign: number;
  shares: number;
  ratio: number;
  amount: number | null;
  commission: number | null;
  ids: string[];
}

/**
 * A settlement-shaped option close that may claim a delivery pool: `contracts`
 * is what it closes, `positionSign` is the sign of the position it closes
 * (negative: a short, i.e. an assignment; positive: a long, i.e. an exercise).
 */
interface Claim {
  tx: Transaction;
  contracts: number;
  positionSign: number;
  sign: number;
  key: string;
}

function poolKey(contract: ContractKey, strike: number, sign: number): string {
  return `${contract.ticker}|${contract.currency}|${strike}|${sign}`;
}

/**
 * One claim per qualifying settlement-shaped option transaction. The pool key
 * is `ticker|currency|strike|sign` only: a share delivery (`STK`) carries no
 * `right` or `expiry` to disambiguate further, so two distinct contracts can
 * genuinely collide on the same key (a short put and a long call at the same
 * strike and expiry-instant, say). `right`/`expiry` cannot be added to the
 * key for that reason — the fix lives in how claims on one key are served,
 * not in a finer key.
 */
function collectClaims(options: Transaction[], book: LotBook): Claim[] {
  const claims: Claim[] = [];
  const remaining = new Map<string, number>();
  for (const tx of options) {
    if (!isSettlementShape(tx) || tx.strike === null) continue;
    const contract = contractOf(tx);
    const id = contractId(contract);
    const position = remaining.get(id) ?? book.position(contract);
    const quantity = tx.quantity ?? 0;
    if (position === 0 || Math.sign(position) === Math.sign(quantity)) continue;
    const closable = Math.min(Math.abs(quantity), Math.abs(position));
    remaining.set(id, position + Math.sign(quantity) * closable);
    const positionSign = Math.sign(position);
    const sign = deliverySign(tx.right, positionSign);
    claims.push({ tx, contracts: closable, positionSign, sign, key: poolKey(contract, tx.strike, sign) });
  }
  return claims;
}

/** One pool per key actually claimed by an option; an unclaimed stock leg is left for `isUnclaimedDelivery` below. */
function buildStockPools(stocks: Transaction[], keys: ReadonlySet<string>): Map<string, DeliveryPool> {
  const pools = new Map<string, DeliveryPool>();
  for (const tx of stocks) {
    // IB never charges commission on an assignment or exercise delivery: a commissioned
    // trade at the same strike is an ordinary market purchase, not a delivery leg.
    if (tx.price === null || tx.commission) continue;
    const key = poolKey(contractOf(tx), tx.price, Math.sign(tx.quantity ?? 0));
    if (!keys.has(key)) continue;
    const pool: DeliveryPool = pools.get(key) ?? { txs: [], shares: 0, consumed: new Map() };
    pool.txs.push(tx);
    pool.shares += Math.abs(tx.quantity ?? 0);
    pools.set(key, pool);
  }
  return pools;
}

function addShare(sum: number | null, value: number | null, part: number, whole: number): number | null {
  if (sum === null || value === null) return null;
  return sum + (share(value, part, whole) ?? 0);
}

/** Takes everything left in the pool for one claim: no pro rata across distinct claims, see `resolveDeliveries`. */
function takeDelivery(pool: DeliveryPool | undefined, sign: number, contracts: number): Delivery | null {
  if (!pool) return null;
  let amount: number | null = 0;
  let commission: number | null = 0;
  const ids: string[] = [];
  let taken = 0;
  for (const tx of pool.txs) {
    const whole = Math.abs(tx.quantity ?? 0);
    const available = whole - (pool.consumed.get(tx) ?? 0);
    if (available <= 0) continue;
    pool.consumed.set(tx, (pool.consumed.get(tx) ?? 0) + available);
    amount = addShare(amount, tx.amount, available, whole);
    commission = addShare(commission, tx.commission, available, whole);
    ids.push(tx.externalId);
    taken += available;
  }
  if (taken === 0) return null;
  return { sign, shares: taken, ratio: taken / contracts, amount, commission, ids };
}

/** Slices a whole-transaction `Delivery` to one of the lot portions it closed. */
function sliceDelivery(delivery: Delivery, quantity: number, closedQty: number): Delivery {
  return {
    sign: delivery.sign,
    shares: delivery.ratio * quantity,
    ratio: delivery.ratio,
    amount: share(delivery.amount, quantity, closedQty),
    commission: share(delivery.commission, quantity, closedQty),
    ids: delivery.ids,
  };
}

interface Deliveries {
  pools: Map<string, DeliveryPool>;
  byTx: Map<Transaction, Delivery | null>;
}

/**
 * Resolves one `Delivery | null` per qualifying option transaction. Claims
 * closing a short position (an assignment, the common case) are served
 * before those closing a long position (an exercise), in the order each
 * group is processed today: the first claimant on a pool takes everything
 * left in it, a later one on the same (coincidentally colliding) pool finds
 * nothing and is reported `expired` rather than assigned or exercised.
 */
function resolveDeliveries(options: Transaction[], stocks: Transaction[], book: LotBook): Deliveries {
  const claims = collectClaims(options, book);
  const keys = new Set(claims.map((claim) => claim.key));
  const pools = buildStockPools(stocks, keys);
  const ordered = [...claims.filter((claim) => claim.positionSign < 0), ...claims.filter((claim) => claim.positionSign > 0)];
  const byTx = new Map<Transaction, Delivery | null>();
  for (const claim of ordered) byTx.set(claim.tx, takeDelivery(pools.get(claim.key), claim.sign, claim.contracts));
  return { pools, byTx };
}

function consumedShares(tx: Transaction, pools: Map<string, DeliveryPool>): number {
  let n = 0;
  for (const pool of pools.values()) n += pool.consumed.get(tx) ?? 0;
  return n;
}

function takeSettlement(ctx: ReplayContext, contract: ContractKey, when: string): Transaction | null {
  const list = ctx.settlements.get(`${contractId(contract)}@${dayOf(when)}`);
  return list && list.length > 0 ? (list.shift() ?? null) : null;
}

/** A stock row at an option strike, uncharged, that no settlement in its group claimed: the history misses the option. */
function isUnclaimedDelivery(tx: Transaction, options: Transaction[]): boolean {
  const ticker = contractOf(tx).ticker;
  return !tx.commission && options.some((o) => isSettlementShape(o) && o.strike === tx.price && contractOf(o).ticker === ticker);
}

function replayGroup(group: Transaction[], ctx: ReplayContext): void {
  const options = group.filter((tx) => tx.secType === "OPT");
  const stocks = group.filter((tx) => tx.secType === "STK");
  const { pools, byTx } = resolveDeliveries(options, stocks, ctx.book);
  const openings: Opening[] = [];

  // Contracts of Wheel covered calls bought back at this instant, per share
  // contract: a sale of those shares at the same instant sells Wheel shares
  // first, up to that many contracts (spec 17, §4.1).
  const wheelBuybacks = new Map<string, number>();
  for (const tx of options) {
    const contract = contractOf(tx);
    const quantity = tx.quantity ?? 0;
    const closed = ctx.book.close(contract, quantity);
    const closedQty = closed.reduce((n, c) => n + c.quantity, 0);
    if (closedQty > 0) closeOptions(tx, contract, closed, closedQty, byTx.get(tx) ?? null, ctx);
    if (!isSettlementShape(tx)) {
      const id = contractId(sharesContract(contract.ticker, contract.currency));
      for (const { lot, quantity: contracts } of closed) {
        if (isWheelCoveredCall(lot)) wheelBuybacks.set(id, (wheelBuybacks.get(id) ?? 0) + contracts);
      }
    }
    const rest = quantity - Math.sign(quantity) * closedQty;
    if (rest !== 0) openings.push({ tx, quantity: rest, orphan: closedQty === 0 && isSettlementShape(tx) });
  }
  classifyOpenings(openings, ctx);

  for (const tx of stocks) {
    const contract = contractOf(tx);
    const quantity = tx.quantity ?? 0;
    const whole = Math.abs(quantity);
    const left = quantity - Math.sign(quantity) * consumedShares(tx, pools);
    if (left === 0) continue;
    const budget = left < 0 ? (wheelBuybacks.get(contractId(contract)) ?? 0) : 0;
    const { closed, preferredContracts } = ctx.book.closePreferring(contract, left, isWheelShares, budget);
    if (preferredContracts > 0) wheelBuybacks.set(contractId(contract), budget - preferredContracts);
    for (const portion of closed) {
      closeLot(ctx, portion.lot, portion.quantity, {
        when: tx.when,
        price: tx.price,
        amount: share(tx.amount, portion.quantity, whole),
        commission: share(tx.commission, portion.quantity, whole),
        event: portion.lot.quantity > 0 ? "sold" : "buyback",
        closeIds: idsOf(ctx, tx),
      });
    }
    const rest = left - Math.sign(left) * closed.reduce((n, c) => n + c.quantity, 0);
    if (rest === 0) continue;
    ctx.book.open(
      newLot({
        id: uniqueId(ctx, tx.externalId),
        contract,
        strategy: "others",
        kind: kindOf("STK", "", rest),
        openWhen: tx.when,
        openPrice: tx.price,
        openAmount: share(tx.amount, Math.abs(rest), whole),
        openCommission: share(tx.commission, Math.abs(rest), whole),
        quantity: rest,
        openIds: idsOf(ctx, tx),
        orphan: isUnclaimedDelivery(tx, options),
      }),
    );
  }
}

function closeOptions(tx: Transaction, contract: ContractKey, closed: ClosedPortion[], closedQty: number, delivery: Delivery | null, ctx: ReplayContext): void {
  const settlementShape = isSettlementShape(tx);
  const whole = Math.abs(tx.quantity ?? 0);
  const lotSign = -Math.sign(tx.quantity ?? 0);
  const cash = settlementShape ? takeSettlement(ctx, contract, tx.when) : null;
  for (const portion of closed) {
    const settled = delivery !== null || cash !== null;
    const event: CloseEvent = !settlementShape ? (lotSign < 0 ? "buyback" : "sold") : !settled ? "expired" : lotSign < 0 ? "assigned" : "exercised";
    const exit: Exit = {
      when: tx.when,
      price: tx.price,
      amount: cash ? share(cash.amount, portion.quantity, closedQty) : share(tx.amount, portion.quantity, whole),
      commission: cash ? share(cash.commission, portion.quantity, closedQty) : share(tx.commission, portion.quantity, whole),
      event,
      closeIds: cash ? [...idsOf(ctx, tx), cash.externalId] : idsOf(ctx, tx),
    };
    const row = closeLot(ctx, portion.lot, portion.quantity, exit);
    if (delivery) deliverShares(ctx, portion.lot, sliceDelivery(delivery, portion.quantity, closedQty), tx.when, row);
  }
}

/** Books the shares an assignment or exercise delivers: sells what is held, or opens a delivered lot in the option's own journal. */
function deliverShares(ctx: ReplayContext, lot: Lot, delivery: Delivery, when: string, row: JournalRow | null): void {
  const contract = sharesContract(lot.contract.ticker, lot.contract.currency);
  // A Wheel covered call hands over Wheel shares first (spec 17, §4.2): the
  // Wheel may cover a call with shares ranked behind a lot it never took over.
  const wheelCall = delivery.sign < 0 && isWheelCoveredCall(lot);
  const { closed } = ctx.book.closePreferring(contract, delivery.sign * delivery.shares, isWheelShares, wheelCall ? delivery.shares / delivery.ratio : 0);
  for (const portion of closed) {
    closeLot(ctx, portion.lot, portion.quantity, {
      when,
      price: lot.contract.strike,
      amount: share(delivery.amount, portion.quantity, delivery.shares),
      commission: share(delivery.commission, portion.quantity, delivery.shares),
      event: portion.lot.quantity > 0 ? "sold" : "buyback",
      closeIds: [...delivery.ids],
    });
  }
  const rest = delivery.shares - closed.reduce((n, c) => n + c.quantity, 0);
  if (rest === 0) return;
  const inherited = delivery.sign > 0 && !lot.parent && !lot.orphan;
  const sharesLot = newLot({
    id: uniqueId(ctx, delivery.ids[0] ?? lot.id),
    contract,
    strategy: inherited ? lot.strategy : "others",
    kind: delivery.sign > 0 ? "shares" : "short_shares",
    openWhen: when,
    openPrice: lot.contract.strike,
    openAmount: share(delivery.amount, rest, delivery.shares),
    openCommission: share(delivery.commission, rest, delivery.shares),
    quantity: delivery.sign * rest,
    openIds: [...delivery.ids],
    assigned: true,
    ratio: delivery.ratio,
    deliveredBy: lot,
  });
  ctx.book.open(sharesLot);
  if (!row) return;
  const list = ctx.delivered.get(row);
  if (list) list.push(sharesLot);
  else ctx.delivered.set(row, [sharesLot]);
}

// --- the end -------------------------------------------------------------

function settlementRow(tx: Transaction): JournalRow {
  const contract = contractOf(tx);
  const openNet = net(tx.amount, tx.commission);
  return {
    id: tx.externalId,
    strategy: "others",
    kind: "settlement",
    ticker: contract.ticker,
    label: formatContractLabel(contract),
    currency: tx.currency,
    contract,
    startWhen: tx.when,
    quantity: null,
    strike: contract.strike,
    openPrice: null,
    openTotal: tx.amount,
    openCommission: tx.commission,
    openNet,
    assigned: true,
    endWhen: tx.when,
    closePrice: null,
    closeTotal: null,
    closeCommission: null,
    closeNet: null,
    pnl: openNet,
    ongoing: false,
    event: null,
    orphan: true,
    note: { code: "truncatedHistory" },
    openIds: [tx.externalId],
    closeIds: [],
  };
}

function finalize(ctx: ReplayContext): void {
  for (const lot of ctx.book.allOpen()) {
    if (!lot.parent) ctx.rows.push(buildRow(lot, Math.abs(lot.remaining), null));
  }
  for (const composite of ctx.composites) ctx.rows.push(...condorRows(composite));
  for (const [row, lots] of ctx.delivered) row.ongoing = lots.some((lot) => lot.remaining !== 0);
  for (const list of ctx.settlements.values()) for (const tx of list) ctx.rows.push(settlementRow(tx));
}
