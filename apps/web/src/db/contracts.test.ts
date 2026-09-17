import { beforeEach, describe, expect, it } from "vitest";
import type { ContractIdentity } from "@ib/ib-parsers";
import { mergeContractRecords, readIdentityInputs, type ContractRecord } from "./contracts";
import { AppDatabase } from "./schema";

const PERIOD = { start: "2023-01-01", end: "2023-12-31" };
const identity = (conid: string, tickers: string[], extra: Partial<ContractIdentity> = {}): ContractIdentity => ({
  conid, isin: "", secType: "STK", currency: "USD", description: "", tickers, ...extra,
});

describe("mergeContractRecords", () => {
  it("creates a record with one alias per ticker, dated by the import period", () => {
    const [record] = mergeContractRecords("beta", [], [identity("1", ["ZXAB"])], PERIOD, "2026-09-09T10:00:00.000Z");
    expect(record).toEqual({
      accountId: "beta",
      conid: "1",
      isin: "",
      secType: "STK",
      currency: "USD",
      description: "",
      aliases: [{ ticker: "ZXAB", firstSeen: "2023-01-01", lastSeen: "2023-12-31" }],
      updatedAt: "2026-09-09T10:00:00.000Z",
    });
  });

  it("widens an existing alias's window without ever moving it backwards", () => {
    const current: ContractRecord[] = [{
      accountId: "beta", conid: "1", isin: "", secType: "STK", currency: "USD", description: "",
      aliases: [{ ticker: "ZXAB", firstSeen: "2022-01-01", lastSeen: "2022-12-31" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
    }];
    const [record] = mergeContractRecords("beta", current, [identity("1", ["ZXAB"])], PERIOD, "2026-09-09T10:00:00.000Z");
    expect(record.aliases).toEqual([{ ticker: "ZXAB", firstSeen: "2022-01-01", lastSeen: "2023-12-31" }]);
  });

  it("appends a ticker the contract had never worn", () => {
    const current: ContractRecord[] = [{
      accountId: "beta", conid: "1", isin: "", secType: "STK", currency: "USD", description: "",
      aliases: [{ ticker: "ZXAB", firstSeen: "2022-01-01", lastSeen: "2022-12-31" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
    }];
    const [record] = mergeContractRecords("beta", current, [identity("1", ["ZXABQ"])], PERIOD, "2026-09-09T10:00:00.000Z");
    expect(record.aliases.map((a) => a.ticker)).toEqual(["ZXAB", "ZXABQ"]);
  });

  it("fills an ISIN the first sighting did not have", () => {
    const current: ContractRecord[] = [{
      accountId: "beta", conid: "1", isin: "", secType: "STK", currency: "USD", description: "",
      aliases: [{ ticker: "ZXAI", firstSeen: "2022-01-01", lastSeen: "2022-12-31" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
    }];
    const [record] = mergeContractRecords("beta", current, [identity("1", ["ZXAI"], { isin: "US0065000000" })], PERIOD, "2026-09-09T10:00:00.000Z");
    expect(record.isin).toBe("US0065000000");
  });

  it("leaves records of other contracts untouched", () => {
    const current: ContractRecord[] = [{
      accountId: "beta", conid: "9", isin: "", secType: "STK", currency: "USD", description: "",
      aliases: [{ ticker: "MQZA", firstSeen: "2022-01-01", lastSeen: "2022-12-31" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
    }];
    const records = mergeContractRecords("beta", current, [identity("1", ["ZXAB"])], PERIOD, "2026-09-09T10:00:00.000Z");
    expect(records).toHaveLength(1);
    expect(records[0].conid).toBe("1");
  });

  it("dates an agent pass by its own day, not by a period it does not have", () => {
    const [record] = mergeContractRecords("beta", [], [identity("1", ["MQZA"])], null, "2026-09-09T10:00:00.000Z");
    expect(record.aliases[0]).toEqual({ ticker: "MQZA", firstSeen: "2026-09-09", lastSeen: "2026-09-09" });
  });
});

describe("readIdentityInputs", () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = new AppDatabase(`test-${crypto.randomUUID()}`);
  });

  it("never returns another account's contracts: comptes jamais combinés", async () => {
    await db.contracts.bulkPut([
      {
        accountId: "beta", conid: "1", isin: "", secType: "STK", currency: "USD", description: "",
        aliases: [{ ticker: "ZXAB", firstSeen: "2023-01-01", lastSeen: "2023-12-31" }],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        accountId: "alpha", conid: "9", isin: "", secType: "STK", currency: "USD", description: "",
        aliases: [{ ticker: "MQZA", firstSeen: "2023-01-01", lastSeen: "2023-12-31" }],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const inputs = await readIdentityInputs(db, "beta");
    expect(inputs).toEqual([{ conid: "1", secType: "STK", isin: "", aliases: [{ ticker: "ZXAB", firstSeen: "2023-01-01", lastSeen: "2023-12-31" }] }]);
    expect(inputs.map((i) => i.conid)).not.toContain("9");
  });

  it("carries the ISIN through: rule 8 files an action's leg by it, not by its ticker", async () => {
    await db.contracts.put({
      accountId: "alpha", conid: "900000110", isin: "CA25380B1022", secType: "STK", currency: "USD", description: "EXAMPLE POWER INC",
      aliases: [{ ticker: "ZXAM", firstSeen: "2025-01-01", lastSeen: "2026-09-02" }],
      updatedAt: "2026-09-09T00:00:00.000Z",
    });

    expect((await readIdentityInputs(db, "alpha"))[0].isin).toBe("CA25380B1022");
  });
});
