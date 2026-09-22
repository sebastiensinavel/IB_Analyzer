/**
 * Ce que `packages/ledger` ne dit pas d'un niveau : sa couleur et son étiquette.
 *
 * Les teintes sont celles de la palette des graphiques, que les tons du journal empruntent
 * déjà (`lib/journalTone.ts`) : le bleu des actions assignées, l'orange des calls vendus, le
 * vert des puts vendus, et l'ambre, libre, pour les achats LEAPS.
 */
import type { ChartLevel, ChartLevelKind } from "@ib/ledger";
import type { PriceBar } from "@/agent/client";
import { chartColors } from "@/lib/chartColors";

const SERIES_INDEX: Record<ChartLevelKind, number> = {
  shares: 0,
  shortCall: 1,
  shortPut: 2,
  leapsBuy: 3,
  condor: 0,
};

export function levelColor(kind: ChartLevelKind, isDark: boolean): string {
  return chartColors(isDark).series[SERIES_INDEX[kind]];
}

/**
 * L'opacité du remplissage des rectangles d'un condor, par thème. Un même voile ne se perçoit
 * pas pareil des deux côtés : sur le fond de carte sombre, `33` ne creuse que 0,103 de ΔL
 * OKLab, un écart que l'œil ne distingue plus une fois la page entière sombre, là où `66` le
 * double sans effacer les bougies prises sous le voile.
 */
const CONDOR_FILL_ALPHA = { light: "33", dark: "66" };

/** La couleur de remplissage d'un rectangle : la teinte du niveau, voilée selon le thème. */
export function levelFill(kind: ChartLevelKind, isDark: boolean): string {
  return `${levelColor(kind, isDark)}${isDark ? CONDOR_FILL_ALPHA.dark : CONDOR_FILL_ALPHA.light}`;
}

/**
 * Le prix d'une horizontale. Un achat LEAPS n'en porte pas : il se lit au milieu haut-bas de
 * la barre de son jour d'achat, et vaut `null` si ce jour n'a pas de barre. Un condor n'a pas
 * d'horizontale du tout : ses strikes sont les bords de ses rectangles.
 */
export function levelPrice(level: ChartLevel, bars: readonly PriceBar[]): number | null {
  if (level.kind === "condor") return null;
  if (level.kind !== "leapsBuy") return level.price;
  const bar = bars.find((candidate) => candidate.date === level.when);
  return bar ? (bar.high + bar.low) / 2 : null;
}

/** `22`, `17,5` : deux décimales au plus, aucun zéro inutile, la virgule de la locale. */
export function formatLevelValue(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

/** `17,5 Put: -6`. Le mot vient de l'i18n, jamais d'ici. */
export function levelLabel(level: ChartLevel, price: number, kindWord: string, locale: string): string {
  return `${formatLevelValue(price, locale)} ${kindWord}: ${formatLevelValue(level.quantity, locale)}`;
}
