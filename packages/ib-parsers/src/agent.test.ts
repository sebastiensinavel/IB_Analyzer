import { describe, expect, it } from "vitest";
import { buildIdentities, buildJournals } from "@ib/ledger";
import sample from "../tests/fixtures/agent_snapshot_sample.json" with { type: "json" };
import { describeAgentContract, parseAgentSnapshot, type AgentSnapshotPayload } from "./agent.ts";
import { NormalizationError } from "./common.ts";

const ACCOUNT = "test";
const payload = sample as AgentSnapshotPayload;

function withPosition(overrides: Partial<AgentSnapshotPayload["positions"][number]>, index = 1): AgentSnapshotPayload {
  const positions = payload.positions.map((p, i) => (i === index ? { ...p, ...overrides } : p));
  return { ...payload, positions };
}

function withExecutionContract(
  overrides: Partial<AgentSnapshotPayload["executions"][number]["contract"]>,
  index = 0,
): AgentSnapshotPayload {
  const executions = payload.executions.map((e, i) => (i === index ? { ...e, contract: { ...e.contract, ...overrides } } : e));
  return { ...payload, executions };
}

/**
 * A payload with a single position (the fixture's stock, conId 265598) carrying the given `pnl`
 * overrides, and no executions unless `tradedConId` asks for one on that contract: the day-move
 * tests need full control of "traded today" rather than the fixture's own unrelated fills.
 */
function payloadWith(overrides: Partial<AgentSnapshotPayload["positions"][number]>, opts: { tradedConId?: number } = {}): AgentSnapshotPayload {
  const positions = [{ ...payload.positions[0], ...overrides }];
  const executions =
    opts.tradedConId === undefined
      ? []
      : [{ ...payload.executions[0], contract: { ...payload.executions[0].contract, conId: opts.tradedConId } }];
  return { ...payload, positions, executions };
}

