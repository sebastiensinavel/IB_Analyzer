/**
 * The eleven columns of the history table, in order, with their widths as a share of the table.
 * The widths are fixed because the table is virtualized: under an automatic layout, each scroll
 * renders other rows and the columns would resize under the reader. Keys are the i18n keys of
 * `history.columns`.
 */
export const HISTORY_COLUMNS = [
  { key: "dateTime", width: "14%", numeric: false, balance: false },
  { key: "type", width: "9%", numeric: false, balance: false },
  { key: "symbol", width: "17%", numeric: false, balance: false },
  { key: "quantity", width: "6%", numeric: true, balance: false },
  { key: "price", width: "7%", numeric: true, balance: false },
  { key: "totalPrice", width: "8%", numeric: true, balance: false },
  { key: "fee", width: "6%", numeric: true, balance: false },
  { key: "cash", width: "8%", numeric: true, balance: false },
  { key: "currency", width: "5%", numeric: false, balance: false },
  { key: "usdCash", width: "10%", numeric: true, balance: true },
  { key: "eurCash", width: "10%", numeric: true, balance: true },
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
