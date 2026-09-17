/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_MULTIPLIER as fromLedger } from "@ib/ledger";
import {
  BUYBACK_RATIO,
  DEFAULT_MULTIPLIER,
  DETAIL_GROUPS,
  EVALUATE_KINDS,
  KIND_LABELS,
  MAX_STRUCTURE_LOSS,
  POSITION_KINDS,
} from "./constants.ts";

describe("constants", () => {
  it("gives every kind a label", () => {
    for (const kind of POSITION_KINDS) expect(KIND_LABELS[kind]).toBeTruthy();
  });

  it("evaluates short options and nothing else", () => {
    expect([...EVALUATE_KINDS].sort()).toEqual(["short_call", "short_put"]);
  });

  it("has exactly one catch-all group, last", () => {
    const catchAll = DETAIL_GROUPS.filter((g) => g.kinds === null);
    expect(catchAll).toHaveLength(1);
    expect(DETAIL_GROUPS.at(-1)?.kinds).toBeNull();
  });
});

describe("business constants", () => {
  it("keeps the coverage engine's own constants here", () => {
    expect(BUYBACK_RATIO).toBe(2);
    expect(MAX_STRUCTURE_LOSS).toBe(1000);
  });

  it("takes the multiplier from the layer below instead of redefining it", () => {
    expect(DEFAULT_MULTIPLIER).toBe(fromLedger);
    const source = readFileSync(new URL("./constants.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/DEFAULT_MULTIPLIER\s*=/);
  });
});
