import type { ContractIdentity } from "@ib/ib-parsers";
import { tickerOf, type Position, type Transaction } from "@ib/ledger";
import { readFileText } from "./readFile";
import type { AppDatabase, SectorRecord } from "./schema";

export type SectorImportReport = { status: "ok"; added: number; updated: number } | { status: "error"; detail: string };

/** The editable fields of a row: everything but its key and the instant of its last write. */
export type SectorFields = Pick<SectorRecord, "name" | "category" | "score" | "status">;

/** What a row holds before anyone fills it in. A missing score is unknown, never zero. */
export const EMPTY_SECTOR_FIELDS: SectorFields = { name: "", category: "", score: null, status: "" };

/** One row of the CSV: only the fields whose column the file carries. */
export type SectorCsvRow = { ticker: string } & Partial<SectorFields>;

export class SectorCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SectorCsvError";
  }
}

/** One spelling per ticker, whoever writes it: "aapl " and "AAPL" are the same row. */
export function normalizeTicker(text: string): string {
  return text.trim().toUpperCase();
}

/**
 * The user's `company.csv`: `;`-separated, a header row, columns read by
 * name. `S-*` and `Last Date` are ignored. No quoting: the file never
 * carries a semicolon inside a cell. A field is present in a row only when
 * its column is in the header: that is what lets the merge keep what the
 * file does not speak about.
 */
