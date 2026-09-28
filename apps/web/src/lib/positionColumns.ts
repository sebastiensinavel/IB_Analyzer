import { KIND_LABELS, type AnalyzedPosition, type PositionKind } from "@ib/coverage";
import { formatContract } from "@/lib/format";
import { coverageValues } from "@/lib/riskReport";
import type { ColumnSpec } from "@/lib/tableView";

/**
 * The thirteen columns every table of the Positions page shares, in order, the cash table
 * included. `underlyingDayChange` leads every table (spec of sub-project 35, §5). Their widths
 * are fixed, as a share of the table, so the tables line up whatever their content. Re-measured
 * for the whole-branch review of sub-project 23: the first pass fitted every numeric column to
 * the demo fixture's own values, sub-pixel from its widest cell — a regression the review
 * caught, not a design choice (`docs/points-reportes.md`). The requirement is now the larger of
 * two things, each measured live rather than assumed: the header's widest single word plus its
 * sort chevron (every `ColumnHeader` here renders `wrap`, `break-words whitespace-normal`, so a
 * multi-word header is meant to fold — what cannot fold is one word, words never break
 * mid-letter), and, for a numeric column, the widest *realistic* cell an amount or a percentage
 * never wraps, so its whole string has to fit. `avgPrice` is abbreviated to `Prix init.` rather
 * than fed spelled out: two words wide instead of one would take a data column's room.
 *
 * The realistic cell is chosen, not measured from any fixture: `underlyingDayChange` and
 * `dayChange` on a signed three-digit swing (`-100.0%`, routine for an option), `dailyPnl` and
 * `unrealizedPnl` on the same amount width as each other since they are the same kind of
 * quantity (`-$1,234.56`, a four-figure loss), `marketValue` on a five-figure negative position
 * (`-$99,999.99`), `avgPrice`/`lastPrice` on a four-figure price at the formatter's own four
 * decimals (`1,234.5678` — an average cost built from many fills often carries all four, even on
 * a higher-priced underlying), `quantity` on a five-figure short position (`-10000`,
 * unformatted: the cell interpolates the number as is, no thousands separator).
 *
 * `position` is the one column whose requirement is not its header: it holds the variable-length
 * contract label, which this design lets wrap — but only to two lines (this file's own history,
 * and CLAUDE.md, say so). Its real requirement is therefore the width a representative long
 * label ("AAPL Jan16'26 150 Call") needs to fold to exactly two lines, found by binary search on
 * the live column width against `Range.getClientRects().length` (a cell's own box stretches to
 * its row's height, so measuring the cell's height instead — a mistake caught while re-measuring
 * this file the first time — silently measures the tallest sibling cell, not the label's own line
 * count) — 134 px, well past its 88 px header word with its chevron. Every other column gets
 * exactly its own measured minimum, rounded up to the nearest 0.25 %; `position` gets whatever is
 * left, which is where its margin above 134 px comes from.
 *
 * The table sits at its 75rem minimum: the smallest whole-rem width at which every column's
 * rounded share still meets its own measured requirement, re-measured (up from 70rem) once
 * `underlyingDayChange` led the table (sub-project 35, task 6 of its plan). They add up to 100.
 * At 75rem the card itself no longer fits its own content at 1280 px with the sidebar open
 * (976 px of card against a 1200 px floor, 224 px — the tail of `unrealizedPnl` (about 35 of
 * its 105 px), all of `decision` and all of `coverage` — off-screen and reached by scrolling):
 * the honest consequence of columns sized for real data rather than a fixture, not a regression
 * to chase back down by under-sizing a column again.
 */
export const POSITION_COLUMNS = [
  { key: "underlyingDayChange", width: "6.5%", numeric: true },
  { key: "position", width: "12.25%", numeric: false },
  { key: "type", width: "5.25%", numeric: false },
  { key: "sector", width: "7.25%", numeric: false },
  { key: "marketValue", width: "8.75%", numeric: true },
  { key: "quantity", width: "5.5%", numeric: true },
  { key: "avgPrice", width: "8%", numeric: true },
  { key: "lastPrice", width: "8%", numeric: true },
  { key: "dayChange", width: "6%", numeric: true },
  { key: "dailyPnl", width: "8%", numeric: true },
  { key: "unrealizedPnl", width: "8.75%", numeric: true },
  { key: "decision", width: "7.5%", numeric: false },
  { key: "coverage", width: "8.25%", numeric: false },
] as const satisfies readonly { key: string; width: string; numeric: boolean }[];

/**
 * The table's minimum width: the smallest whole-rem width at which every `POSITION_COLUMNS`
 * share above still meets its own measured requirement (see that comment for the method and
 * the 1280 px consequence).
 */
export const POSITION_TABLE_MIN_WIDTH = "75rem";

/** The underlying's day move of a ticker, as the quotes store has it (spec of sub-project 35). */
export type UnderlyingOf = (ticker: string) => number | null;

/** A fraction on the row, a percentage in a spec: a filter typed "> 5" has to mean +5 %. */
export const asPercent = (ratio: number | null) => (ratio === null ? null : ratio * 100);

/**
 * What each shared column of the Positions page compares, filters and sorts on. Same keys and order
 * as POSITION_COLUMNS. The coverage is a set of sources, filterable but without a natural order.
 */
