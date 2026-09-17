import { beforeEach, describe, expect, it } from "vitest";
import type { ContractIdentity } from "@ib/ib-parsers";
import type { Position, Transaction } from "@ib/ledger";
import { AppDatabase, type SectorRecord } from "@/db/schema";
import { addMissingSectors, addSector, deleteSector, heldTickers, importSectorCsv, missingSectorRecords, parseScoreInput, parseSectorCsv, SectorCsvError, type SectorSources, updateSector } from "@/db/sectors";

const HEADER = "Ticker;Name;Category;Score;S-2;S-4;Last Date;Status";
const CSV = [
  HEADER,
  "ACQZ;EXAMPLE AVIATION Inc.;Aviation;6.5;6.0;;2026-08-18;on",
  " aeqz ;AEQZ Technologies Inc;Automotive;;6.5;6.0;2026-08-25;on",
  ";;;;;;;",
  "ZZZ;No Score Co;;;;;;off",
].join("\r\n");

let db: AppDatabase;
beforeEach(() => {
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
});

const file = (content: string) => new File([content], "company.csv", { type: "text/csv" });

/** A stored row, stamped long before any write a test makes. */
const stored = (ticker: string, fields: Partial<SectorRecord> = {}): SectorRecord => ({
  ticker,
  name: "",
  category: "",
  score: null,
  status: "",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...fields,
});

describe("parseSectorCsv", () => {
  it("reads the columns by name, ignores S-* and Last Date, skips rows without a ticker, normalizes the ticker", () => {
    expect(parseSectorCsv(CSV)).toEqual([
      { ticker: "ACQZ", name: "EXAMPLE AVIATION Inc.", category: "Aviation", score: 6.5, status: "on" },
      { ticker: "AEQZ", name: "AEQZ Technologies Inc", category: "Automotive", score: null, status: "on" },
      { ticker: "ZZZ", name: "No Score Co", category: "", score: null, status: "off" },
    ]);
  });

  it("gives only the fields whose column the file carries, whatever their order, and copes with a BOM", () => {
    const rows = parseSectorCsv("﻿Category;Ticker\nTech;AAPL");
    expect(rows).toEqual([{ ticker: "AAPL", category: "Tech" }]);
    // toEqual ignores undefined keys: the absent columns must not even be keys.
    expect(Object.keys(rows[0]).sort()).toEqual(["category", "ticker"]);
  });

  it("refuses a file without a Ticker column", () => {
    expect(() => parseSectorCsv("Name;Category\nApple;Tech")).toThrow(SectorCsvError);
  });

  it("refuses an unreadable score", () => {
    expect(() => parseSectorCsv("Ticker;Score\nAAPL;high")).toThrow(/Unreadable score "high" for AAPL/);
  });
});

describe("importSectorCsv", () => {
  it("adds the new tickers and updates the known ones, and never deletes a ticker the file does not name", async () => {
    await db.sectors.bulkPut([
      stored("ACQZ", { name: "Old name", category: "Old", score: 1, status: "off" }),
      stored("KEEP", { category: "Kept" }),
    ]);
    expect(await importSectorCsv(db, file(CSV))).toEqual({ status: "ok", added: 2, updated: 1 });
    expect(await db.sectors.get("ACQZ")).toMatchObject({ name: "EXAMPLE AVIATION Inc.", category: "Aviation", score: 6.5, status: "on" });
    expect(await db.sectors.get("KEEP")).toEqual(stored("KEEP", { category: "Kept" }));
    expect((await db.sectors.toArray()).map((row) => row.ticker)).toEqual(["ACQZ", "AEQZ", "KEEP", "ZZZ"]);
  });

  it("keeps the value of a column the file lacks, and clears it on an empty cell of a column it carries", async () => {
    await db.sectors.put(stored("AAPL", { name: "Apple Inc.", category: "Tech", score: 7.5, status: "on" }));
    await importSectorCsv(db, file("Ticker;Category;Score\nAAPL;;"));
    expect(await db.sectors.get("AAPL")).toMatchObject({ name: "Apple Inc.", category: "", score: null, status: "on" });
  });

  it("gives a new ticker empty values for the columns the file lacks", async () => {
    await importSectorCsv(db, file("Ticker;Category\nNEW;Energy"));
    expect(await db.sectors.get("NEW")).toMatchObject({ ticker: "NEW", name: "", category: "Energy", score: null, status: "" });
  });

  it("lets the last row of a ticker named twice win, and counts it once", async () => {
    expect(await importSectorCsv(db, file("Ticker;Category\nAAPL;Tech\naapl;Hardware"))).toEqual({ status: "ok", added: 1, updated: 0 });
    expect(await db.sectors.get("AAPL")).toMatchObject({ category: "Hardware" });
  });

  it("stamps every row of the file with the instant of the import", async () => {
    await db.sectors.put(stored("ACQZ"));
    const before = new Date().toISOString();
    await importSectorCsv(db, file(CSV));
    const stamps = new Set((await db.sectors.toArray()).map((row) => row.updatedAt));
    expect(stamps.size).toBe(1);
    expect([...stamps][0] >= before).toBe(true);
  });

  it("writes nothing on an unreadable file", async () => {
    await db.sectors.put(stored("OLD", { category: "Kept" }));
    expect(await importSectorCsv(db, file("Name;Category\nApple;Tech"))).toEqual({ status: "error", detail: 'Column "Ticker" missing' });
    expect(await importSectorCsv(db, file("Ticker;Category;Score\nNEW;Tech;7\nBAD;Tech;high"))).toEqual({
      status: "error",
      detail: 'Unreadable score "high" for BAD',
    });
    expect(await db.sectors.toArray()).toEqual([stored("OLD", { category: "Kept" })]);
  });
});

