import type { Strategy } from "@ib/ledger";

/**
 * The badge of each strategy in the history (spec of sub-project 37, §3): the hue of its role in
 * the palette — the Wheel the teal of an open line, LEAPS the violet of series 3, Condors the amber
 * of the `spread` cover badge —, Others a neutral outline. A Record, so a new strategy without its
 * badge does not compile. The violet mirrors CHART_COLORS.series[3] in both themes.
 */
export const STRATEGY_BADGE: Record<Strategy, { variant: "success" | "warning" | "outline"; className?: string }> = {
  wheel: { variant: "success" },
  leaps: { variant: "success", className: "bg-[#7b5ce5]/10 text-[#7b5ce5] dark:bg-[#a28bf5]/20 dark:text-[#a28bf5]" },
  condors: { variant: "warning" },
  others: { variant: "outline" },
};
