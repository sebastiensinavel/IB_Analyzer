import { ACTIVABLE_STRATEGIES, contractId, type ActivableStrategy, type ContractKey, type JournalRow } from "@ib/ledger";
import { evaluateBuyback, type BuybackAdvice } from "./buyback.ts";
import { contractMultiplier } from "./classify.ts";
import { DEFAULT_MULTIPLIER, KIND_LABELS, type PositionKind } from "./constants.ts";
import { condorsNakedByContract, dayShare, pricedByContract, type Priced, type PricedSnapshot } from "./strategy.ts";

export const CONDOR_KINDS = ["iron_condor", "partial_iron_condor"] as const;
export type CondorKind = (typeof CONDOR_KINDS)[number];

/** The Type column of a condor, English and shown as is, like KIND_LABELS. */
export const CONDOR_KIND_LABELS: Record<CondorKind, string> = {
  iron_condor: "iron condor",
  partial_iron_condor: "partial iron condor",
};

/** One leg of a condor, priced from the snapshot when it is still open (spec of sub-project 34, §4). */
export interface CondorLegLine {
  contract: ContractKey;
  kind: PositionKind; // short_put | short_call | long_put | long_call
  label: string; // KIND_LABELS[kind]
  quantity: number; // signée, celle de la ligne de journal
  openPrice: number | null;
  closed: boolean;
  lastPrice: number | null; // ouverte : marketPrice du snapshot ; fermée : closePrice du journal
  marketValue: number | null; // null si fermée
  dayChange: number | null; // null si fermée
  dailyPnl: number | null; // null si fermée
  pnl: number | null; // ouverte : latent ; fermée : row.pnl (réalisé)
  naked: number; // contrats nus de cette jambe (0 sauf jambe vendue ouverte)
}

/** One open condor, one line per open composite row of the Condors journal (spec of sub-project 34, §3). */
export interface CondorLine {
  id: string; // id de la ligne composite du journal
  contract: ContractKey; // contrat du composite : ticker, expiry, right "", strike null
  title: string; // row.label, p. ex. "SPY Aug29'26 IC 620/625/660/665"
  kind: CondorKind;
  label: string; // CONDOR_KIND_LABELS[kind]
  quantity: number; // quantité du composite, négative
  credit: number | null; // openPrice du composite
  closingCost: number | null; // Σ −signe(q) × lastPrice des jambes ouvertes
  marketValue: number | null; // Σ des jambes ouvertes
  dailyPnl: number | null; // Σ des jambes ouvertes
  pnl: number | null; // réalisé + latent
  realizedPnl: number | null; // Σ pnl des jambes fermées ; 0 pour un condor complet
  decision: "buy back" | "keep" | null;
  /** The advice behind `decision`; `null` exactly when it is. */
  buyback: BuybackAdvice | null;
  naked: number; // Σ naked des jambes
  legs: CondorLegLine[];
}

function sum(values: readonly (number | null)[]): number | null {
  let total = 0;
  for (const value of values) {
    if (value === null) return null;
    total += value;
  }
  return total;
}

function openLeg(row: JournalRow, priced: Priced | undefined): CondorLegLine {
  const quantity = row.quantity as number;
  const kind = row.kind as PositionKind;
  const lastPrice = priced?.position.marketPrice ?? null;
  const multiplier = priced ? contractMultiplier(priced.position) : DEFAULT_MULTIPLIER;
  const marketValue = lastPrice === null ? null : lastPrice * quantity * multiplier;
  const day = dayShare(priced?.position ?? null, quantity);
  return {
    contract: row.contract,
    kind,
    label: KIND_LABELS[kind],
    quantity,
    openPrice: row.openPrice,
    closed: false,
    lastPrice,
    marketValue,
    dayChange: day.dayChange,
    dailyPnl: day.dailyPnl,
    // marketValue − openPrice × quantity × multiplier, the formula of strategyPositions.
    pnl: marketValue === null || row.openPrice === null ? null : marketValue - row.openPrice * quantity * multiplier,
    naked: 0,
  };
}

function closedLeg(row: JournalRow): CondorLegLine {
  const kind = row.kind as PositionKind;
  return {
    contract: row.contract,
    kind,
    label: KIND_LABELS[kind],
    quantity: row.quantity as number,
    openPrice: row.openPrice,
    closed: true,
    lastPrice: row.closePrice,
    marketValue: null,
    dayChange: null,
    dailyPnl: null,
    pnl: row.pnl,
    naked: 0,
  };
}

