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
  /** The strategy's prorated share of the IB position's day P&L; `null` with its dayChange. */
  dailyPnl: number | null;
  /** The IB position's move of the day, unprorated: it does not depend on the quantity. */
  dayChange: number | null;
  /** Short options only: evaluateBuyback(avgPrice, lastPrice); `null` otherwise or without both prices. */
  decision: "buy back" | "keep" | null;
  /** The whole IB position; `null` when the snapshot does not hold the contract. */
  position: AnalyzedPosition | null;
  /**
   * What of the IB position's cover belongs to the strategy (`STRATEGY_COVER_SOURCES`), for a sold
   * option; empty for what is bought and without a position.
   */
  coverage: CoverageAllocation[];
  /** Long options only: min(|quantity|, position.usedQuantity); `null` otherwise or without a position. */
  used: number | null;
}

export interface WheelShareLine extends WheelHolding {
  lastPrice: number | null;
  /** (lastPrice − averageAssignmentPrice) × quantity */
  unrealizedPnl: number | null;
  /** The strategy's prorated share of the IB position's day P&L; `null` with its dayChange. */
  dailyPnl: number | null;
  /** The IB position's move of the day, unprorated: it does not depend on the quantity. */
  dayChange: number | null;
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

/** The strategies that own a cover, in the order the pages are served when the cap bites. */
export const COVERED_STRATEGIES: readonly PositionsStrategy[] = ["wheel", "leaps", "condors"];

/**
 * How many contracts each covered strategy loses on one contract, the naked part the page Autres
 * takes over (spec of sub-project 22, §3.1). `shorts` counts the open sold contracts of each
 * strategy on that contract, unsigned, Others included.
 *
 * A strategy keeps what its own sources cover (`STRATEGY_COVER_SOURCES`), capped by its own
 * quantity: the allocations describe the whole IB position, which may exceed the strategy's part.
 * The total that migrates never exceeds what the engine itself calls naked, minus what Others
 * already holds — naked by construction, `splitShortCall` having put it there at the sale. That
 * cap is what keeps the page Autres from contradicting the title bar.
 */
export function migratedContracts(
  shorts: ReadonlyMap<PositionsStrategy, number>,
  allocations: readonly CoverageAllocation[],
  uncoveredQuantity: number,
): Map<PositionsStrategy, number> {
  const taken = new Map<PositionsStrategy, number>();
  let migrable = Math.max(0, uncoveredQuantity - (shorts.get("others") ?? 0));
  for (const strategy of COVERED_STRATEGIES) {
    if (migrable <= 0) break;
    const held = shorts.get(strategy) ?? 0;
    if (held <= 0) continue;
    const sources = STRATEGY_COVER_SOURCES[strategy];
    const own = allocations.reduce((sum, a) => (sources.includes(a.source) ? sum + a.quantity : sum), 0);
    const take = Math.min(held - Math.min(held, own), migrable);
    if (take > 0) {
      taken.set(strategy, take);
      migrable -= take;
    }
  }
  return taken;
}

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

/** One journal line's part of a position line: what it brings, and at what price. */
interface Contribution {
  quantity: number;
  openPrice: number | null;
}

interface LineInput {
  contract: ContractKey;
  kind: PositionKind;
  contributions: readonly Contribution[];
  /** Contracts that left this line for Others; positive, and 0 on everything but a covered strategy's sales. */
  migrated: number;
}

const toContribution = (row: JournalRow): Contribution => ({ quantity: row.quantity as number, openPrice: row.openPrice });

/** Σ openPrice × |quantity| ÷ Σ |quantity|; `null` when a contribution has no price or nothing weighs. */
function weightedPrice(contributions: readonly Contribution[]): number | null {
  const weight = contributions.reduce((n, c) => n + Math.abs(c.quantity), 0);
  if (weight === 0 || contributions.some((c) => c.openPrice === null)) return null;
  return contributions.reduce((n, c) => n + (c.openPrice as number) * Math.abs(c.quantity), 0) / weight;
}

/**
 * The strategy's own cover, cut down to the contracts the line actually shows: the allocations
 * describe the whole IB position, so nothing stops `stock ×2` from landing on a line of one
 * contract without this (spec of sub-project 22, §3.2).
 */
function cappedCoverage(priced: Priced, sources: readonly CoverSource[], quantity: number): CoverageAllocation[] {
  const capped: CoverageAllocation[] = [];
  let capacity = Math.abs(quantity);
  for (const allocation of priced.analyzed.allocations) {
    if (capacity <= 0) break;
    if (!sources.includes(allocation.source)) continue;
    const take = Math.min(capacity, allocation.quantity);
    if (take <= 0) continue;
    capped.push(take === allocation.quantity ? allocation : { ...allocation, quantity: take });
    capacity -= take;
  }
  return capped;
}

/**
 * A strategy's share of the day. The move is the position's, whatever the quantity; the P&L is
 * prorated. Both are `null` as soon as the position's move is — a contract traded today: IB's
 * day P&L then starts from the execution price, and what entered this morning does not carry the
 * same day's P&L per unit as what was held yesterday, so no share of it can be cut (spec §6).
 */
function dayShare(position: Position | null, quantity: number): { dailyPnl: number | null; dayChange: number | null } {
  if (!position || position.dayChange === null || position.dailyPnl === null || position.quantity === 0) {
    return { dailyPnl: null, dayChange: null };
  }
  return { dailyPnl: (position.dailyPnl * quantity) / position.quantity, dayChange: position.dayChange };
}

function line({ contract, kind, contributions, migrated }: LineInput, priced: Priced | null, sources: readonly CoverSource[]): StrategyLine {
  // A sale's quantity is negative, so what migrates brings it back towards zero.
  const quantity = contributions.reduce((n, c) => n + c.quantity, 0) + migrated;
  const avgPrice = weightedPrice(contributions);
  const multiplier = kind === "long_stock" || kind === "short_stock" ? 1 : priced ? contractMultiplier(priced.position) : DEFAULT_MULTIPLIER;
  const lastPrice = priced?.position.marketPrice ?? null;
  const sold = kind === "short_put" || kind === "short_call";
  const bought = kind === "long_call" || kind === "long_put";
  const marketValue = lastPrice === null ? null : lastPrice * quantity * multiplier;
  const day = dayShare(priced?.position ?? null, quantity);
  return {
    contract,
    kind,
    label: KIND_LABELS[kind],
    quantity,
    avgPrice,
    lastPrice,
    marketValue,
    // marketValue − avgPrice × quantity × multiplier, not (lastPrice − avgPrice) × quantity × multiplier:
    // mathematically the same, but stable when avgPrice has no exact binary fraction (0.7, e.g.).
    unrealizedPnl: marketValue === null || avgPrice === null ? null : marketValue - avgPrice * quantity * multiplier,
    dailyPnl: day.dailyPnl,
    dayChange: day.dayChange,
    decision: sold && lastPrice !== null && avgPrice !== null ? evaluateBuyback(avgPrice, lastPrice) : null,
    position: priced?.analyzed ?? null,
    coverage: sold && priced ? cappedCoverage(priced, sources, quantity) : [],
    used: bought && priced ? Math.min(Math.abs(quantity), priced.analyzed.usedQuantity) : null,
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

/** Every open journal line a page can show, by contract id then by strategy. */
type OpenRows = Map<string, Map<PositionsStrategy, JournalRow[]>>;

function openRowsByContract(rows: readonly JournalRow[]): OpenRows {
  const open: OpenRows = new Map();
  for (const row of flatten(rows)) {
    if (row.endWhen !== null || row.quantity === null) continue;
    if (LINE_KIND[row.kind] === undefined) continue;
    const id = contractId(row.contract);
    const byStrategy = open.get(id) ?? new Map<PositionsStrategy, JournalRow[]>();
    byStrategy.set(row.strategy, [...(byStrategy.get(row.strategy) ?? []), row]);
    open.set(id, byStrategy);
  }
  return open;
}

const isSold = (row: JournalRow) => LINE_KIND[row.kind] === "short_call" || LINE_KIND[row.kind] === "short_put";

/** What each covered strategy loses on each contract, `migratedContracts` applied to the book. */
function migratedByContract(open: OpenRows, priced: Map<string, Priced>): Map<string, Map<PositionsStrategy, number>> {
  const taken = new Map<string, Map<PositionsStrategy, number>>();
  for (const [id, byStrategy] of open) {
    const position = priced.get(id)?.analyzed;
    if (!position) continue;
    const shorts = new Map<PositionsStrategy, number>();
    for (const [strategy, rows] of byStrategy) {
      const held = rows.filter(isSold).reduce((n, r) => n + Math.abs(r.quantity as number), 0);
      if (held > 0) shorts.set(strategy, held);
    }
    const migrated = migratedContracts(shorts, position.allocations, position.uncoveredQuantity);
    if (migrated.size > 0) taken.set(id, migrated);
  }
  return taken;
}

/**
 * What Others takes over on one contract: for each covered strategy that loses contracts, one
 * contribution at that strategy's own average price (spec of sub-project 22, §3.3). Its sign is
 * that of a sale, negative, like the rows it stands for.
 */
function contributionsTakenIn(
  id: string,
  byStrategy: ReadonlyMap<PositionsStrategy, JournalRow[]>,
  taken: Map<string, Map<PositionsStrategy, number>>,
): Contribution[] {
  const migrated = taken.get(id);
  if (!migrated) return [];
  const contributions: Contribution[] = [];
  for (const strategy of COVERED_STRATEGIES) {
    const count = migrated.get(strategy) ?? 0;
    if (count <= 0) continue;
    contributions.push({ quantity: -count, openPrice: weightedPrice((byStrategy.get(strategy) ?? []).map(toContribution)) });
  }
  return contributions;
}

/** The contract and kind of a line Others holds nothing of: read off the rows that migrate to it. */
function firstSoldRow(byStrategy: ReadonlyMap<PositionsStrategy, JournalRow[]>, migrated: Map<PositionsStrategy, number> | undefined): JournalRow {
  for (const strategy of COVERED_STRATEGIES) {
    if ((migrated?.get(strategy) ?? 0) <= 0) continue;
    const row = (byStrategy.get(strategy) ?? []).find(isSold);
    if (row) return row;
  }
  throw new Error("a contract migrates to Others without a sold line to name it");
}

/** The open lines of `strategy`, one per contract, grouped by the DETAIL_GROUPS the page shows. */
function linesByGroup(
  open: OpenRows,
  strategy: PositionsStrategy,
  priced: Map<string, Priced>,
  taken: Map<string, Map<PositionsStrategy, number>>,
): Record<DetailGroupId, StrategyLine[]> {
  const lines: StrategyLine[] = [];
  for (const [id, byStrategy] of open) {
    const rows = byStrategy.get(strategy) ?? [];
    const migrated = taken.get(id)?.get(strategy) ?? 0;
    const takenIn = strategy === "others" ? contributionsTakenIn(id, byStrategy, taken) : [];
    if (rows.length === 0 && takenIn.length === 0) continue;
    const held = rows.reduce((n, r) => n + Math.abs(r.quantity as number), 0);
    // held sums every open row of the strategy on this contract, not only the sold ones that feed
    // `migrated` (built from `shorts`, filtered by isSold): a contract id carries a right, a
    // strike and a secType, so one strategy can never hold both a long and a short row on it, and
    // `held` is therefore already the sold quantity whenever `migrated` is nonzero.
    if (takenIn.length === 0 && migrated >= held) continue;
    const source = rows[0] ?? firstSoldRow(byStrategy, taken.get(id));
    lines.push(
      line(
        {
          contract: source.contract,
          kind: LINE_KIND[source.kind] as PositionKind,
          contributions: [...rows.map(toContribution), ...takenIn],
          migrated,
        },
        priced.get(id) ?? null,
        STRATEGY_COVER_SOURCES[strategy],
      ),
    );
  }
  lines.sort(compareLines);
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
  const open = openRowsByContract(rows);
  const taken = migratedByContract(open, priced);
  const groups = linesByGroup(open, strategy, priced, taken);
  if (strategy !== "wheel") return { shares: [], groups };
  const covered = coveredCallsByTicker(groups.optionSells);
  const shares = wheelHoldings(rows).map((holding): WheelShareLine => {
    const calls = covered.get(`${holding.ticker}|${holding.currency}`) ?? { contracts: 0, strikeTotal: 0, unstruck: false };
    const averageCallStrike = calls.contracts === 0 || calls.unstruck ? null : calls.strikeTotal / calls.contracts;
    const share = priced.get(contractId(sharesContract(holding.ticker, holding.currency)));
    const lastPrice = share?.position.marketPrice ?? null;
    const day = dayShare(share?.position ?? null, holding.quantity);
    const { averageAssignmentPrice } = holding;
    return {
      ...holding,
      openCallContracts: calls.contracts,
      averageCallStrike,
      coveredShares: Math.min(holding.quantity, calls.contracts * DEFAULT_MULTIPLIER),
      lastPrice,
      unrealizedPnl: lastPrice === null || averageAssignmentPrice === null ? null : (lastPrice - averageAssignmentPrice) * holding.quantity,
      ...day,
      callStrikeBelowAssignment: averageCallStrike !== null && averageAssignmentPrice !== null && averageCallStrike < averageAssignmentPrice,
    };
  });
  // The Wheel's shares are its long positions, shown by their own table: never twice.
  return { shares, groups: { ...groups, long: [] } };
}

/**
 * The Wheel's calls that still have shares behind them, by ticker and currency: the shares card
 * counts these, not the journal's, so that "used 100/100" says what the page shows
 * (spec of sub-project 22, §3.4).
 */
function coveredCallsByTicker(sales: readonly StrategyLine[]): Map<string, { contracts: number; strikeTotal: number; unstruck: boolean }> {
  const covered = new Map<string, { contracts: number; strikeTotal: number; unstruck: boolean }>();
  for (const sale of sales) {
    if (sale.kind !== "short_call") continue;
    const key = `${sale.contract.ticker}|${sale.contract.currency}`;
    const entry = covered.get(key) ?? { contracts: 0, strikeTotal: 0, unstruck: false };
    const contracts = Math.abs(sale.quantity);
    covered.set(key, {
      contracts: entry.contracts + contracts,
      strikeTotal: entry.strikeTotal + (sale.contract.strike ?? 0) * contracts,
      unstruck: entry.unstruck || sale.contract.strike === null,
    });
  }
  return covered;
}
