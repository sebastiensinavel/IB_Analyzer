import type { JournalRow } from "@ib/ledger";
import type { ColumnDef } from "@/components/table/DataTable";
import { formatDateTime } from "@/lib/format";
import type { ColumnSpec } from "@/lib/tableView";

/**
 * The seventeen columns of a journal, in order. No width: a journal keeps the automatic layout it
 * has always had, its columns sized by their content and the card scrolling sideways below its
 * minimum. Keys are the i18n keys of `journal.columns`.
 */
export const JOURNAL_COLUMNS = [
  { key: "startWhen", numeric: false },
  { key: "label", numeric: false },
  { key: "ticker", numeric: false },
  { key: "quantity", numeric: true },
  { key: "openPrice", numeric: true },
  { key: "openTotal", numeric: true },
  { key: "openCommission", numeric: true },
  { key: "assigned", numeric: true },
  { key: "openNet", numeric: true },
  { key: "endWhen", numeric: false },
  { key: "closePrice", numeric: true },
  { key: "closeTotal", numeric: true },
  { key: "closeCommission", numeric: true },
  { key: "closeNet", numeric: true },
  { key: "pnl", numeric: true },
  { key: "ongoing", numeric: true },
  { key: "note", numeric: false },
] as const satisfies readonly ColumnDef[];

export type Translate = (key: string, options?: Record<string, unknown>) => string;

const flag = (value: boolean) => (value ? "1" : "0");

/**
 * What each column of a journal compares, filters and sorts on: what its cell shows. Same keys and
 * order as JOURNAL_COLUMNS. `assigned` and `ongoing` are enums of "1" and "0" — the very text of
 * the cell — so their filter is a pair of checkboxes rather than a number to type; the note is
 * compared on its translated sentence, the one the reader sees, never on its code.
 */
export function journalColumnSpecs(t: Translate): ColumnSpec<JournalRow>[] {
  return [
    { key: "startWhen", type: "date", sortable: true, value: (row) => formatDateTime(row.startWhen) },
    { key: "label", type: "text", sortable: true, value: (row) => row.label },
    { key: "ticker", type: "text", sortable: true, value: (row) => row.ticker },
    { key: "quantity", type: "number", sortable: true, value: (row) => row.quantity },
    { key: "openPrice", type: "number", sortable: true, value: (row) => row.openPrice },
    { key: "openTotal", type: "number", sortable: true, value: (row) => row.openTotal },
    { key: "openCommission", type: "number", sortable: true, value: (row) => row.openCommission },
    { key: "assigned", type: "enum", sortable: true, value: (row) => flag(row.assigned) },
    { key: "openNet", type: "number", sortable: true, value: (row) => row.openNet },
    { key: "endWhen", type: "date", sortable: true, value: (row) => (row.endWhen === null ? null : formatDateTime(row.endWhen)) },
    { key: "closePrice", type: "number", sortable: true, value: (row) => row.closePrice },
    { key: "closeTotal", type: "number", sortable: true, value: (row) => row.closeTotal },
    { key: "closeCommission", type: "number", sortable: true, value: (row) => row.closeCommission },
    { key: "closeNet", type: "number", sortable: true, value: (row) => row.closeNet },
    { key: "pnl", type: "number", sortable: true, value: (row) => row.pnl },
    { key: "ongoing", type: "enum", sortable: true, value: (row) => flag(row.ongoing) },
    { key: "note", type: "text", sortable: true, value: (row) => (row.note ? t(`journal.notes.${row.note.code}`, { contract: row.note.contract }) : null) },
  ];
}
