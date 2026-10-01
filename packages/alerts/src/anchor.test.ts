import { describe, expect, it } from "vitest";
import { chooseAnchor } from "./anchor.ts";

// Heure IB : le snapshot `agent` porte déjà l'heure de New York stampée UTC (`parseAgentSnapshot`).
const base = { saleWhen: "2026-09-30T14:00:00.000Z", observedAt: "2026-09-30T18:20:00Z" };
const bar = { average: 34.1, close: 34.5 };

describe("chooseAnchor", () => {
  it("lit le prix du moment quand la vente a moins de 15 minutes", () => {
    expect(chooseAnchor({ ...base, live: { price: 34, at: "2026-09-30T14:14:00.000Z" }, dayBar: bar })).toEqual({ price: 34, source: "live", observedAt: base.observedAt });
  });
  it("retombe sur le VWAP au-delà de 15 minutes", () => {
    expect(chooseAnchor({ ...base, live: { price: 34, at: "2026-09-30T14:16:00.000Z" }, dayBar: bar })?.source).toBe("vwap");
  });
  it("ne prend pas un snapshot antérieur à la vente", () => {
    expect(chooseAnchor({ ...base, live: { price: 34, at: "2026-09-30T13:59:00.000Z" }, dayBar: bar })).toEqual({ price: 34.1, source: "vwap", observedAt: base.observedAt });
  });
  it("retombe sur la clôture sans VWAP", () => {
    expect(chooseAnchor({ ...base, live: null, dayBar: { average: null, close: 34.5 } })).toEqual({ price: 34.5, source: "close", observedAt: base.observedAt });
  });
  it("rend null sans prix ni barre", () => {
    expect(chooseAnchor({ ...base, live: null, dayBar: null })).toBeNull();
  });
});
