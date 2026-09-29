import type { PriceBar } from "@/agent/client";
import { marketDaysBefore } from "@/demo/calendar";

/**
 * Synthetic prices of the demo (sub-project 41, spec §5.1): a path per ticker drawn around
 * anchor levels, indexed by market days before the reference day, so the story reads the same
 * whatever the day of the visit. Never IB's market data.
 */
export const MAX_AGO = 520;

/** [market days ago, level] pairs, oldest first; linear between them. */
const ANCHORS: Record<string, readonly (readonly [number, number])[]> = {
  AAPL: [[520, 165], [380, 175], [300, 160], [220, 185], [120, 205], [0, 228]],
  AMD: [[520, 150], [380, 160], [300, 120], [200, 125], [100, 135], [0, 138]],
  KO: [[520, 58], [380, 60], [250, 63], [150, 61], [0, 66]],
  MSFT: [[520, 380], [380, 400], [250, 430], [150, 410], [60, 445], [0, 470]],
  NVDA: [[520, 110], [380, 120], [250, 135], [120, 150], [0, 175]],
  JPM: [[520, 180], [380, 195], [250, 205], [100, 230], [0, 245]],
  DIS: [[520, 95], [380, 100], [250, 92], [100, 105], [0, 112]],
  SPY: [[520, 500], [380, 520], [250, 545], [120, 560], [0, 590]],
};

export const DEMO_TICKERS = [...Object.keys(ANCHORS), "XSP"] as const;

export const VOLATILITY: Record<string, number> = { AAPL: 0.25, AMD: 0.45, KO: 0.15, MSFT: 0.25, NVDA: 0.45, JPM: 0.22, DIS: 0.28, SPY: 0.15, XSP: 0.15 };

function seedOf(ticker: string): number {
  let h = 2166136261;
  for (const c of ticker) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** mulberry32: a small deterministic generator. */
function generator(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function anchorAt(ticker: string, ago: number): number {
  const points = ANCHORS[ticker];
  for (let i = 0; i < points.length - 1; i += 1) {
    const [a0, p0] = points[i];
    const [a1, p1] = points[i + 1];
    if (ago <= a0 && ago >= a1) return p0 + ((a0 - ago) / (a0 - a1)) * (p1 - p0);
  }
  return points.at(-1)![1];
}

const round2 = (x: number) => Math.round(x * 100) / 100;

interface Path {
  close: number[];
  open: number[];
  high: number[];
  low: number[];
  volume: number[];
}

const paths = new Map<string, Path>();

function pathOf(ticker: string): Path {
  const base = ticker === "XSP" ? "SPY" : ticker;
  const cached = paths.get(base);
  if (cached) return cached;
  const next = generator(seedOf(base));
  const normal = () => Math.sqrt(-2 * Math.log(next() || 1e-12)) * Math.cos(2 * Math.PI * next());
  const path: Path = { close: [], open: [], high: [], low: [], volume: [] };
  let noise = 0;
  let previous = anchorAt(base, MAX_AGO);
  for (let ago = MAX_AGO; ago >= 0; ago -= 1) {
    noise = 0.9 * noise + 0.012 * normal();
    const close = round2(anchorAt(base, ago) * (1 + noise));
    const open = round2(previous * (1 + 0.004 * normal()));
    const spread = Math.abs(0.008 * normal());
    path.close[ago] = close;
    path.open[ago] = open;
    path.high[ago] = round2(Math.max(open, close) * (1 + spread));
    path.low[ago] = round2(Math.min(open, close) * (1 - spread));
    path.volume[ago] = Math.round(1_000_000 * (1 + next()));
    previous = close;
  }
  paths.set(base, path);
  return path;
}

/** Close `ago` market days before the reference day (XSP follows SPY). */
export function closeAgo(ticker: string, ago: number): number {
  return pathOf(ticker).close[ago];
}

/** Daily bars, oldest first, the last one dated `reference`; dates are YYYY-MM-DD like the agent's `/bars`. */
export function barsFor(ticker: string, reference: string): PriceBar[] {
  const path = pathOf(ticker);
  const bars: PriceBar[] = [];
  for (let ago = MAX_AGO; ago >= 0; ago -= 1) {
    bars.push({ date: marketDaysBefore(reference, ago), open: path.open[ago], high: path.high[ago], low: path.low[ago], close: path.close[ago], volume: path.volume[ago] });
  }
  return bars;
}

export function optionMark(spot: number, strike: number, right: "C" | "P", days: number, vol: number): number {
  const intrinsic = right === "C" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  const sd = spot * vol * Math.sqrt(Math.max(days, 0) / 365);
  const timeValue = sd === 0 ? 0 : 0.4 * sd * Math.exp(-(((spot - strike) / sd) ** 2) / 2);
  return Math.max(0.01, round2(intrinsic + timeValue));
}
