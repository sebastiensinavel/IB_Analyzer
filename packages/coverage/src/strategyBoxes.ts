import { DETAIL_GROUPS, type DetailGroupId } from "./constants.ts";
import type { PositionsStrategy, StrategyLine, StrategyPositions, WheelShareLine } from "./strategy.ts";

/** The boxes that show the Wheel's assigned shares, in WHEEL_SHARE_COLUMNS (spec of sub-project 29, §2). */
export const SHARE_BOX_IDS = ["sharesUncovered", "sharesCallAbove", "sharesCallBelow"] as const;
export type ShareBoxId = (typeof SHARE_BOX_IDS)[number];

/** The boxes that show StrategyLines: the Positions groups, then the checkpoints of sub-project 29. */
export const LINE_BOX_IDS = ["long", "optionBuys", "optionSells", "other", "callSells", "putSells", "leapsUncovered", "leapsCovered"] as const;
export type LineBoxId = (typeof LINE_BOX_IDS)[number];

export type StrategyBoxId = ShareBoxId | LineBoxId;

export function isShareBoxId(id: StrategyBoxId): id is ShareBoxId {
  return (SHARE_BOX_IDS as readonly string[]).includes(id);
}

/** One line cut in two: what nothing uses, and what a sold call uses. A part of quantity 0 is `null`. */
export interface SplitLine<T> {
  uncovered: T | null;
  covered: T | null;
}

const scale = (value: number | null, ratio: number): number | null => (value === null ? null : value * ratio);

/**
 * The Wheel's shares of one ticker cut into the free part and the part its calls cover (spec §4).
 * Both parts keep the ticker's average assignment price, never the price of the lots the journal
 * would deliver: the split finds forgotten shares, it does not predict a realized P/L.
 */
export function splitWheelShares(line: WheelShareLine): SplitLine<WheelShareLine> {
  const part = (quantity: number): WheelShareLine => {
    const ratio = quantity / line.quantity;
    return {
      ...line,
      quantity,
      assignedTotal: scale(line.assignedTotal, ratio),
      unrealizedPnl: scale(line.unrealizedPnl, ratio),
      dailyPnl: scale(line.dailyPnl, ratio),
    };
  };
  const free = line.quantity - line.coveredShares;
  return {
    uncovered: free > 0 ? { ...part(free), openCallContracts: 0, averageCallStrike: null, coveredShares: 0, callStrikeBelowAssignment: false } : null,
    covered: line.coveredShares > 0 ? { ...part(line.coveredShares), coveredShares: line.coveredShares } : null,
  };
}

/** A LEAPS line cut into the free part and the part the cover uses (`used`, spec §3). */
export function splitLeaps(line: StrategyLine): SplitLine<StrategyLine> {
  const total = Math.abs(line.quantity);
  const used = line.used ?? 0;
  const part = (count: number, partUsed: number | null): StrategyLine => {
    const ratio = count / total;
    return {
      ...line,
      quantity: Math.sign(line.quantity) * count,
      marketValue: scale(line.marketValue, ratio),
      unrealizedPnl: scale(line.unrealizedPnl, ratio),
      dailyPnl: scale(line.dailyPnl, ratio),
      used: partUsed,
    };
  };
  const free = total - used;
  return {
    uncovered: free > 0 ? (free === total && line.used === null ? line : part(free, line.used === null ? null : 0)) : null,
    covered: used > 0 ? part(used, used) : null,
  };
}

/** The covered part goes above only when both prices are known and the call is at or above. */
function isCallAbove(line: WheelShareLine): boolean {
  return line.averageCallStrike !== null && line.averageAssignmentPrice !== null && line.averageCallStrike >= line.averageAssignmentPrice;
}

export interface StrategyBoxContents {
  shares: Record<ShareBoxId, WheelShareLine[]>;
  lines: Record<LineBoxId, StrategyLine[]>;
}

/**
 * Every line of a strategy's page, by box id (spec of sub-project 29). The Positions groups pass
 * through for every strategy; the Wheel and the LEAPS pages declare the checkpoint boxes instead
 * (apps/web/src/lib/strategyBoxes.ts). Computed, never stored.
 */
export function strategyBoxContents(positions: StrategyPositions, strategy: PositionsStrategy): StrategyBoxContents {
  const shares = Object.fromEntries(SHARE_BOX_IDS.map((id) => [id, [] as WheelShareLine[]])) as Record<ShareBoxId, WheelShareLine[]>;
  const lines = Object.fromEntries(LINE_BOX_IDS.map((id) => [id, [] as StrategyLine[]])) as Record<LineBoxId, StrategyLine[]>;
  for (const group of DETAIL_GROUPS) lines[group.id as DetailGroupId] = [...positions.groups[group.id]];

  const sells = positions.groups.optionSells;
  lines.callSells = sells.filter((line) => line.kind === "short_call");
  lines.putSells = sells.filter((line) => line.kind === "short_put");

  if (strategy === "wheel") {
    for (const line of positions.shares) {
      const { uncovered, covered } = splitWheelShares(line);
      if (uncovered) shares.sharesUncovered.push(uncovered);
      if (covered) (isCallAbove(covered) ? shares.sharesCallAbove : shares.sharesCallBelow).push(covered);
    }
  }
  if (strategy === "leaps") {
    for (const line of positions.groups.optionBuys) {
      const { uncovered, covered } = splitLeaps(line);
      if (uncovered) lines.leapsUncovered.push(uncovered);
      if (covered) lines.leapsCovered.push(covered);
    }
    // The LEAPS journal sells calls only; a sold put, should one appear, is never lost silently.
    lines.other = [...lines.other, ...sells.filter((line) => line.kind !== "short_call")];
  }
  return { shares, lines };
}
