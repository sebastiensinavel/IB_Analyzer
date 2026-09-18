import { KIND_LABELS, type AnalyzedPosition, type PositionKind } from "@ib/coverage";
import { formatContract } from "@/lib/format";
import { coverageValues } from "@/lib/riskReport";
import type { ColumnSpec } from "@/lib/tableView";

/**
 * The twelve columns every table of the Positions page shares, in order, the cash table
 * included. Their widths are fixed, as a share of the table, so the tables line up whatever
 * their content. Re-measured for sub-project 23 at 1280 px wide, an agent snapshot synced so
 * `dayChange`/`dailyPnl` carry real numbers rather than dashes, where the table sits above its
 * 83rem minimum: a long contract wraps to a second line rather than pushing Coverage out of
 * sight, and each French header — the longest — takes at most two lines with its sort chevron,
 * no word of it overflowing onto its neighbour. They add up to 100.
 *
 * Each column takes what its header needs, then what its cells need when a wrap would hurt: an
 * amount never wraps, so `marketValue`, `dailyPnl` and `unrealizedPnl` hold their widest figure
 * whole, and neither does a percentage, so `dayChange` does too. The extra `quantity` and
 * `decision` ask for — `Qté` and `Décision` are single words, which cannot wrap — comes from
 * `type` and `coverage`, whose cells wrap by design. `avgPrice` is abbreviated to `Prix init.`
 * rather than fed: spelled out it would take a data column's room.
 */
export const POSITION_COLUMNS = [
  { key: "position", width: "14.75%", numeric: false },
  { key: "type", width: "8.25%", numeric: false },
  { key: "sector", width: "6.75%", numeric: false },
  { key: "marketValue", width: "12.25%", numeric: true },
  { key: "quantity", width: "4.5%", numeric: true },
  { key: "avgPrice", width: "6.75%", numeric: true },
  { key: "lastPrice", width: "8.75%", numeric: true },
  { key: "dayChange", width: "6.75%", numeric: true },
  { key: "dailyPnl", width: "7%", numeric: true },
  { key: "unrealizedPnl", width: "8.25%", numeric: true },
  { key: "decision", width: "7.25%", numeric: false },
  { key: "coverage", width: "8.75%", numeric: false },
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

/** The nine columns of the Wheel's assigned shares, fixed widths like the Positions page. */
export const WHEEL_SHARE_COLUMNS = [
  { key: "position", width: "12%", numeric: false },
  { key: "sector", width: "11%", numeric: false },
  { key: "quantity", width: "8%", numeric: true },
  { key: "averageAssignmentPrice", width: "10%", numeric: true },
  { key: "averageCallStrike", width: "11%", numeric: true },
  { key: "assignedTotal", width: "12%", numeric: true },
  { key: "lastPrice", width: "10%", numeric: true },
  { key: "unrealizedPnl", width: "12%", numeric: true },
  { key: "coverage", width: "14%", numeric: false },
] as const satisfies readonly { key: string; width: string; numeric: boolean }[];
