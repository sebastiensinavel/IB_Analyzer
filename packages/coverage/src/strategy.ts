import {
  contractId,
  contractOf,
  sharesContract,
  wheelHoldings,
  type ContractKey,
  type JournalRow,
  type Position,
  type RowKind,
  type WheelHolding,
} from "@ib/ledger";
import { contractMultiplier, evaluateBuyback } from "./classify.ts";
import { DEFAULT_MULTIPLIER, KIND_LABELS, type CoverSource, type PositionKind } from "./constants.ts";
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

export interface WheelPositions {
  shares: WheelShareLine[];
  optionSales: StrategyLine[];
}

export interface LeapsPositions {
  optionBuys: StrategyLine[];
  optionSales: StrategyLine[];
  shares: StrategyLine[];
}

/** The snapshot's positions and the risk report built from them, index for index. */
export interface PricedSnapshot {
  positions: readonly Position[];
  report: RiskReport;
}

export type PositionsStrategy = "wheel" | "leaps";

/**
 * The cover each strategy owns on a sold option: the Wheel's calls lean on its shares and its puts
 * on cash, the LEAPS' calls on the LEAPS. A naked part belongs to the Others journal, so UNCOVERED —
 * never an allocation anyway — is shown by neither page.
 */
export const STRATEGY_COVER_SOURCES: Record<PositionsStrategy, readonly CoverSource[]> = {
  wheel: ["cash", "stock"],
  leaps: ["leaps"],
};

interface Priced {
  position: Position;
  analyzed: AnalyzedPosition;
}

const LINE_KIND: Partial<Record<RowKind, PositionKind>> = {
  short_put: "short_put",
  short_call: "short_call",
  long_call: "long_call",
  shares: "long_stock",
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
  const multiplier = kind === "long_stock" ? 1 : priced ? contractMultiplier(priced.position) : DEFAULT_MULTIPLIER;
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

/** The open lines of `strategy` whose kind is one of `kinds`, one line per contract. */
function strategyLines(rows: readonly JournalRow[], strategy: PositionsStrategy, kinds: readonly RowKind[], priced: Map<string, Priced>): StrategyLine[] {
  const groups = new Map<string, JournalRow[]>();
  for (const row of rows) {
    if (row.strategy !== strategy || row.endWhen !== null || row.quantity === null || !kinds.includes(row.kind)) continue;
    const id = contractId(row.contract);
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  return [...groups.entries()].map(([id, group]) => line(group, priced.get(id) ?? null, STRATEGY_COVER_SOURCES[strategy])).sort(compareLines);
}

export function wheelPositions(rows: readonly JournalRow[], snapshot: PricedSnapshot | null): WheelPositions {
  const priced = pricedByContract(snapshot);
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
  return { shares, optionSales: strategyLines(rows, "wheel", ["short_put", "short_call"], priced) };
}

export function leapsPositions(rows: readonly JournalRow[], snapshot: PricedSnapshot | null): LeapsPositions {
  const priced = pricedByContract(snapshot);
  return {
    optionBuys: strategyLines(rows, "leaps", ["long_call"], priced),
    optionSales: strategyLines(rows, "leaps", ["short_call"], priced),
    shares: strategyLines(rows, "leaps", ["shares"], priced),
  };
}