export function positionColumnSpecs(sectorOf: (symbol: string) => string | null, underlyingOf: UnderlyingOf): ColumnSpec<AnalyzedPosition>[] {
  return [
    { key: "underlyingDayChange", type: "number", sortable: true, value: (position) => asPercent(underlyingOf(position.symbol)) },
    { key: "position", type: "text", sortable: true, value: (position) => formatContract(position) },
    {
      key: "type",
      type: "enum",
      sortable: true,
      value: (position) => position.kind,
      label: (kind) => KIND_LABELS[kind as PositionKind] ?? kind,
    },
    { key: "sector", type: "enum", sortable: true, value: (position) => sectorOf(position.symbol) },
    { key: "marketValue", type: "number", sortable: true, value: (position) => position.marketValue },
    { key: "quantity", type: "number", sortable: true, value: (position) => position.quantity },
    { key: "avgPrice", type: "number", sortable: true, value: (position) => position.avgPrice },
    { key: "lastPrice", type: "number", sortable: true, value: (position) => position.lastPrice },
    // A fraction on the row, a percentage here: a filter typed "> 5" has to mean +5 %.
    { key: "dayChange", type: "number", sortable: true, value: (position) => asPercent(position.dayChange) },
    { key: "dailyPnl", type: "number", sortable: true, value: (position) => position.dailyPnl },
    { key: "unrealizedPnl", type: "number", sortable: true, value: (position) => position.unrealizedPnl },
    { key: "decision", type: "enum", sortable: true, value: (position) => position.decision },
    { key: "coverage", type: "enum", sortable: false, value: (position) => coverageValues(position) },
  ];
}

export type PositionColumnKey = (typeof POSITION_COLUMNS)[number]["key"];

/**
 * The twelve columns of the Wheel's assigned shares: its own table, so its own floor, measured on
 * its own — twelve columns, not thirteen, `underlyingDayChange` leading it too (spec of
 * sub-project 35, §5). None of them is the variable-length contract label that drives
 * `position`'s margin above POSITION_COLUMNS; here `position` is a bare ticker (`GOOGL`,
 * a realistic five-letter worst case; the header word dominates it anyway). Same method as
 * POSITION_COLUMNS, re-measured for the same whole-branch review: each column's widest
 * unwrappable word plus its sort chevron, a numeric column's widest *realistic* cell besides (an
 * amount or a percentage never wraps). `quantity` here is always a long share count, never
 * signed (`10000`, unlike POSITION_COLUMNS' `quantity`, which can be short). `averageAssignmentPrice`
 * and `averageCallStrike` are strikes, never priced to more than the cent (`1,234.56`), unlike
 * `lastPrice`, a live quote that can carry the formatter's four decimals (`1,234.5678`).
 * `assignedTotal` is a total dollar amount, always positive, sized on a six-figure lot
 * (`$999,999.99`) since it multiplies a four-figure strike by a five-figure share count.
 * `dailyPnl`/`unrealizedPnl` keep the same `-$1,234.56` as POSITION_COLUMNS', and
 * `underlyingDayChange`/`dayChange` the same `-100.0%`. Every column gets exactly its own
 * measured minimum, rounded up to the nearest 0.25 %; `position` takes whatever is left.
 *
 * The table sits at its 68rem minimum, the smallest whole-rem width at which every rounded share
 * still meets its own measured requirement, re-measured (up from 63rem) once `underlyingDayChange`
 * led the table (sub-project 35, task 6 of its plan). They add up to 100. At 68rem the card no
 * longer fits its own content at 1280 px with the sidebar open (976 px of card against a 1088 px
 * floor, 112 px — the tail of `unrealizedPnl` (about 14 of its 106 px) and all of `coverage` —
 * off-screen and reached by scrolling), where the old 63rem floor was only 32 px short. The known
 * defect of this table's `coverage` column (`docs/points-reportes.md`, sub-project 23: its
 * "used x/y" badge is measured on its header word alone, never on its own content) is untouched
 * here — this re-measurement only accounts for the new leading column, not that debt.
 */
export const WHEEL_SHARE_COLUMNS = [
  { key: "underlyingDayChange", width: "7%", numeric: true },
  { key: "position", width: "8.25%", numeric: false },
  { key: "sector", width: "8%", numeric: false },
  { key: "quantity", width: "8.5%", numeric: true },
  { key: "averageAssignmentPrice", width: "7.5%", numeric: true },
  { key: "averageCallStrike", width: "7.5%", numeric: true },
  { key: "assignedTotal", width: "9.75%", numeric: true },
  { key: "lastPrice", width: "9%", numeric: true },
  { key: "dayChange", width: "6.75%", numeric: true },
  { key: "dailyPnl", width: "9%", numeric: true },
  { key: "unrealizedPnl", width: "9.75%", numeric: true },
  { key: "coverage", width: "9%", numeric: false },
] as const satisfies readonly { key: string; width: string; numeric: boolean }[];

/**
 * The table's minimum width: the smallest whole-rem width at which every `WHEEL_SHARE_COLUMNS`
 * share above still meets its own measured requirement (see that comment for the method and
 * the 1280 px consequence).
 */
export const WHEEL_SHARE_TABLE_MIN_WIDTH = "68rem";
