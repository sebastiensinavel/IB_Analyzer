import { expect, it } from "vitest";
import { parseAgentQuotes, parseAgentSnapshot } from "@ib/ib-parsers";
import { demoAgentJson } from "@/demo/agent";
import { generateDemo } from "@/demo/generate";

const NOW = new Date("2026-09-25T19:00:00Z");

it("answers /snapshot in the agent's own format, for the demo IB account", () => {
  const result = demoAgentJson("/snapshot?port=7496", NOW);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const parsed = parseAgentSnapshot(result.payload, "demo");
  expect(parsed.accounts).toEqual(["U0000000"]);
  expect(parsed.transactions).toEqual([]);
  const world = generateDemo(NOW);
  const qty = (ps: { symbol: string; quantity: number; strike: number | null }[]) => ps.map((p) => `${p.symbol}|${p.strike}|${p.quantity}`).sort();
  expect(qty(parsed.positions)).toEqual(qty(world.positions));
  expect(parsed.positions.some((p) => p.dailyPnl !== null && p.dayChange !== null)).toBe(true);
});

it("answers /bars with two years ending on the reference day", () => {
  const result = demoAgentJson("/bars?port=7496&symbol=MSFT&currency=USD", NOW);
  expect(result.ok && (result.payload as { bars: unknown[] }).bars.length).toBe(521);
});

it("answers /quotes for the indices too", () => {
  const result = demoAgentJson("/quotes?port=1&indices=XSP:CBOE", NOW);
  expect(result.ok).toBe(true);
  if (result.ok) {
    const quotes = parseAgentQuotes(result.payload);
    expect(quotes.get("XSP")?.last).not.toBeNull();
    expect(quotes.get("XSP")?.change).not.toBeNull();
  }
});

it("answers /quotes with last and close", () => {
  const result = demoAgentJson("/quotes?port=7496&symbols=AAPL%2CKO", NOW);
  expect(result.ok).toBe(true);
  if (result.ok) expect([...parseAgentQuotes(result.payload).keys()].sort()).toEqual(["AAPL", "KO"]);
});
