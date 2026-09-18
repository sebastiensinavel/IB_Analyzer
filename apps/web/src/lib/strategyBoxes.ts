import type { DetailGroupId, PositionsStrategy } from "@ib/coverage";

/** A box of a strategy's positions page: a group of DETAIL_GROUPS, or the Wheel's assigned shares. */
export type StrategyBoxId = DetailGroupId | "shares";

export interface StrategyBoxDef {
  id: StrategyBoxId;
  titleKey: string;
}

/**
 * Which boxes each strategy's positions page carries, in which order, under which title (spec of
 * sub-project 21, §4.2). The orders and the titles the Wheel and the LEAPS pages already had do
 * not move; the shared group titles carry the same words, so they are used everywhere else.
 *
 * A declared box with no line never renders: the Wheel shows no "Option buys" because it holds
 * none, and the Condors show wings only when they have some.
 */
export const STRATEGY_BOXES: Record<PositionsStrategy, readonly StrategyBoxDef[]> = {
  wheel: [
    { id: "shares", titleKey: "strategyPositions.groups.assignedShares" },
    { id: "optionSells", titleKey: "positions.groups.optionSells" },
  ],
  leaps: [
    { id: "optionBuys", titleKey: "positions.groups.optionBuys" },
    { id: "optionSells", titleKey: "positions.groups.optionSells" },
    { id: "long", titleKey: "strategyPositions.groups.shares" },
  ],
  condors: [
    { id: "optionBuys", titleKey: "positions.groups.optionBuys" },
    { id: "optionSells", titleKey: "positions.groups.optionSells" },
  ],
  others: [
    { id: "long", titleKey: "positions.groups.long" },
    { id: "optionBuys", titleKey: "positions.groups.optionBuys" },
    { id: "optionSells", titleKey: "positions.groups.optionSells" },
    { id: "other", titleKey: "positions.groups.other" },
  ],
};
