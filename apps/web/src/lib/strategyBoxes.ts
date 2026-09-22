import type { PositionsStrategy, StrategyBoxId } from "@ib/coverage";

export type { StrategyBoxId };

export interface StrategyBoxDef {
  id: StrategyBoxId;
  titleKey: string;
}

/**
 * Which boxes each strategy's positions page carries, in which order, under which title. The Wheel
 * and the LEAPS pages sort their lines by checkpoint (spec of sub-project 29). The Wheel opens on its
 * put sales, then the forgotten shares, then the calls struck below the assignment price before
 * those at or above it — the most critical first —, then the call sales; the LEAPS open on the
 * forgotten LEAPS, then the covered ones, then the sales. Condors and Others keep the Positions
 * groups (sub-project 21). A declared box with no line never renders.
 */
export const STRATEGY_BOXES: Record<PositionsStrategy, readonly StrategyBoxDef[]> = {
  wheel: [
    { id: "putSells", titleKey: "strategyPositions.groups.putSells" },
    { id: "sharesUncovered", titleKey: "strategyPositions.groups.sharesUncovered" },
    { id: "sharesCallBelow", titleKey: "strategyPositions.groups.sharesCallBelow" },
    { id: "sharesCallAbove", titleKey: "strategyPositions.groups.sharesCallAbove" },
    { id: "callSells", titleKey: "strategyPositions.groups.callSells" },
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
