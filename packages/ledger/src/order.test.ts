import { describe, expect, it } from "vitest";
import { tx } from "./fixtures.ts";
import { sortTransactions } from "./order.ts";

describe("sortTransactions", () => {
  it("orders by when, oldest first, whatever the input order", () => {
    const sorted = sortTransactions([
      tx({ externalId: "b", when: "2026-01-02T00:00:00.000Z" }),
      tx({ externalId: "a", when: "2026-01-01T00:00:00.000Z" }),
    ]);
    expect(sorted.map((t) => t.externalId)).toEqual(["a", "b"]);
  });

  it("breaks ties on when with externalId, so midnight-stamped rows stay deterministic", () => {
    const midnight = "2025-03-15T00:00:00.000Z";
    const sorted = sortTransactions([
      tx({ externalId: "html:zzz", when: midnight }),
      tx({ externalId: "html:aaa", when: midnight }),
      tx({ externalId: "html:mmm", when: midnight }),
    ]);
    expect(sorted.map((t) => t.externalId)).toEqual(["html:aaa", "html:mmm", "html:zzz"]);
  });

  it("does not mutate its input", () => {
    const input = [tx({ externalId: "b", when: "2026-01-02T00:00:00.000Z" }), tx({ externalId: "a" })];
    sortTransactions(input);
    expect(input[0].externalId).toBe("b");
  });
});
