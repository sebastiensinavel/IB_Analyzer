import { tickerOf, type LedgerRow, type Strategy } from "@ib/ledger";
import { formatContract, formatDateTime } from "@/lib/format";
import type { ColumnSpec } from "@/lib/tableView";

/**
 * The twelve columns of the history table, in order, with their widths as a share of the table.
 * The widths are fixed because the table is virtualized: under an automatic layout, each scroll
 * renders other rows and the columns would resize under the reader. Keys are the i18n keys of
 * `history.columns`.
 *
 * They add up to 100 and are measured at 1280 px on the French labels, the longest, where the table
 * sits at its 64rem minimum (1024 px, 10.24 px per percent). Each column takes the room its header
 * needs — the label whole on one line, sort chevron included, a pixel or two to spare — and what is
 * left goes to the data: first `dateTime`, wide enough for a whole `YYYY-MM-DD HH:MM:SS` (172 px
 * measured, cell padding included), then `symbol`, then the amounts. Two labels are abbreviated
 * rather than fed, `Qté` and `Dev.`, because spelling them out would eat a data column for a word
 * the reader does not need.
 *
 * `strategy` stacks its badges one under the other in compact badges (`StrategyStack`), so it needs
 * the width of one badge only: its widest line, `Condors` then a `+1` for a third strategy, is 89 px
 * with the cell padding, just over its header's 81 px. What that leaves `symbol` (138 px) still
 * clips a long option label (`AAPL Oct17'26 150 Put`, 178 px); its title keeps it whole. `type` and
 * the amounts are at their header's width: no width shows `Opération sur titre`, `Dividende` (82 px)
 * or a five-figure amount whole here.
 */
export const HISTORY_COLUMNS = [
  { key: "dateTime", width: "17%", numeric: false, balance: false },
  { key: "type", width: "6%", numeric: false, balance: false },
  { key: "symbol", width: "13.5%", numeric: false, balance: false },
  { key: "strategy", width: "8.75%", numeric: false, balance: false },
  { key: "quantity", width: "5.5%", numeric: true, balance: false },
  { key: "price", width: "5.75%", numeric: true, balance: false },
  { key: "totalPrice", width: "6.75%", numeric: true, balance: false },
  { key: "fee", width: "6.25%", numeric: true, balance: false },
  { key: "cash", width: "6.5%", numeric: true, balance: false },
  { key: "currency", width: "5.75%", numeric: false, balance: false },
  { key: "usdCash", width: "9.25%", numeric: true, balance: true },
  { key: "eurCash", width: "9%", numeric: true, balance: true },
] as const satisfies readonly { key: string; width: string; numeric: boolean; balance: boolean }[];

/**
 * Every body row is exactly this tall: Tailwind's `h-9` on each cell, no vertical padding, never
 * wrapped. The virtualizer never measures: row i starts at i × HISTORY_ROW_HEIGHT, which is what
 * lets the timeline bar place a month exactly. A taller row would put it off.
 */
export const HISTORY_ROW_HEIGHT = 36;

/** The sticky header row: `TableHead`'s own `h-10`. */
export const HISTORY_HEADER_HEIGHT = 40;

/** How long the timeline's floating month lingers once a scroll stops. */
export const SCRUB_LABEL_LINGER_MS = 1000;

export type Translate = (key: string, options?: { defaultValue?: string }) => string;

/**
 * The strategies a transaction served, by its externalId (`transactionStrategies`), or `null` while
 * the journals load. Never stored: the page derives it from the shell's journals.
 */
export type StrategiesOf = ((externalId: string) => readonly Strategy[]) | null;

/**
 * What each column of the history compares, filters and sorts on: what its cell shows. Same keys and
 * order as HISTORY_COLUMNS. The balances are the anchored running balances, computed over the whole
 * ledger before any filter, so a row keeps its balance whatever the view.
 */
export function historyColumnSpecs(t: Translate, strategiesOf: StrategiesOf): ColumnSpec<LedgerRow>[] {
  return [
    { key: "dateTime", type: "date", sortable: true, value: (row) => formatDateTime(row.transaction.when) },
    {
      key: "type",
      type: "enum",
      sortable: true,
      value: (row) => row.transaction.kind,
      label: (kind) => t(`history.kinds.${kind}`, { defaultValue: kind }),
    },
    { key: "symbol", type: "text", sortable: true, value: (row) => formatContract(row.transaction) || row.transaction.description },
    {
      key: "strategy",
      type: "enum",
      // Several values per row, like Positions' Coverage: the view engine sorts no list.
      sortable: false,
      value: (row) => strategiesOf?.(row.transaction.externalId) ?? [],
      label: (strategy) => t(`history.strategies.${strategy}`),
    },
    { key: "quantity", type: "number", sortable: true, value: (row) => row.transaction.quantity },
    { key: "price", type: "number", sortable: true, value: (row) => row.transaction.price },
    { key: "totalPrice", type: "number", sortable: true, value: (row) => row.transaction.amount },
    { key: "fee", type: "number", sortable: true, value: (row) => row.transaction.commission },
    { key: "cash", type: "number", sortable: true, value: (row) => row.cash },
    { key: "currency", type: "text", sortable: true, value: (row) => row.transaction.currency },
    { key: "usdCash", type: "number", sortable: true, value: (row) => row.balances.USD },
    { key: "eurCash", type: "number", sortable: true, value: (row) => row.balances.EUR },
  ];
}

/** The ticker the page search reads: the underlying of an option, null for a cash movement. */
export function historyTicker(row: LedgerRow): string | null {
  return row.transaction.symbol ? tickerOf(row.transaction.symbol) : null;
}
