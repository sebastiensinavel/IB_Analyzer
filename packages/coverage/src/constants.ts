// The one place where the business constants of the coverage engine live.
// Nothing outside this package may redefine them (apps/web has a test for it).

/** A short option is bought back when current <= sale / BUYBACK_RATIO. */
export const BUYBACK_RATIO = 2;

/**
 * Options multiplier when the contract does not report one. Defined in
 * `@ib/ledger`: the journals engine needs the same number and cannot import
 * this package without making a cycle.
 */
export { DEFAULT_MULTIPLIER } from "@ib/ledger";

/** A defined-risk structure must not be able to lose more than this, in USD. */
export const MAX_STRUCTURE_LOSS = 1000;

/** A sector-table ticker is suggested from this score up. */
export const MIN_SUGGESTION_SCORE = 6;

/** The dashboard suggests at most this many tickers. */
export const MAX_SUGGESTIONS = 20;

/** A ticker already weighing this share of the account's total risk value, or more, is never suggested. */
export const MAX_SUGGESTION_TICKER_SHARE = 0.05;

export const POSITION_KINDS = [
  "short_call",
  "short_put",
  "long_call",
  "long_put",
  "long_stock",
  "short_stock",
  "other",
] as const;
export type PositionKind = (typeof POSITION_KINDS)[number];

/** Human-readable labels, shown as is (English, as the Python engine produced them). */
export const KIND_LABELS: Record<PositionKind, string> = {
  short_call: "sell of call",
  short_put: "sell of put",
  long_call: "buy of call",
  long_put: "buy of put",
  long_stock: "long",
  short_stock: "short position",
  other: "other",
};

/** Kinds that get a buy-back decision. Everything else is ignored. */
export const EVALUATE_KINDS: ReadonlySet<PositionKind> = new Set<PositionKind>(["short_call", "short_put"]);

export const COVER_SOURCES = ["cash", "stock", "leaps", "spread", "UNCOVERED"] as const;
export type CoverSource = (typeof COVER_SOURCES)[number];
export const COVER_CASH: CoverSource = "cash"; // short put fully secured by USD cash
export const COVER_STOCK: CoverSource = "stock"; // short call covered by long shares
export const COVER_LEAPS: CoverSource = "leaps"; // short call covered by a longer-dated long call
export const COVER_SPREAD: CoverSource = "spread"; // leg of a same-expiry defined-risk structure
export const COVER_NONE: CoverSource = "UNCOVERED"; // nothing behind the leg

export const STRUCTURE_KINDS = ["iron condor", "call spread", "put spread"] as const;
export type StructureKind = (typeof STRUCTURE_KINDS)[number];
export const STRUCT_IRON_CONDOR: StructureKind = "iron condor";
export const STRUCT_CALL_SPREAD: StructureKind = "call spread";
export const STRUCT_PUT_SPREAD: StructureKind = "put spread";

export type DetailGroupId = "long" | "optionBuys" | "optionSells" | "other";

export interface DetailGroup {
  id: DetailGroupId;
  /** English title, as the Python engine named the group. */
  title: string;
  /** `null` catches every kind the other groups do not. */
  kinds: ReadonlySet<PositionKind> | null;
}

/** Sub-sections of the position table, in display order. */
export const DETAIL_GROUPS: readonly DetailGroup[] = [
  { id: "long", title: "Long positions", kinds: new Set<PositionKind>(["long_stock"]) },
  { id: "optionBuys", title: "Option buys", kinds: new Set<PositionKind>(["long_call", "long_put"]) },
  { id: "optionSells", title: "Option sells", kinds: new Set<PositionKind>(["short_call", "short_put"]) },
  { id: "other", title: "Other positions", kinds: null },
];
