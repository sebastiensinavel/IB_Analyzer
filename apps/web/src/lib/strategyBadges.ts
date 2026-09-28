import type { Strategy } from "@ib/ledger";

/**
 * The badge of each strategy in the history (spec of sub-project 37, §3): the hue of its role in
 * the palette — the Wheel the teal of an open line, LEAPS the violet of series 3 (the `chart-4`
 * token of index.css, redefined per theme), Condors the amber of the `spread` cover badge —, Others
 * a neutral outline. A Record, so a new strategy without its badge does not compile.
 */
export const STRATEGY_BADGE: Record<Strategy, { variant: "success" | "warning" | "outline"; className?: string }> = {
  wheel: { variant: "success" },
  leaps: { variant: "success", className: "bg-chart-4/10 text-chart-4 dark:bg-chart-4/20" },
  condors: { variant: "warning" },
  others: { variant: "outline" },
};
