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

// primary et success sont tous deux teal (sous-projet 31) : chaque ton prend la teinte de la
// courbe de capital de son rôle (CHART_COLORS.*.series) — actions bleu « P/L cumulé », call
// vendu or « Assigné », ouvert teal « Alloué ». En sombre à /45 : à /70 le texte clair n'y
// garde qu'un contraste de 3,3.
export const LABEL_TONE_CLASS: Record<LabelTone, string> = {
  shares: "bg-[#3b78e7]/15 dark:bg-[#6c9ef8]/45",
  shortCall: "bg-[#d08a10]/25 dark:bg-[#e6b04a]/45",
  open: "bg-[#0e9f90]/15 dark:bg-[#2bc4b4]/45",
};