const isSoldLeg = (leg: CondorLegLine) => leg.quantity < 0;

/** The bought wing on the same side as `leg` is closed: IB sees `leg` naked. */
function wingClosed(legs: readonly CondorLegLine[], leg: CondorLegLine): boolean {
  return legs.some((other) => other.quantity > 0 && other.contract.right === leg.contract.right && other.closed);
}

/**
 * Hands each contract's naked count to the open sold legs that hold it, each at most its own
 * quantity: first those whose wing is closed — the ones IB actually sees naked —, then the others,
 * condors in the order they opened (spec §5).
 */
function spreadNaked(lines: CondorLine[], naked: Map<string, number>): void {
  const remaining = new Map(naked);
  const candidates = lines.flatMap((line) =>
    line.legs.filter((leg) => isSoldLeg(leg) && !leg.closed).map((leg) => ({ line, leg, first: wingClosed(line.legs, leg) })),
  );
  // Stable sort: `lines` is already in opening order within each rank.
  candidates.sort((a, b) => Number(b.first) - Number(a.first));
  for (const { line, leg } of candidates) {
    const id = contractId(leg.contract);
    const left = remaining.get(id) ?? 0;
    if (left <= 0) continue;
    const take = Math.min(left, Math.abs(leg.quantity));
    leg.naked = take;
    line.naked += take;
    remaining.set(id, left - take);
  }
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * What the Condors hold open, one line per open composite row of their journal — exactly the
 * condors the journal shows open — its legs priced from the snapshot (spec of sub-project 34).
 * Computed, never stored.
 */
export function condorPositions(
  rows: readonly JournalRow[],
  snapshot: PricedSnapshot | null,
  active: readonly ActivableStrategy[] = ACTIVABLE_STRATEGIES,
): CondorLine[] {
  const priced = pricedByContract(snapshot);
  const composites = rows
    .filter((row) => row.strategy === "condors" && row.kind === "condor" && row.endWhen === null && row.legs)
    .sort((a, b) => compareText(a.startWhen, b.startWhen) || compareText(a.id, b.id));
  const lines = composites.map((row): CondorLine => {
    const legs = (row.legs ?? []).map((leg) => (leg.endWhen === null ? openLeg(leg, priced.get(contractId(leg.contract))) : closedLeg(leg)));
    const open = legs.filter((leg) => !leg.closed);
    const partial = open.length < legs.length;
    const kind: CondorKind = partial ? "partial_iron_condor" : "iron_condor";
    const closingCost = sum(open.map((leg) => (leg.lastPrice === null ? null : -Math.sign(leg.quantity) * leg.lastPrice)));
    const realizedPnl = sum(legs.filter((leg) => leg.closed).map((leg) => leg.pnl));
    const latent = sum(open.map((leg) => leg.pnl));
    const timing = snapshot?.asOf && row.contract.expiry ? { soldAt: row.startWhen, expiry: row.contract.expiry, asOf: snapshot.asOf } : null;
    const advice = !partial && row.openPrice !== null && closingCost !== null ? evaluateBuyback(row.openPrice, closingCost, timing) : null;
    // closingCost <= 0 means IB would pay to close: always a buyback, whatever the rule says of
    // |closingCost| against a small credit.
    const buyback = advice && closingCost !== null && closingCost <= 0 ? { ...advice, decision: "buy back" as const, threshold: 0 } : advice;
    return {
      id: row.id,
      contract: row.contract,
      title: row.label,
      kind,
      label: CONDOR_KIND_LABELS[kind],
      quantity: row.quantity as number,
      credit: row.openPrice,
      closingCost,
      marketValue: sum(open.map((leg) => leg.marketValue)),
      dailyPnl: sum(open.map((leg) => leg.dailyPnl)),
      pnl: latent === null || realizedPnl === null ? null : latent + realizedPnl,
      realizedPnl,
      decision: buyback?.decision ?? null,
      buyback,
      naked: 0,
      legs,
    };
  });
  spreadNaked(lines, condorsNakedByContract(rows, snapshot, active));
  // Ticker, then expiry; Array.prototype.sort is stable, so the opening order stays within.
  return lines.sort((a, b) => compareText(a.contract.ticker, b.contract.ticker) || compareText(a.contract.expiry ?? "", b.contract.expiry ?? ""));
}
