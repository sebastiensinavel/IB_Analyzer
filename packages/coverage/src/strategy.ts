import {
  contractId,
  contractOf,
  sharesContract,
  wheelHoldings,
  type ContractKey,
  type JournalRow,
  type Position,
  type RowKind,
  type Strategy,
  type WheelHolding,
} from "@ib/ledger";
import { contractMultiplier, evaluateBuyback } from "./classify.ts";
import { DEFAULT_MULTIPLIER, DETAIL_GROUPS, KIND_LABELS, type CoverSource, type DetailGroupId, type PositionKind } from "./constants.ts";
import type { AnalyzedPosition, CoverageAllocation, RiskReport } from "./types.ts";

/** A strategy's part of one IB contract: one line of the option or share tables (spec of sub-project 16, §3). */
export interface StrategyLine {
  contract: ContractKey;
  /** short_put, short_call, long_call or long_stock. */
  kind: PositionKind;
  /** KIND_LABELS[kind], the Type column of the Positions page. */
  label: string;
  /** Signed: the strategy's open journal lines on this contract, summed. */
  quantity: number;
  /** Σ openPrice × |quantity| ÷ Σ |quantity|; `null` when a line has no price. */
  avgPrice: number | null;
  /** Market price of the IB position on the same contract; `null` when the snapshot does not hold it. */
  lastPrice: number | null;
  /** lastPrice × quantity × multiplier */
  marketValue: number | null;
  /** (lastPrice − avgPrice) × quantity × multiplier */
  unrealizedPnl: number | null;
  /** Short options only: evaluateBuyback(avgPrice, lastPrice); `null` otherwise or without both prices. */
  decision: "buy back" | "keep" | null;
  /** The whole IB position; `null` when the snapshot does not hold the contract. */
  position: AnalyzedPosition | null;
  /**
   * What of the IB position's cover belongs to the strategy (`STRATEGY_COVER_SOURCES`), for a sold
   * option; empty for what is bought and without a position.
   */
  coverage: CoverageAllocation[];
}

export interface WheelShareLine extends WheelHolding {
  lastPrice: number | null;
  /** (lastPrice − averageAssignmentPrice) × quantity */
  unrealizedPnl: number | null;
  /** averageCallStrike < averageAssignmentPrice; `false` when either is `null`. */
  callStrikeBelowAssignment: boolean;
}

/** The snapshot's positions and the risk report built from them, index for index. */
export interface PricedSnapshot {
  positions: readonly Position[];
  report: RiskReport;
}

/** Every strategy has a positions page; each shows the boxes its lines fill (spec of sub-project 21, §4). */
export type PositionsStrategy = Strategy;

/**
 * The cover each strategy owns on a sold option: the Wheel's calls lean on its shares and its puts
 * on cash, the LEAPS' calls on the LEAPS, a condor's legs on the other legs of the structure.
 * Others owns none: what is left there is precisely what nothing covers, and UNCOVERED is never an
 * allocation — the page shows it from the line's own quantity.
 */
export const STRATEGY_COVER_SOURCES: Record<PositionsStrategy, readonly CoverSource[]> = {
  wheel: ["cash", "stock"],
  leaps: ["leaps"],
  condors: ["spread"],
  others: [],
};

interface Priced {
  position: Position;
  analyzed: AnalyzedPosition;
}

const LINE_KIND: Partial<Record<RowKind, PositionKind>> = {
  short_put: "short_put",
  short_call: "short_call",
  long_call: "long_call",
  long_put: "long_put",
  shares: "long_stock",
  short_shares: "short_stock",
};

/**
 * The snapshot keyed like the journals' reconciliation. `buildRiskReport` returns
 * `positions.map(analyze)` and the coverage engine never reorders that array, so the report's
 * position at `i` is the snapshot's position at `i` (a test in strategy.test.ts holds it).
 */
function pricedByContract(snapshot: PricedSnapshot | null): Map<string, Priced> {
  const byId = new Map<string, Priced>();
  if (!snapshot) return byId;
  snapshot.positions.forEach((position, i) => {
    const id = contractId(contractOf(position));
    if (!byId.has(id)) byId.set(id, { position, analyzed: snapshot.report.positions[i] });
  });
  return byId;
}

