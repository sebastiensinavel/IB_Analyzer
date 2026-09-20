import type { JournalRow } from "@ib/ledger";

export type LabelTone = "shares" | "shortCall" | "open";

/** Spec §7.1: what the Label cell's background says about an open line. */
export function labelTone(row: JournalRow): LabelTone | null {
  if (!row.ongoing) return null;
  // A Wheel holding is a Wheel holding whether an option delivered it or the
  // strategy took it over: `assigned` says how it arrived, not where it is.
  if (row.kind === "shares") return row.assigned || row.strategy === "wheel" ? "shares" : null;
  if (row.kind === "short_call") return "shortCall";
  // A put stays `ongoing` after its assignment, until the shares it delivered are sold: the
  // green would then say what the blue of those shares already says, so it stops at assignment.
  if (row.kind === "short_put") return row.assigned ? null : "open";
  if (row.kind === "long_call" || row.kind === "condor") return "open";
  return null;
}

// Light: tokens from src/index.css. Dark: those barely show on the card, so a tone takes the hue
// of a line of the dark capital chart (CHART_COLORS.dark.series) — Assigned, Cumulative P/L, Allocated.
export const LABEL_TONE_CLASS: Record<LabelTone, string> = {
  shares: "bg-primary/15 dark:bg-[#3987e5]/70",
  shortCall: "bg-warning/25 dark:bg-[#d95926]/70",
  open: "bg-success/15 dark:bg-[#199e70]/70",
};