const AT = "2026-09-14T10:00:00.000Z";

function tx(fields: Partial<Transaction>): Transaction {
  return {
    accountId: "test", externalId: crypto.randomUUID(), source: "flex", kind: "trade", symbol: "", secType: "STK",
    right: "", strike: null, expiry: null, quantity: 1, price: 1, amount: -1, commission: -1, currency: "USD",
    when: "2026-09-01T14:00:00.000Z", description: "", ...fields,
  };
}

function position(fields: Partial<Position>): Position {
  return {
    symbol: "", secType: "STK", right: "", strike: null, expiry: null, multiplier: null, quantity: 1, avgPrice: null,
    marketPrice: null, marketValue: null, unrealizedPnl: null, currency: "USD", conid: "", description: "", ...fields,
  };
}

function identity(fields: Partial<ContractIdentity>): ContractIdentity {
  return { conid: "1", isin: "", secType: "STK", currency: "USD", description: "", tickers: [], ...fields };
}

const none: SectorSources = { transactions: [], positions: [], identities: [] };

/** A row as an IB import writes it: only the ticker and, maybe, the company's name. */
const added = (ticker: string, name = ""): SectorRecord => ({ ticker, name, category: "", score: null, status: "", updatedAt: AT });

describe("heldTickers", () => {
  it("names the ticker of every share and option held, an option by its underlying, whatever its case or padding", () => {
    const positions = [
      position({ symbol: " aapl " }),
      position({ symbol: "MQZA", secType: "OPT", right: "P", strike: 20, expiry: "2026-03-20", quantity: -1 }),
      position({ symbol: "ZXAG  270115C00002500", secType: "OPT", right: "C", strike: 2.5, expiry: "2027-01-15" }),
      position({ symbol: "AAPL", secType: "OPT", right: "C", strike: 250, expiry: "2026-10-16", quantity: -2 }),
    ];
    expect([...heldTickers(positions)].sort()).toEqual(["AAPL", "MQZA", "ZXAG"]);
  });

  it("ignores an empty position, other security types and .OLD spellings", () => {
    const positions = [
      position({ symbol: "ZERO", quantity: 0 }),
      position({ symbol: "EUR.USD", secType: "CASH" }),
      position({ symbol: "ES", secType: "FOP" }),
      position({ symbol: "TESTV.OLD" }),
      position({ symbol: "  " }),
    ];
    expect(heldTickers(positions).size).toBe(0);
  });
});

describe("missingSectorRecords", () => {
  it("adds the ticker of a share and of an option's underlying, packed OCC symbols included, in order of first sighting", () => {
    const sources: SectorSources = {
      ...none,
      transactions: [
        tx({ symbol: "AAPL" }),
        tx({ symbol: "MQZA  260320P00020000", secType: "OPT", right: "P", strike: 20, expiry: "2026-03-20" }),
        // A six-character root leaves no padding space to split on.
        tx({ symbol: "ABCDEF260320C00150000", secType: "OPT", right: "C", strike: 150, expiry: "2026-03-20" }),
      ],
      positions: [position({ symbol: "QQQ", secType: "OPT" })],
    };
    expect(missingSectorRecords(new Set(), sources, AT)).toEqual([added("AAPL"), added("MQZA"), added("ABCDEF"), added("QQQ")]);
  });

  it("ignores cash pairs, rows without a security, other security types, empty tickers and .OLD spellings", () => {
    const sources: SectorSources = {
      ...none,
      transactions: [
        tx({ symbol: "EUR.USD", secType: "CASH" }),
        tx({ kind: "fee", symbol: "", secType: "" }),
        tx({ kind: "dividend", symbol: "DIVI", secType: "" }),
        tx({ symbol: "ES", secType: "FOP" }),
        tx({ symbol: "WARR", secType: "WAR" }),
        tx({ kind: "corporate_action", symbol: "TESTV.OLD" }),
        tx({ symbol: "   " }),
      ],
    };
    expect(missingSectorRecords(new Set(), sources, AT)).toEqual([]);
  });

  it("never returns a ticker the table already knows, whatever its case in the import, nor the same ticker twice", () => {
    const sources: SectorSources = {
      ...none,
      transactions: [tx({ symbol: "aapl" }), tx({ symbol: "MSFT" })],
      positions: [position({ symbol: "MSFT" })],
    };
    expect(missingSectorRecords(new Set(["AAPL"]), sources, AT)).toEqual([added("MSFT")]);
  });

  it("names the company from a share's identity first, then a trade of the share, then its position", () => {
    const sources: SectorSources = {
      identities: [
        identity({ tickers: ["OLDN", "NVDA"], description: "NVIDIA CORP" }),
        identity({ secType: "OPT", tickers: ["AMD"], description: "AMD 20SEP26 150 C" }),
      ],
      transactions: [
        tx({ symbol: "NVDA", description: "NVIDIA TRADE NAME" }),
        tx({ symbol: "AMD", description: "ADVANCED MICRO DEVICES" }),
        tx({ symbol: "TSLA", secType: "OPT", description: "TSLA 20SEP26 300 C" }),
      ],
      positions: [position({ symbol: "AMD", description: "AMD POSITION NAME" }), position({ symbol: "INTC", description: "INTEL CORP" })],
    };
    expect(missingSectorRecords(new Set(), sources, AT)).toEqual([
      added("NVDA", "NVIDIA CORP"),
      added("AMD", "ADVANCED MICRO DEVICES"),
      added("TSLA"),
      added("INTC", "INTEL CORP"),
    ]);
  });

  it("takes no name from a description that repeats the ticker, nor from a corporate action", () => {
    const sources: SectorSources = {
      identities: [identity({ tickers: ["SYMA"], description: "SYMA" })],
      transactions: [
        tx({ symbol: "SYMA", description: "SYMA" }),
        tx({
          kind: "corporate_action",
          symbol: "TESTP",
          description: "TESTV(US9228000000) CUSIP/ISIN Change to (US7411000000) (TESTP, TEST P INC, US7411000000)",
        }),
      ],
      positions: [position({ symbol: "SYMA", description: " syma " })],
    };
    expect(missingSectorRecords(new Set(), sources, AT)).toEqual([added("SYMA"), added("TESTP")]);
  });
});

