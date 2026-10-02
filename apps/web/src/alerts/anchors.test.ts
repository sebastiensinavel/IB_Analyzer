import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WheelAlert } from "@ib/alerts";
import { db } from "@/db/schema";
import { anchorPending, resetAnchorGuards, type AnchorInputs } from "./anchors";

const WHEEL: WheelAlert = {
  id: "wheel:MQZA|OPT|C|15|2026-10-16|USD", kind: "wheel", ticker: "MQZA", currency: "USD",
  contract: { symbol: "MQZA  261016C00015000", secType: "OPT", right: "C", strike: 15, expiry: "2026-10-16", multiplier: 100, currency: "USD" } as never,
  strike: 15, expiry: "2026-10-16", quantity: -2, averageAssignmentPrice: 17, saleWhen: "2026-09-29T10:30:00.000Z", fraction: 0.7, anchor: null, thresholds: null,
};

function inputs(fields: Partial<AnchorInputs>): AnchorInputs {
  return {
    snapshot: null, priceOf: () => null, port: 7502, agentPresent: true, syncedAt: "2026-09-30T18:00:00.000Z",
    observedAt: "2026-09-30T18:00:00.000Z",
    fetchBars: vi.fn(async () => ({ ok: true as const, payload: { symbol: "MQZA", fetchedAt: "x", bars: [{ date: "2026-09-29", open: 14, high: 14, low: 14, close: 14.2, volume: 1, average: 14.1 }] } })),
    ...fields,
  };
}

beforeEach(async () => {
  resetAnchorGuards();
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe("anchorPending", () => {
  it("sets S₀ from the sale day's VWAP once the live window has passed", async () => {
    await anchorPending(db, "beta", [WHEEL], inputs({}));
    expect((await db.alertStates.get(["beta", WHEEL.id]))?.anchor).toMatchObject({ price: 14.1, source: "vwap" });
  });

  it("asks the bars once per account, ticker and agent pass", async () => {
    const fetchBars = vi.fn(async () => ({ ok: false as const, code: "tws-unreachable" as const }));
    await anchorPending(db, "beta", [WHEEL], inputs({ fetchBars }));
    await anchorPending(db, "beta", [WHEEL], inputs({ fetchBars }));
    expect(fetchBars).toHaveBeenCalledTimes(1);
    await anchorPending(db, "beta", [WHEEL], inputs({ fetchBars, syncedAt: "2026-09-30T18:05:00.000Z" }));
    expect(fetchBars).toHaveBeenCalledTimes(2);
  });

  it("asks nothing without the agent", async () => {
    const fetchBars = vi.fn();
    await anchorPending(db, "beta", [WHEEL], inputs({ fetchBars, agentPresent: false }));
    expect(fetchBars).not.toHaveBeenCalled();
  });
});
