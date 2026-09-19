import { KIND_LABELS, type AnalyzedPosition, type PositionKind } from "@ib/coverage";
import { formatContract } from "@/lib/format";
import { coverageValues } from "@/lib/riskReport";
import type { ColumnSpec } from "@/lib/tableView";

/**
 * The twelve columns every table of the Positions page shares, in order, the cash table
 * included. Their widths are fixed, as a share of the table, so the tables line up whatever
 * their content. Re-measured for sub-project 23, with an agent snapshot synced so `dayChange`/
 * `dailyPnl` carry real numbers rather than dashes, on each column's *unwrappable* requirement:
 * every `ColumnHeader` here renders `wrap` (`break-words whitespace-normal`), so a multi-word
 * header is meant to fold onto a second line — what cannot fold is a single word (words never
 * break mid-letter) plus its sort chevron, and, for a numeric column, the cell: an amount or a
 * percentage never wraps either. `avgPrice` is abbreviated to `Prix init.` rather than fed:
 * spelled out it would be two words wide instead of one, taking a data column's room.
 *
 * `position` is the one column whose "unwrappable" figure is not its header: it holds the
 * variable-length contract label, which this design lets wrap — but only to two lines (this
 * file's own history, and CLAUDE.md, say so). Its real requirement is therefore the width a
 * representative long label ("AAPL Jan16'26 150 Call") needs to fold to exactly two lines,
 * found by binary search on the live column width against `Range.getClientRects().length`
 * (a cell's own box stretches to its row's height, so measuring the cell's height instead — a
 * mistake caught while re-measuring this file — silently measures the tallest sibling cell, not
 * the label's own line count) — 115 px, well past its 58 px header word (72 px with the chevron).
 * Every other column gets exactly its own measured minimum, rounded up to the nearest 0.25 %;
 * `position` gets whatever is left, which is where its margin above 115 px comes from.
 *
 * The table sits at its 62rem minimum: the smallest whole-rem width at which every column's
 * rounded share still meets its own measured requirement (60 and 61rem left `position` short of
 * its two-line need once the other eleven took their own rounded-up minimum). They add up to 100.
 */
export const POSITION_COLUMNS = [
  { key: "position", width: "12.75%", numeric: false },
  { key: "type", width: "5.25%", numeric: false },
  { key: "sector", width: "7.5%", numeric: false },
  { key: "marketValue", width: "11.75%", numeric: true },
  { key: "quantity", width: "4.75%", numeric: true },
  { key: "avgPrice", width: "7.75%", numeric: true },
  { key: "lastPrice", width: "7.75%", numeric: true },
  { key: "dayChange", width: "6.75%", numeric: true },
  { key: "dailyPnl", width: "8.75%", numeric: true },
  { key: "unrealizedPnl", width: "10.75%", numeric: true },
  { key: "decision", width: "8%", numeric: false },
  { key: "coverage", width: "8.25%", numeric: false },
] as const satisfies readonly { key: string; width: string; numeric: boolean }[];

/**
 * What each shared column of the Positions page compares, filters and sorts on. Same keys and order
 * as POSITION_COLUMNS. The coverage is a set of sources, filterable but without a natural order.
 */
export function positionColumnSpecs(sectorOf: (symbol: string) => string | null): ColumnSpec<AnalyzedPosition>[] {
  return [
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
    { key: "dayChange", type: "number", sortable: true, value: (position) => (position.dayChange === null ? null : position.dayChange * 100) },
    { key: "dailyPnl", type: "number", sortable: true, value: (position) => position.dailyPnl },
    { key: "unrealizedPnl", type: "number", sortable: true, value: (position) => position.unrealizedPnl },
    { key: "decision", type: "enum", sortable: true, value: (position) => position.decision },
    { key: "coverage", type: "enum", sortable: false, value: (position) => coverageValues(position) },
  ];
}

export type PositionColumnKey = (typeof POSITION_COLUMNS)[number]["key"];

/**
 * The eleven columns of the Wheel's assigned shares: its own table, so its own floor, measured on
 * its own (sub-project 23) rather than assumed from POSITION_COLUMNS' 62rem — eleven columns, not
 * twelve, none of them the variable-length contract label that drives `position`'s margin above.
 * Same method: each column's widest unwrappable word plus its sort chevron, a numeric column's
 * full cell besides (an amount or a percentage never wraps), rounded up to the nearest 0.25 %,
 * `position` taking whatever is left. The table sits at its 48rem minimum, the smallest whole-rem
 * width at which every rounded share still meets its own measured requirement (47rem left
 * `position` 6 px short). They add up to 100.
 */
export const WHEEL_SHARE_COLUMNS = [
  { key: "position", width: "11%", numeric: false },
  { key: "sector", width: "9.5%", numeric: false },
  { key: "quantity", width: "10%", numeric: true },
  { key: "averageAssignmentPrice", width: "8.75%", numeric: true },
  { key: "averageCallStrike", width: "8.75%", numeric: true },
  { key: "assignedTotal", width: "14%", numeric: true },
  { key: "lastPrice", width: "8.75%", numeric: true },
  { key: "dayChange", width: "5.5%", numeric: true },
  { key: "dailyPnl", width: "5.75%", numeric: true },
  { key: "unrealizedPnl", width: "7.25%", numeric: true },
  { key: "coverage", width: "10.75%", numeric: false },
] as const satisfies readonly { key: string; width: string; numeric: boolean }[];
