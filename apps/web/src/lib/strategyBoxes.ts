import type { PositionsStrategy, StrategyBoxId } from "@ib/coverage";

export type { StrategyBoxId };

export interface StrategyBoxDef {
  id: StrategyBoxId;
  titleKey: string;
}

/**
 * Which boxes each strategy's positions page carries, in which order, under which title. The Wheel
 * and the LEAPS pages sort their lines by checkpoint (spec of sub-project 29): forgotten shares or
 * LEAPS first, then the calls against the assignment price, then the sales. Condors and Others keep
 * the Positions groups (sub-project 21). A declared box with no line never renders.
 */
export const STRATEGY_BOXES: Record<PositionsStrategy, readonly StrategyBoxDef[]> = {
  wheel: [
    { id: "sharesUncovered", titleKey: "strategyPositions.groups.sharesUncovered" },
    { id: "sharesCallAbove", titleKey: "strategyPositions.groups.sharesCallAbove" },
    { id: "sharesCallBelow", titleKey: "strategyPositions.groups.sharesCallBelow" },
    { id: "callSells", titleKey: "strategyPositions.groups.callSells" },
    { id: "putSells", titleKey: "strategyPositions.groups.putSells" },
  ],
  leaps: [
    { id: "leapsUncovered", titleKey: "strategyPositions.groups.leapsUncovered" },
    { id: "leapsCovered", titleKey: "strategyPositions.groups.leapsCovered" },
    { id: "callSells", titleKey: "strategyPositions.groups.callSells" },
    { id: "long", titleKey: "strategyPositions.groups.shares" },
    { id: "other", titleKey: "positions.groups.other" },
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
