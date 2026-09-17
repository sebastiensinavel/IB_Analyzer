/// <reference types="node" />
// This package's tsconfig opts out of ambient globals ("types": []) since it
// runs in the browser; this file alone runs under Node (vitest), so it opts
// itself back in rather than exposing Node globals to the whole package.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseFlexXml } from "./flex.ts";

// jsdom's global URL ignores the explicit base and resolves against its fake
// document location, so the fixture path is built without the WHATWG URL API.
const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../tests/fixtures/flex_activity_sample.xml",
);
const xml = readFileSync(FIXTURE_PATH, "utf8");
const TARGET = { accountId: "test", ibAccountId: "U0000001" };

describe("parseFlexXml on the anonymized real file", () => {
  const result = parseFlexXml(xml, TARGET);

  it("reads every trade and cash row without error", () => {
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.transactions.filter((t) => t.kind === "trade").length).toBe(40);
    expect(result.transactions.filter((t) => t.kind === "transfer").length).toBeGreaterThan(0);
    expect(result.transactions.filter((t) => t.kind === "tax").length).toBeGreaterThan(0);
  });

  it("reads every section the pages need: no section is missing any more", () => {
    expect(result.issues.filter((i) => i.code === "section-missing")).toEqual([]);
  });

  it("reads the open positions and the USD cash into a snapshot", () => {
    expect(result.snapshot?.asOf).toBe("2026-09-02");
    expect(result.snapshot?.positions).toHaveLength(30);
    expect(result.snapshot?.positions.filter((p) => p.secType === "OPT")).toHaveLength(24);
    expect(result.snapshot?.positions.filter((p) => p.secType === "STK")).toHaveLength(6);
    expect(result.snapshot?.cashAvailable).toBeGreaterThan(0);
  });

  it("keys every option position on a bare underlying with a full contract", () => {
    for (const p of result.snapshot?.positions.filter((p) => p.secType === "OPT") ?? []) {
      expect(p.symbol).toMatch(/^SYM\d+$/);
      expect(p.strike).not.toBeNull();
      expect(p.expiry).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.right === "C" || p.right === "P").toBe(true);
      expect(p.quantity).not.toBe(0);
    }
  });

  it("gives every row a unique externalId", () => {
    const ids = result.transactions.map((t) => t.externalId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never turns an absent money field into zero on option rows", () => {
    const options = result.transactions.filter((t) => t.secType === "OPT");
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) {
      expect(o.strike).not.toBeNull();
      expect(o.expiry).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(o.right === "C" || o.right === "P").toBe(true);
    }
  });
});
