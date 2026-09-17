import { describe, expect, it } from "vitest";

// Every business constant of the coverage engine lives in @ib/coverage.
// A page that redefined one would silently drift from the engine.
const sources = import.meta.glob("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const FORBIDDEN = [
  /\b(BUYBACK_RATIO|MAX_STRUCTURE_LOSS|DEFAULT_MULTIPLIER|MIN_SUGGESTION_SCORE|MAX_SUGGESTIONS|MAX_SUGGESTION_TICKER_SHARE)\s*=/,
  /["'](sell of (call|put)|buy of (call|put)|iron condor|call spread|put spread)["']/,
];

describe("business constants", () => {
  it("are never redefined in apps/web", () => {
    const offenders = Object.entries(sources)
      // Tests may name a kind to assert on it; production code may not.
      .filter(([path]) => !/\.test\.tsx?$/.test(path))
      .filter(([, text]) => FORBIDDEN.some((re) => re.test(text)))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
