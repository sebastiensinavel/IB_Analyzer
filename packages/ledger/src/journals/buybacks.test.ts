import { beforeEach, describe, expect, it } from "vitest";
import { expire, option, resetIds, stock } from "./fixtures.ts";
import { pairBuybacks } from "./buybacks.ts";

beforeEach(resetIds);

const C = { ticker: "AISP", right: "C" as const, strike: 5, expiry: "2026-03-20" };
const at = (s: string) => `2026-03-02T10:${s}.000Z`;

describe("pairBuybacks", () => {
  it("pairs a share sale with a call buyback within 60 s, before or after", () => {
    const sale = stock({ ticker: "AISP", quantity: -100, price: 5.5, when: at("00:00") });
    const after = option({ ...C, quantity: 1, price: 0.1, when: at("00:40") });
    const before = option({ ...C, strike: 6, quantity: 1, price: 0.1, when: "2026-03-02T09:59:30.000Z" });
    expect(pairBuybacks([before, sale, after]).get(sale)).toEqual([before, after]);
  });

  it("ignores a buyback more than 60 s away, another ticker, a put, a sale of a call, a settlement leg", () => {
    const sale = stock({ ticker: "AISP", quantity: -100, price: 5.5, when: at("00:00") });
    const txs = [
      sale,
      option({ ...C, quantity: 1, price: 0.1, when: at("01:01") }),
      option({ ...C, ticker: "OTHER", quantity: 1, price: 0.1, when: at("00:10") }),
      option({ ...C, right: "P", quantity: 1, price: 0.1, when: at("00:10") }),
      option({ ...C, quantity: -1, price: 0.1, when: at("00:10") }),
      expire({ ...C, quantity: 1, when: at("00:10") }),
    ];
    expect(pairBuybacks(txs).get(sale) ?? []).toEqual([]);
  });

  it("pairs only sales that pay a commission, never a purchase", () => {
    const delivery = stock({ ticker: "AISP", quantity: -100, price: 5, when: at("00:00"), commission: 0 });
    const purchase = stock({ ticker: "AISP", quantity: 100, price: 5, when: at("00:00") });
    const buyback = option({ ...C, quantity: 1, price: 0.1, when: at("00:10") });
    const pairs = pairBuybacks([delivery, purchase, buyback]);
    expect(pairs.has(delivery)).toBe(false);
    expect(pairs.has(purchase)).toBe(false);
  });
});
