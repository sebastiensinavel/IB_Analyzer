import { describe, expect, it } from "vitest";
import { statementExternalId, suffixTwins } from "./hash.ts";
import type { Transaction } from "@ib/ledger";

const parts = { accountId: "a", section: "Transactions", symbol: "X", when: "2025-01-01T00:00:00.000Z", quantity: 1, price: 2, amount: -2 };

describe("statementExternalId", () => {
  it("is deterministic and prefixed", () => {
    expect(statementExternalId(parts)).toBe(statementExternalId({ ...parts }));
    expect(statementExternalId(parts)).toMatch(/^html:[0-9a-f]{64}$/);
  });

  it("changes with any field, including a null amount versus zero", () => {
    expect(statementExternalId({ ...parts, amount: 0 })).not.toBe(statementExternalId({ ...parts, amount: null }));
    expect(statementExternalId({ ...parts, section: "CombDiv" })).not.toBe(statementExternalId(parts));
  });
});

describe("suffixTwins", () => {
  it("keeps the first and numbers the following identical ids in file order", () => {
    const base = { externalId: "html:abc" } as Transaction;
    const ids = suffixTwins([base, { ...base }, { externalId: "html:other" } as Transaction, { ...base }]).map((t) => t.externalId);
    expect(ids).toEqual(["html:abc", "html:abc#2", "html:other", "html:abc#3"]);
  });
});