describe("addMissingSectors", () => {
  it("adds only the missing tickers and leaves a known row as it was", async () => {
    const known = stored("AAPL", { name: "Apple", category: "Tech", score: 7, status: "on" });
    await db.sectors.put(known);
    const sources: SectorSources = {
      ...none,
      transactions: [tx({ symbol: "AAPL", description: "APPLE INC" }), tx({ symbol: "MSFT", description: "MICROSOFT CORP" })],
    };
    const count = await db.transaction("rw", db.sectors, () => addMissingSectors(db, sources, AT));
    expect(count).toBe(1);
    expect(await db.sectors.toArray()).toEqual([known, added("MSFT", "MICROSOFT CORP")]);
  });
});

describe("manual edits", () => {
  it("adds a ticker, normalized, with its text trimmed and the instant of the write", async () => {
    const before = new Date().toISOString();
    expect(await addSector(db, { ticker: " aapl ", name: " Apple Inc. ", category: "Tech ", score: 7.5, status: " on" })).toBe("added");
    const record = await db.sectors.get("AAPL");
    expect(record).toMatchObject({ ticker: "AAPL", name: "Apple Inc.", category: "Tech", score: 7.5, status: "on" });
    expect(record!.updatedAt >= before).toBe(true);
  });

  it("refuses an empty ticker and a ticker already in the table, and overwrites nothing", async () => {
    const existing = stored("AAPL", { category: "Tech" });
    await db.sectors.put(existing);
    expect(await addSector(db, { ticker: "   ", name: "", category: "", score: null, status: "" })).toBe("invalid");
    expect(await addSector(db, { ticker: "aapl", name: "Other", category: "Other", score: 1, status: "" })).toBe("exists");
    expect(await db.sectors.toArray()).toEqual([existing]);
  });

  it("updates only the fields of the patch, trimmed, and stamps the row", async () => {
    await db.sectors.put(stored("AAPL", { name: "Apple", category: "Tech", score: 7, status: "on" }));
    expect(await updateSector(db, "AAPL", { category: " Hardware ", score: null })).toBe(true);
    const record = await db.sectors.get("AAPL");
    expect(record).toMatchObject({ name: "Apple", category: "Hardware", score: null, status: "on" });
    expect(record!.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("says so when the row to update is gone, and writes nothing", async () => {
    expect(await updateSector(db, "GONE", { category: "Tech" })).toBe(false);
    expect(await db.sectors.count()).toBe(0);
  });

  it("deletes a row and only that one", async () => {
    await db.sectors.bulkPut([stored("AAPL"), stored("MSFT")]);
    await deleteSector(db, "AAPL");
    expect(await db.sectors.toArray()).toEqual([stored("MSFT")]);
  });
});

describe("parseScoreInput", () => {
  it("reads empty as null, a decimal comma as a point, and refuses anything else", () => {
    expect(parseScoreInput("  ")).toBeNull();
    expect(parseScoreInput("7")).toBe(7);
    expect(parseScoreInput(" 7,5 ")).toBe(7.5);
    expect(parseScoreInput("7.5")).toBe(7.5);
    expect(parseScoreInput("high")).toBe("invalid");
    expect(parseScoreInput("1,2,3")).toBe("invalid");
  });
});
