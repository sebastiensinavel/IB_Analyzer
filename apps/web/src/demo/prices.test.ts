import { expect, it, vi } from "vitest";
import { DEMO_TICKERS, MAX_AGO, barsFor, closeAgo, optionMark } from "@/demo/prices";

it("is deterministic and never uses Math.random", () => {
  const spy = vi.spyOn(Math, "random");
  expect(closeAgo("AAPL", 100)).toBe(closeAgo("AAPL", 100));
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});

it("gives every ticker a positive, plausible path", () => {
  for (const ticker of DEMO_TICKERS) {
    for (let ago = 0; ago <= MAX_AGO; ago += 1) expect(closeAgo(ticker, ago)).toBeGreaterThan(1);
  }
});

it("prices XSP on SPY", () => {
  expect(closeAgo("XSP", 10)).toBe(closeAgo("SPY", 10));
});

it("ends the bars on the reference day with its close", () => {
  const bars = barsFor("MSFT", "2026-09-25");
  expect(bars).toHaveLength(MAX_AGO + 1);
  expect(bars.at(-1)).toMatchObject({ date: "2026-09-25", close: closeAgo("MSFT", 0) });
  expect(bars.every((b) => b.low <= Math.min(b.open, b.close) && b.high >= Math.max(b.open, b.close))).toBe(true);
});

it("prices an option at intrinsic plus time value", () => {
  expect(optionMark(100, 90, "C", 0, 0.25)).toBe(10);
  expect(optionMark(100, 110, "C", 0, 0.25)).toBe(0.01);
  expect(optionMark(100, 100, "P", 30, 0.25)).toBeGreaterThan(optionMark(100, 90, "P", 30, 0.25));
});
