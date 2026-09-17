import {
  COVER_CASH,
  COVER_LEAPS,
  COVER_SPREAD,
  COVER_STOCK,
  STRUCT_CALL_SPREAD,
  STRUCT_IRON_CONDOR,
  STRUCT_PUT_SPREAD,
  type StructureKind,
} from "./constants.ts";
import { fmtFixed2, fmtMoney, fmtNum } from "./format.ts";
import type { AnalyzedPosition, Structure } from "./types.ts";

// Every short option must be backed by something, otherwise the loss is
// unbounded. Three coverage families, allocated in this order, quantities
// consumed as they are used so a long leg never covers two short legs:
//   1. defined-risk structures (iron condors, vertical spreads): same
//      underlying AND same expiry, loss capped by the strike width;
//   2. short calls: long shares, then longer-dated long calls (LEAPS);
//   3. short puts: USD cash only, no leverage.

/** "2026-01-16" -> "20260116"; a bare month "202601" is the end of that month. */
export function normalizeExpiry(expiry: string): string {
  const raw = expiry.replaceAll("-", "").trim();
  return raw.length === 6 ? `${raw}31` : raw;
}

/** A normalized expiry back to YYYY-MM-DD; anything else passes through. */
export function fmtExpiry(expiry: string): string {
  const raw = normalizeExpiry(expiry);
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}` : raw;
}

/** A long position with the quantity still available as coverage. */
interface LongPool {
  pos: AnalyzedPosition;
  remaining: number;
}

/** Quantity of each short leg still waiting for coverage (Python used id(p)). */
type Remaining = Map<AnalyzedPosition, number>;

function resetCoverage(positions: AnalyzedPosition[]): void {
  for (const pos of positions) {
    pos.allocations = [];
    pos.uncoveredQuantity = 0;
    pos.usedQuantity = 0;
    pos.requiredCash = 0;
    pos.riskNotes = [];
  }
}

/** Python's min(items, key=...): the first item among the smallest keys. */
function minBy<T>(items: readonly T[], key: (item: T) => readonly [number, number]): T {
  let best = items[0];
  let bestKey = key(best);
  for (const item of items.slice(1)) {
    const k = key(item);
    if (k[0] < bestKey[0] || (k[0] === bestKey[0] && k[1] < bestKey[1])) {
      best = item;
      bestKey = k;
    }
  }
  return best;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Attribute coverage to every short option and return the structures found.
 * The positions are mutated in place: allocations, uncovered quantities,
 * required cash and risk notes are filled in. Idempotent.
 */
export function computeCoverage(positions: AnalyzedPosition[]): Structure[] {
  resetCoverage(positions);
  const bySymbol = new Map<string, AnalyzedPosition[]>();
  for (const pos of positions) {
    const group = bySymbol.get(pos.symbol);
    if (group) group.push(pos);
    else bySymbol.set(pos.symbol, [pos]);
  }
  const structures: Structure[] = [];
  for (const symbol of [...bySymbol.keys()].sort(compareStrings)) {
    structures.push(...coverSymbol(symbol, bySymbol.get(symbol) ?? []));
  }
  return structures;
}

function coverSymbol(symbol: string, group: AnalyzedPosition[]): Structure[] {
  const stockPool: LongPool[] = group
    .filter((p) => p.kind === "long_stock" && p.quantity > 0)
    .map((p) => ({ pos: p, remaining: p.quantity }));
  const longCalls: LongPool[] = group
    .filter((p) => p.kind === "long_call" && p.quantity > 0)
    .map((p) => ({ pos: p, remaining: Math.abs(p.quantity) }));
  const longPuts: LongPool[] = group
    .filter((p) => p.kind === "long_put" && p.quantity > 0)
    .map((p) => ({ pos: p, remaining: Math.abs(p.quantity) }));
  const shortCalls = group.filter((p) => p.kind === "short_call");
  const shortPuts = group.filter((p) => p.kind === "short_put");
  const remaining: Remaining = new Map([...shortCalls, ...shortPuts].map((p) => [p, Math.abs(p.quantity)]));

  const structures = buildStructures(symbol, shortCalls, shortPuts, longCalls, longPuts, remaining);
  coverShortCalls(shortCalls, stockPool, longCalls, remaining);
  secureShortPuts(shortPuts, remaining);
  return structures;
}

// --- Pass 1: same-expiry defined-risk structures ---------------------------

function buildStructures(
  symbol: string,
  shortCalls: AnalyzedPosition[],
  shortPuts: AnalyzedPosition[],
  longCalls: LongPool[],
  longPuts: LongPool[],
  remaining: Remaining,
): Structure[] {
  const structures: Structure[] = [];
  const expiries = [
    ...new Set([...shortCalls, ...shortPuts].filter((p) => p.expiry).map((p) => normalizeExpiry(p.expiry))),
  ].sort(compareStrings);

  for (const expiry of expiries) {
    const legsSc = shortCalls.filter((p) => normalizeExpiry(p.expiry) === expiry);
    const legsSp = shortPuts.filter((p) => normalizeExpiry(p.expiry) === expiry);
    const legsLc = longCalls.filter((l) => normalizeExpiry(l.pos.expiry) === expiry);
    const legsLp = longPuts.filter((l) => normalizeExpiry(l.pos.expiry) === expiry);

    const [callRisk, callCredit, callQty] = pairLegs(legsSc, legsLc, remaining, true);
    const [putRisk, putCredit, putQty] = pairLegs(legsSp, legsLp, remaining, false);

    if (callQty <= 0 && putQty <= 0) continue;

    let kind: StructureKind;
    if (callQty > 0 && putQty > 0) kind = STRUCT_IRON_CONDOR;
    else if (callQty > 0) kind = STRUCT_CALL_SPREAD;
    else kind = STRUCT_PUT_SPREAD;

    structures.push({
      symbol,
      expiry: fmtExpiry(expiry),
      kind,
      contracts: callQty + putQty,
      callRisk,
      putRisk,
      credit: callCredit + putCredit,
    });
  }
  return structures;
}

/**
 * Cover short legs with long legs of the same expiry. Returns [worst case in
 * USD, net credit in USD, contracts matched]. A long leg on the protective
 * side caps the loss at the strike width; a long leg beyond it removes the
 * risk entirely.
 */
function pairLegs(
  shorts: AnalyzedPosition[],
  longs: LongPool[],
  remaining: Remaining,
  isCall: boolean,
): [number, number, number] {
  // Walk the shorts from the strike closest to the money outwards, so the
  // riskiest leg gets the tightest protection available.
  const ordered = [...shorts].sort((a, b) => (isCall ? a.strike - b.strike : b.strike - a.strike));

  let totalRisk = 0;
  let totalCredit = 0;
  let matched = 0;

  for (const short of ordered) {
    let need = remaining.get(short) ?? 0;
    while (need > 0) {
      const candidates = longs.filter((l) => l.remaining > 0);
      if (candidates.length === 0) break;
      const best = minBy(candidates, (l) => pairCost(short, l.pos, isCall));
      const take = Math.min(need, best.remaining);
      const width = strikeWidth(short, best.pos, isCall);

      totalRisk += width * short.multiplier * take;
      totalCredit += (Math.abs(short.avgPrice ?? 0) - Math.abs(best.pos.avgPrice ?? 0)) * short.multiplier * take;
      short.allocations.push({ source: COVER_SPREAD, quantity: take, detail: best.pos.description });
      best.pos.usedQuantity += take;
      best.remaining -= take;
      need -= take;
      matched += take;
    }
    remaining.set(short, need);
  }
  return [totalRisk, totalCredit, matched];
}

/** Distance the underlying can travel against the short leg before the long leg takes over. */
function strikeWidth(short: AnalyzedPosition, long: AnalyzedPosition, isCall: boolean): number {
  return isCall ? Math.max(0, long.strike - short.strike) : Math.max(0, short.strike - long.strike);
}

/** Least resulting risk first; among equals, the leg closest to the short strike. */
function pairCost(short: AnalyzedPosition, long: AnalyzedPosition, isCall: boolean): [number, number] {
  return [strikeWidth(short, long, isCall), isCall ? -long.strike : long.strike];
}

// --- Pass 2: short calls covered by stock and LEAPS ------------------------

function coverShortCalls(
  shortCalls: AnalyzedPosition[],
  stockPool: LongPool[],
  longCalls: LongPool[],
  remaining: Remaining,
): void {
  const stockCost = weightedAvgCost(stockPool);
  const ordered = [...shortCalls].sort(
    (a, b) => compareStrings(normalizeExpiry(a.expiry), normalizeExpiry(b.expiry)) || a.strike - b.strike,
  );

  for (const short of ordered) {
    let need = remaining.get(short) ?? 0;
    if (need <= 0) {
      short.uncoveredQuantity = 0;
      continue;
    }

    // a) Long shares. One contract needs `multiplier` shares.
    const availableShares = stockPool.reduce((sum, l) => sum + l.remaining, 0);
    if (availableShares > 0 && short.multiplier > 0) {
      const coverable = Math.floor(availableShares / short.multiplier);
      const take = Math.min(need, coverable);
      if (take > 0) {
        const shares = take * short.multiplier;
        consumeShares(stockPool, shares);
        short.allocations.push({
          source: COVER_STOCK,
          quantity: take,
          detail: `${fmtNum(shares)} shares @ ${fmtFixed2(stockCost)}`,
        });
        if (short.strike < stockCost) {
          short.riskNotes.push(`strike ${fmtNum(short.strike)} below stock cost ${fmtFixed2(stockCost)}`);
        }
        need -= take;
      }
    }

    // b) Longer-dated long calls. Same expiry was already a spread in pass 1.
    while (need > 0) {
      const candidates = longCalls.filter(
        (l) => l.remaining > 0 && normalizeExpiry(l.pos.expiry) > normalizeExpiry(short.expiry),
      );
      if (candidates.length === 0) break;
      const best = minBy(candidates, (l) => pairCost(short, l.pos, true));
      const take = Math.min(need, best.remaining);
      short.allocations.push({ source: COVER_LEAPS, quantity: take, detail: best.pos.description });
      if (short.strike < best.pos.strike) {
        short.riskNotes.push(
          `strike ${fmtNum(short.strike)} below LEAPS strike ${fmtNum(best.pos.strike)} (${best.pos.description})`,
        );
      }
      best.pos.usedQuantity += take;
      best.remaining -= take;
      need -= take;
    }

    remaining.set(short, need);
    short.uncoveredQuantity = need;
  }
}

/** Average purchase price of the long shares of one underlying. */
function weightedAvgCost(stockPool: LongPool[]): number {
  const total = stockPool.reduce((sum, l) => sum + l.pos.quantity, 0);
  if (total <= 0) return 0;
  return stockPool.reduce((sum, l) => sum + (l.pos.avgPrice ?? 0) * l.pos.quantity, 0) / total;
}

/** Draw `shares` from the pool, first entry first. */
function consumeShares(stockPool: LongPool[], shares: number): void {
  let left = shares;
  for (const lot of stockPool) {
    if (left <= 0) break;
    const take = Math.min(left, lot.remaining);
    lot.remaining -= take;
    lot.pos.usedQuantity += take;
    left -= take;
  }
}

// --- Pass 3: short puts secured by cash ------------------------------------

/** strike x multiplier per contract, no leverage: the cash that has to sit in the account. */
function secureShortPuts(shortPuts: AnalyzedPosition[], remaining: Remaining): void {
  for (const short of shortPuts) {
    const need = remaining.get(short) ?? 0;
    if (need <= 0) continue;
    short.requiredCash = short.strike * short.multiplier * need;
    short.allocations.push({ source: COVER_CASH, quantity: need, detail: `${fmtMoney(short.requiredCash)} USD` });
    remaining.set(short, 0);
  }
}
