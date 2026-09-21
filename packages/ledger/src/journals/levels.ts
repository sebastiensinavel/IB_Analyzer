/**
 * Les niveaux d'une stratégie sur un ticker, prêts à être dessinés sur un graphe de cours.
 *
 * Ce module ne rend ni couleur ni texte - `apps/web` s'en charge, comme pour `JournalRow.note`.
 * Une ligne est ouverte selon `endWhen === null`, jamais selon `ongoing` : un put assigné reste
 * `ongoing` tant que ses actions ne sont pas vendues alors qu'il n'est plus une vente en cours.
 */
import { wheelHoldings } from "./holdings.ts";
import type { JournalRow, Strategy } from "./types.ts";

export type ChartLevelKind = "shares" | "shortPut" | "shortCall" | "leapsBuy" | "condor";

/** Extrait la date au format YYYY-MM-DD d'un timestamp ISO. */
const dayOf = (when: string) => when.slice(0, 10);

/** Les actions Wheel détenues, à leur prix moyen d'assignation. */
export interface SharesLevel {
  kind: "shares";
  price: number;
  quantity: number;
}

/** Une vente d'options en cours : un strike, ses échéances, la quantité cumulée (négative). */
export interface OptionLevel {
  kind: "shortPut" | "shortCall";
  price: number;
  quantity: number;
  /** Jours `YYYY-MM-DD`, croissants, sans doublon. */
  expiries: string[];
}

/**
 * Un achat de call LEAPS. **Sans prix** : le journal connaît le prix payé pour l'option, pas le
 * cours du sous-jacent ce jour-là, qui se lit sur la barre du jour au moment du dessin.
 */
export interface LeapsBuyLevel {
  kind: "leapsBuy";
  /** Jour d'achat, `YYYY-MM-DD`. */
  when: string;
  quantity: number;
}

/** Un condor en cours : sa fenêtre de risque et ses deux paires de strikes, croissantes. */
export interface CondorLevel {
  kind: "condor";
  from: string;
  to: string;
  putStrikes: [number, number];
  callStrikes: [number, number];
  quantity: number;
}

export type ChartLevel = SharesLevel | OptionLevel | LeapsBuyLevel | CondorLevel;

/** Une vente d'options par strike : deux échéances au même strike ne font qu'une ligne. */
function optionLevels(rows: readonly JournalRow[], kind: "short_put" | "short_call"): OptionLevel[] {
  const byStrike = new Map<number, OptionLevel>();
  for (const row of rows) {
    if (row.kind !== kind) continue;
    const expiry = row.contract.expiry;
    if (row.strike === null || expiry === null || row.quantity === null) continue;
    const level = byStrike.get(row.strike) ?? {
      kind: kind === "short_put" ? ("shortPut" as const) : ("shortCall" as const),
      price: row.strike,
      quantity: 0,
      expiries: [],
    };
    level.quantity += row.quantity;
    if (!level.expiries.includes(expiry)) level.expiries.push(expiry);
    byStrike.set(row.strike, level);
  }
  return [...byStrike.values()]
    .map((level) => ({ ...level, expiries: [...level.expiries].sort() }))
    .sort((a, b) => a.price - b.price);
}

/** Les achats de calls LEAPS ouverts : un niveau par ligne, le prix viendra de la barre du jour. */
function leapsBuyLevels(rows: readonly JournalRow[]): LeapsBuyLevel[] {
  return rows
    .filter((row) => row.strategy === "leaps" && row.kind === "long_call" && row.quantity !== null)
    .map((row) => ({ kind: "leapsBuy" as const, when: dayOf(row.startWhen), quantity: row.quantity as number }))
    .sort((a, b) => a.when.localeCompare(b.when));
}

/**
 * Les condors en cours, de leur ouverture à leur échéance - la fenêtre de risque, pas la
 * fenêtre vécue. Les quatre jambes sont dans l'ordre garanti par `condor.ts` : long put,
 * short put, short call, long call, strikes croissants.
 */
function condorLevels(rows: readonly JournalRow[]): CondorLevel[] {
  const levels: CondorLevel[] = [];
  for (const row of rows) {
    if (row.kind !== "condor" || row.quantity === null) continue;
    const expiry = row.contract.expiry;
    const legs = row.legs;
    if (expiry === null || legs === undefined || legs.length !== 4) continue;
    const strikes = legs.map((leg) => leg.strike);
    if (strikes.some((strike) => strike === null)) continue;
    const [longPut, shortPut, shortCall, longCall] = strikes as number[];
    levels.push({
      kind: "condor",
      from: dayOf(row.startWhen),
      to: expiry,
      putStrikes: [longPut, shortPut],
      callStrikes: [shortCall, longCall],
      quantity: row.quantity,
    });
  }
  return levels;
}

export function strategyLevels(
  rows: readonly JournalRow[],
  ticker: string,
  strategies: readonly Strategy[],
): ChartLevel[] {
  const scoped = rows.filter(
    (row) => row.ticker === ticker && strategies.includes(row.strategy) && row.endWhen === null,
  );
  const levels: ChartLevel[] = [];

  if (strategies.includes("wheel")) {
    // wheelHoldings lit lui-même les lignes Wheel ouvertes : on lui passe le ledger entier.
    for (const holding of wheelHoldings(rows)) {
      if (holding.ticker !== ticker || holding.quantity === 0 || holding.averageAssignmentPrice === null) continue;
      levels.push({ kind: "shares", price: holding.averageAssignmentPrice, quantity: holding.quantity });
    }
  }

  levels.push(...optionLevels(scoped, "short_put"));
  levels.push(...optionLevels(scoped, "short_call"));
  levels.push(...leapsBuyLevels(scoped));
  levels.push(...condorLevels(scoped));
  return levels;
}