export function parseSectorCsv(text: string): SectorCsvRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) throw new SectorCsvError("Empty file");
  const header = lines[0].split(";").map((cell) => cell.trim());
  const column = (name: string) => header.indexOf(name);
  const tickerColumn = column("Ticker");
  if (tickerColumn < 0) throw new SectorCsvError('Column "Ticker" missing');
  const textColumns = [
    ["name", column("Name")],
    ["category", column("Category")],
    ["status", column("Status")],
  ] as const;
  const scoreColumn = column("Score");

  const rows: SectorCsvRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(";");
    const cell = (index: number) => (cells[index] ?? "").trim();
    const ticker = normalizeTicker(cells[tickerColumn] ?? "");
    if (!ticker) continue;
    const row: SectorCsvRow = { ticker };
    for (const [field, index] of textColumns) {
      if (index >= 0) row[field] = cell(index);
    }
    if (scoreColumn >= 0) {
      const scoreText = cell(scoreColumn);
      const score = scoreText === "" ? null : Number(scoreText);
      if (score !== null && !Number.isFinite(score)) {
        throw new SectorCsvError(`Unreadable score "${scoreText}" for ${ticker}`);
      }
      row.score = score;
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Folds the CSV rows onto the stored table: a column the file carries overwrites, an empty cell
 * included; a column it lacks keeps the stored value; a ticker it does not name is not returned,
 * so it is left alone. The last row of a ticker named twice wins.
 */
export function mergeSectorRows(
  stored: ReadonlyMap<string, SectorRecord>,
  rows: readonly SectorCsvRow[],
  updatedAt: string,
): { records: SectorRecord[]; added: number; updated: number } {
  const merged = new Map<string, SectorRecord>();
  for (const row of rows) {
    const base = merged.get(row.ticker) ?? stored.get(row.ticker) ?? { ticker: row.ticker, ...EMPTY_SECTOR_FIELDS, updatedAt };
    merged.set(row.ticker, { ...base, ...row, updatedAt });
  }
  const records = [...merged.values()];
  const updated = records.filter((record) => stored.has(record.ticker)).length;
  return { records, added: records.length - updated, updated };
}

/** Merges the file into the table by ticker, in one transaction. Nothing is ever deleted. */
export async function importSectorCsv(db: AppDatabase, file: File): Promise<SectorImportReport> {
  const text = await readFileText(file);
  let rows: SectorCsvRow[];
  try {
    rows = parseSectorCsv(text);
  } catch (e) {
    if (e instanceof SectorCsvError) return { status: "error", detail: e.message };
    throw e;
  }
  const at = new Date().toISOString();
  let result!: ReturnType<typeof mergeSectorRows>;
  await db.transaction("rw", db.sectors, async () => {
    const stored = new Map((await db.sectors.toArray()).map((record) => [record.ticker, record]));
    result = mergeSectorRows(stored, rows, at);
    await db.sectors.bulkPut(result.records);
  });
  return { status: "ok", added: result.added, updated: result.updated };
}

/** What an IB import read: every row it parsed, not only those it chose to write. */
export interface SectorSources {
  transactions: readonly Transaction[];
  positions: readonly Position[];
  identities: readonly ContractIdentity[];
}

/** Only shares and options name a company the table can classify. */
const CLASSIFIED_TYPES = new Set(["STK", "OPT"]);

/**
 * The rows an IB import adds to the sector table: one per ticker of a share or an option it read
 * that the table does not know yet, in order of first sighting. A known ticker is never
 * returned, so an import never rewrites what the user typed. `.OLD` is IB's name for the dead
 * contract of a CUSIP change: the journals file its lots under the live ticker, so nothing would
 * ever ask the table for it.
 */
export function missingSectorRecords(known: ReadonlySet<string>, sources: SectorSources, updatedAt: string): SectorRecord[] {
  const tickers: string[] = [];
  const seen = new Set<string>();
  for (const row of [...sources.transactions, ...sources.positions]) {
    if (!CLASSIFIED_TYPES.has(row.secType)) continue;
    const ticker = normalizeTicker(tickerOf(row.symbol));
    if (!ticker || ticker.endsWith(".OLD") || known.has(ticker) || seen.has(ticker)) continue;
    seen.add(ticker);
    tickers.push(ticker);
  }
  const names = companyNames(sources);
  return tickers.map((ticker) => ({ ticker, ...EMPTY_SECTOR_FIELDS, name: names.get(ticker) ?? "", updatedAt }));
}

/**
 * The tickers `positions` hold, an option under its underlying: the table's "En cours" column,
 * computed and never stored. Same reading as `missingSectorRecords`, so every ticker an import
 * adds for a position is the one this recognizes.
 */
export function heldTickers(positions: readonly Position[]): Set<string> {
  const tickers = new Set<string>();
  for (const row of positions) {
    if (!CLASSIFIED_TYPES.has(row.secType) || row.quantity === 0) continue;
    const ticker = normalizeTicker(tickerOf(row.symbol));
    if (ticker && !ticker.endsWith(".OLD")) tickers.add(ticker);
  }
  return tickers;
}

/**
 * The company's name as IB spells it, for every ticker `sources` names: a share's contract
 * identity first, then a trade of the share, then its position. A description that merely
 * repeats the ticker — what statements and TWS write for a share — names nothing, and a
 * corporate action's description is a sentence about the event, never a name. One pass over
 * each source kind, first qualifying description wins within that kind.
 */
function companyNames(sources: SectorSources): Map<string, string> {
  const names = new Map<string, string>();
  const consider = (ticker: string, description: string) => {
    if (names.has(ticker)) return;
    const text = description.trim();
    if (text !== "" && normalizeTicker(text) !== ticker) names.set(ticker, text);
  };
  for (const identity of sources.identities) {
    if (identity.secType !== "STK") continue;
    for (const rawTicker of identity.tickers) consider(normalizeTicker(rawTicker), identity.description);
  }
  const shareTickerOf = (row: { secType: string; symbol: string }) =>
    row.secType === "STK" ? normalizeTicker(tickerOf(row.symbol)) : null;
  for (const row of sources.transactions) {
    if (row.kind !== "trade") continue;
    const ticker = shareTickerOf(row);
    if (ticker !== null) consider(ticker, row.description);
  }
  for (const row of sources.positions) {
    const ticker = shareTickerOf(row);
    if (ticker !== null) consider(ticker, row.description);
  }
  return names;
}

/**
 * Adds the tickers `sources` names that the table lacks, and says how many. Must run inside the
 * caller's read-write transaction, `db.sectors` included: reading the keys and adding in that one
 * transaction is what keeps two accounts importing the same new ticker at once from colliding,
 * since the import lock is per account and does not serialize them.
 */
export async function addMissingSectors(db: AppDatabase, sources: SectorSources, updatedAt: string): Promise<number> {
  const known = new Set(await db.sectors.toCollection().primaryKeys());
  const records = missingSectorRecords(known, sources, updatedAt);
  if (records.length > 0) await db.sectors.bulkAdd(records);
  return records.length;
}

export type AddSectorResult = "added" | "exists" | "invalid";

const TEXT_FIELDS = ["name", "category", "status"] as const;

/** The patch with its text fields trimmed: a stray space would fork a sector in the charts. */
function trimmed(patch: Partial<SectorFields>): Partial<SectorFields> {
  const copy: Partial<SectorFields> = { ...patch };
  for (const field of TEXT_FIELDS) {
    const value = copy[field];
    if (value !== undefined) copy[field] = value.trim();
  }
  return copy;
}

/** A row typed by the user. A ticker already in the table is refused, never overwritten. */
export async function addSector(db: AppDatabase, fields: { ticker: string } & SectorFields): Promise<AddSectorResult> {
  const ticker = normalizeTicker(fields.ticker);
  if (!ticker) return "invalid";
  return db.transaction("rw", db.sectors, async () => {
    if (await db.sectors.get(ticker)) return "exists";
    await db.sectors.add({
      ticker,
      name: fields.name.trim(),
      category: fields.category.trim(),
      score: fields.score,
      status: fields.status.trim(),
      updatedAt: new Date().toISOString(),
    });
    return "added";
  });
}

/** Writes one edit of a stored row; `false` when the row has been deleted in the meantime. */
export async function updateSector(db: AppDatabase, ticker: string, patch: Partial<SectorFields>): Promise<boolean> {
  const changed = await db.sectors.update(ticker, { ...trimmed(patch), updatedAt: new Date().toISOString() });
  return changed > 0;
}

export async function deleteSector(db: AppDatabase, ticker: string): Promise<void> {
  await db.sectors.delete(ticker);
}

/**
 * A score typed by hand: empty is unknown, and a decimal comma reads as a point, as a French
 * keyboard types it. The CSV import keeps `Number` as it is: the file is written by a program.
 */
export function parseScoreInput(text: string): number | null | "invalid" {
  const value = text.trim();
  if (value === "") return null;
  const score = Number(value.replace(",", "."));
  return Number.isFinite(score) ? score : "invalid";
}