function line(group: readonly JournalRow[], priced: Priced | null, sources: readonly CoverSource[]): StrategyLine {
  const first = group[0];
  const kind = LINE_KIND[first.kind] as PositionKind;
  const quantity = group.reduce((n, row) => n + (row.quantity as number), 0);
  const weight = group.reduce((n, row) => n + Math.abs(row.quantity as number), 0);
  const avgPrice =
    weight === 0 || group.some((row) => row.openPrice === null)
      ? null
      : group.reduce((n, row) => n + (row.openPrice as number) * Math.abs(row.quantity as number), 0) / weight;
  const multiplier = kind === "long_stock" || kind === "short_stock" ? 1 : priced ? contractMultiplier(priced.position) : DEFAULT_MULTIPLIER;
  const lastPrice = priced?.position.marketPrice ?? null;
  const sold = kind === "short_put" || kind === "short_call";
  return {
    contract: first.contract,
    kind,
    label: KIND_LABELS[kind],
    quantity,
    avgPrice,
    lastPrice,
    marketValue: lastPrice === null ? null : lastPrice * quantity * multiplier,
    unrealizedPnl: lastPrice === null || avgPrice === null ? null : (lastPrice - avgPrice) * quantity * multiplier,
    decision: sold && lastPrice !== null && avgPrice !== null ? evaluateBuyback(avgPrice, lastPrice) : null,
    position: priced?.analyzed ?? null,
    coverage: sold && priced ? priced.analyzed.allocations.filter((allocation) => sources.includes(allocation.source)) : [],
  };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareLines(a: StrategyLine, b: StrategyLine): number {
  return (
    compareText(a.contract.ticker, b.contract.ticker) ||
    compareText(a.contract.expiry ?? "", b.contract.expiry ?? "") ||
    compareText(a.contract.right, b.contract.right) ||
    (a.contract.strike ?? 0) - (b.contract.strike ?? 0)
  );
}

/**
 * A condor is read on its legs: its composite row carries a contract without a right nor a strike,
 * which no snapshot position answers, so it never prices. Its four legs do. A condor partly bought
 * back is several composites, each with its legs scaled to the units it covers; grouping by
 * contract sums them back into what is still open.
 */
function flatten(rows: readonly JournalRow[]): JournalRow[] {
  return rows.flatMap((row) => row.legs ?? [row]);
}

/** The open lines of `strategy`, one per contract, grouped by the DETAIL_GROUPS the page shows. */
function linesByGroup(rows: readonly JournalRow[], strategy: PositionsStrategy, priced: Map<string, Priced>): Record<DetailGroupId, StrategyLine[]> {
  const groups = new Map<string, JournalRow[]>();
  for (const row of flatten(rows)) {
    if (row.strategy !== strategy || row.endWhen !== null || row.quantity === null) continue;
    if (LINE_KIND[row.kind] === undefined) continue;
    const id = contractId(row.contract);
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  const lines = [...groups.entries()].map(([id, group]) => line(group, priced.get(id) ?? null, STRATEGY_COVER_SOURCES[strategy])).sort(compareLines);
  const byGroup = Object.fromEntries(DETAIL_GROUPS.map((group) => [group.id, [] as StrategyLine[]])) as Record<DetailGroupId, StrategyLine[]>;
  for (const candidate of lines) {
    const group = DETAIL_GROUPS.find((entry) => entry.kinds?.has(candidate.kind)) ?? DETAIL_GROUPS[DETAIL_GROUPS.length - 1];
    byGroup[group.id].push(candidate);
  }
  return byGroup;
}

export interface StrategyPositions {
  /** Wheel only: its assigned shares, which are its long positions — `groups.long` stays empty. */
  shares: WheelShareLine[];
  groups: Record<DetailGroupId, StrategyLine[]>;
}

/**
 * What a strategy holds open, priced from the snapshot: one line per contract, grouped as the
 * Positions page groups a portfolio (spec of sub-project 21, §4.1). Computed, never stored.
 */
export function strategyPositions(rows: readonly JournalRow[], strategy: PositionsStrategy, snapshot: PricedSnapshot | null): StrategyPositions {
  const priced = pricedByContract(snapshot);
  const groups = linesByGroup(rows, strategy, priced);
  if (strategy !== "wheel") return { shares: [], groups };
  const shares = wheelHoldings(rows).map((holding): WheelShareLine => {
    const lastPrice = priced.get(contractId(sharesContract(holding.ticker, holding.currency)))?.position.marketPrice ?? null;
    const { averageAssignmentPrice, averageCallStrike } = holding;
    return {
      ...holding,
      lastPrice,
      unrealizedPnl: lastPrice === null || averageAssignmentPrice === null ? null : (lastPrice - averageAssignmentPrice) * holding.quantity,
      callStrikeBelowAssignment: averageCallStrike !== null && averageAssignmentPrice !== null && averageCallStrike < averageAssignmentPrice,
    };
  });
  // The Wheel's shares are its long positions, shown by their own table: never twice.
  return { shares, groups: { ...groups, long: [] } };
}