describe("parseAgentSnapshot", () => {
  it("passes the envelope through and brings fetchedAt to New York's wall clock", () => {
    const snapshot = parseAgentSnapshot(payload, ACCOUNT);
    expect(snapshot.accounts).toEqual(["U0000001"]);
    expect(snapshot.fetchedAt).toBe("2026-09-06T09:02:11.482Z");
    expect(snapshot.cashAvailable).toBe(16284.37);
    expect(snapshot.issues).toEqual([]);
  });

  it("keeps an absent cash as null, never zero", () => {
    expect(parseAgentSnapshot({ ...payload, cashAvailable: null }, ACCOUNT).cashAvailable).toBeNull();
  });

  it("converts a stock position field by field", () => {
    const [stock] = parseAgentSnapshot(payload, ACCOUNT).positions;
    expect(stock).toEqual({
      symbol: "SYMA",
      secType: "STK",
      right: "",
      strike: null,
      expiry: null,
      multiplier: null,
      quantity: 100,
      avgPrice: 150.25,
      marketPrice: 172.1,
      marketValue: 17210,
      unrealizedPnl: 2185,
      dailyPnl: null,
      dayChange: null,
      currency: "USD",
      conid: "265598",
      description: "SYMA",
    });
  });

  it("brings an option's averageCost from per contract to per unit, and reads its expiry", () => {
    const [, option] = parseAgentSnapshot(payload, ACCOUNT).positions;
    expect(option).toMatchObject({
      symbol: "SYMB",
      secType: "OPT",
      right: "C",
      strike: 180,
      expiry: "2026-12-18",
      multiplier: 100,
      quantity: -1,
      avgPrice: 2.5,
      conid: "700000001",
      description: "SYMB 18DEC26 180 C",
    });
  });

  it("leaves an option without a multiplier with a null avgPrice and says so", () => {
    const snapshot = parseAgentSnapshot(withPosition({ multiplier: "" }), ACCOUNT);
    expect(snapshot.positions[1].avgPrice).toBeNull();
    expect(snapshot.positions[1].multiplier).toBeNull();
    expect(snapshot.issues).toEqual([{ severity: "warning", code: "multiplier-missing", detail: "SYMB 18DEC26 180 C" }]);
  });

  it("derives the day's move from the P&L and the value of the same message", () => {
    const { positions } = parseAgentSnapshot(payloadWith({ pnl: { dailyPnL: 100, value: 5100 } }), "alpha");

    expect(positions[0].dailyPnl).toBe(100);
    // 5100 − 100 = 5000 at yesterday's close, so +2 %.
    expect(positions[0].dayChange).toBeCloseTo(0.02, 12);
  });

  it("gives a sold position the right sign: a short that loses shows a rise", () => {
    // −540 now, +60 of P&L today: the position was worth −600 at the close, so the option rose 10 %.
    const { positions } = parseAgentSnapshot(payloadWith({ pnl: { dailyPnL: 60, value: -540 } }), "alpha");

    expect(positions[0].dayChange).toBeCloseTo(-0.1, 12);
  });

  it("keeps the day's P&L of a contract traded today but never its move", () => {
    // IB still computes dailyPnL right, from the execution price; the formula no longer can.
    const payload = payloadWith({ pnl: { dailyPnL: 100, value: 5100 } }, { tradedConId: 265598 });

    const { positions } = parseAgentSnapshot(payload, "alpha");

    expect(positions[0].dailyPnl).toBe(100);
    expect(positions[0].dayChange).toBeNull();
  });

  it("takes an older agent's payload without a pnl field", () => {
    // The agent is optional, and so is its version: features missing, never a failed sync.
    const { positions } = parseAgentSnapshot(payloadWith({}), "alpha");

    expect(positions[0].dailyPnl).toBeNull();
    expect(positions[0].dayChange).toBeNull();
  });

  it.each([
    ["a null pnl", null],
    ["a pnl without a value", { dailyPnL: 100, value: null }],
    ["a value equal to the day's P&L", { dailyPnL: 100, value: 100 }],
  ])("gives no day move for %s", (_label, pnl) => {
    const { positions } = parseAgentSnapshot(payloadWith({ pnl }), "alpha");

    expect(positions[0].dayChange).toBeNull();
  });

  it("turns a SLD option fill into a negative-quantity trade with gross proceeds and a negative commission", () => {
    const [sold] = parseAgentSnapshot(payload, ACCOUNT).transactions;
    expect(sold).toEqual({
      accountId: ACCOUNT,
      externalId: "agent:0000e1a7.68bc1234.01.01",
      source: "agent",
      kind: "trade",
      symbol: "SYMB",
      secType: "OPT",
      right: "C",
      strike: 180,
      expiry: "2026-12-18",
      quantity: -1,
      price: 2.5,
      amount: 250,
      commission: -1.05,
      currency: "USD",
      when: "2026-09-06T10:31:02.000Z",
      description: "SYMB 18DEC26 180 C",
    });
  });

  it("leaves an option fill without a multiplier with a null amount and says so, instead of the wrong hundredfold-too-small number a silent fallback to 1 would give", () => {
    const snapshot = parseAgentSnapshot(withExecutionContract({ multiplier: "" }), ACCOUNT);
    expect(snapshot.transactions[0].amount).toBeNull();
    expect(snapshot.issues).toEqual([{ severity: "warning", code: "multiplier-missing", detail: "SYMB 18DEC26 180 C" }]);
  });

  it("turns a BOT stock fill into a positive quantity, a negative amount, and keeps a missing commission null", () => {
    const [, bought] = parseAgentSnapshot(payload, ACCOUNT).transactions;
    expect(bought).toMatchObject({
      externalId: "agent:0000e1a7.68bc1234.01.02",
      symbol: "SYMA",
      secType: "STK",
      quantity: 10,
      price: 172,
      amount: -1720,
      commission: null,
      when: "2026-09-06T11:00:00.000Z",
      description: "SYMA",
    });
  });

  it("names a currency pair by its dotted localSymbol so the ledger recognises it", () => {
    const [, , forex] = parseAgentSnapshot(payload, ACCOUNT).transactions;
    expect(forex).toMatchObject({ symbol: "EUR.USD", secType: "CASH", quantity: -1000, amount: 1100, currency: "USD", commission: -2 });
  });

  it("refuses a fill without an execId: it is the dedup key", () => {
    const broken = { ...payload, executions: [{ ...payload.executions[0], execId: "" }] };
    expect(() => parseAgentSnapshot(broken, ACCOUNT)).toThrow(NormalizationError);
  });

  it("refuses a side it does not know", () => {
    const broken = { ...payload, executions: [{ ...payload.executions[0], side: "XXX" }] };
    expect(() => parseAgentSnapshot(broken, ACCOUNT)).toThrow(/side/);
  });

  it("refuses anything that is not the expected shape, naming the path", () => {
    expect(() => parseAgentSnapshot(null, ACCOUNT)).toThrow(NormalizationError);
    expect(() => parseAgentSnapshot("nope", ACCOUNT)).toThrow(NormalizationError);
    expect(() => parseAgentSnapshot({ ...payload, positions: "x" }, ACCOUNT)).toThrow(/payload\.positions/);
    expect(() => parseAgentSnapshot(withPosition({ marketPrice: "1" as unknown as number }), ACCOUNT)).toThrow(/positions\[1\]\.marketPrice/);
    expect(() => parseAgentSnapshot({ ...payload, fetchedAt: "yesterday" }, ACCOUNT)).toThrow(/fetchedAt/);
  });
});

describe("describeAgentContract", () => {
  it("writes an option the way IB's own description does", () => {
    expect(describeAgentContract({ symbol: "SYMB", localSymbol: "x", secType: "OPT", right: "P", strike: 2.5, expiry: "2028-01-21" })).toBe("SYMB 21JAN28 2.5 P");
  });

  it("falls back to the local symbol for anything else", () => {
    expect(describeAgentContract({ symbol: "EUR", localSymbol: "EUR.USD", secType: "CASH", right: "", strike: null, expiry: null })).toBe("EUR.USD");
  });
});

describe("parseAgentSnapshot contract identities", () => {
  it("derives an identity from every position and every execution", () => {
    const parsed = parseAgentSnapshot(payload, "test");
    const stock = parsed.identities.find((i) => i.tickers.includes("SYMA"));
    expect(stock).toMatchObject({ conid: "265598", secType: "STK", currency: "USD", tickers: ["SYMA"] });
  });

  it("folds a contract held and traded in the same pass into one identity", () => {
    const parsed = parseAgentSnapshot(payload, "test");
    expect(parsed.identities.filter((i) => i.conid === "265598")).toHaveLength(1);
  });

  it("has no ISIN to give: TWS does not report one", () => {
    const parsed = parseAgentSnapshot(payload, "test");
    expect(parsed.identities.every((i) => i.isin === "")).toBe(true);
  });

  it("the identities an agent pass carries change no journal line", () => {
    const parsed = parseAgentSnapshot(payload, "test");
    const inputs = parsed.identities.map((i) => ({ conid: i.conid, secType: i.secType, isin: i.isin, aliases: i.tickers.map((t) => ({ ticker: t, firstSeen: "2026-01-01", lastSeen: "2026-12-31" })) }));
    expect(buildJournals(parsed.transactions, undefined, buildIdentities(inputs))).toEqual(buildJournals(parsed.transactions));
  });

  it("gives an option the packed spelling TWS puts in localSymbol (rule 7)", () => {
    const parsed = parseAgentSnapshot(payload, ACCOUNT);
    const option = parsed.identities.find((i) => i.conid === "700000001");
    expect(option).toMatchObject({ secType: "OPT", tickers: ["SYMB  261218C00180000"] });
  });

  it("keeps the underlying when the market does not spell options in OSI", () => {
    // A non-US option: `localSymbol` is not a packed spelling, so the identity
    // carries the underlying, which rule 7 then drops — exactly as before.
    const localSymbol = "C OESX 20261218 180 M";
    const positions = payload.positions.map((p, i) => (i === 1 ? { ...p, localSymbol } : p));
    const executions = payload.executions.map((e, i) => (i === 0 ? { ...e, contract: { ...e.contract, localSymbol } } : e));
    const parsed = parseAgentSnapshot({ ...payload, positions, executions }, ACCOUNT);
    const option = parsed.identities.find((i) => i.conid === "700000001");
    expect(option?.tickers).toEqual(["SYMB"]);
  });

  it("leaves a stock and a currency pair untouched", () => {
    const parsed = parseAgentSnapshot(payload, ACCOUNT);
    expect(parsed.identities.find((i) => i.conid === "265598")?.tickers).toEqual(["SYMA"]);
    expect(parsed.identities.find((i) => i.conid === "12087792")?.tickers).toEqual(["EUR.USD"]);
  });
});
