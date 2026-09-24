import { memo, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { LedgerRow } from "@ib/ledger";
import { TableBody, TableCell, TableHeader, TableRow } from "@ib/ui/table";
import { TimelineScrubber } from "@/components/history/TimelineScrubber";
import { ColumnHeader } from "@/components/table/ColumnHeader";
import { formatAmount, formatContract, formatDateTime, formatPrice } from "@/lib/format";
import { HISTORY_COLUMNS, HISTORY_HEADER_HEIGHT, HISTORY_ROW_HEIGHT, SCRUB_LABEL_LINGER_MS } from "@/lib/historyColumns";
import { buildTimeline } from "@/lib/historyTimeline";
import type { ColumnSpec, Criterion, Facet, SortDirection, TableView } from "@/lib/tableView";

const OVERSCAN = 10;
// One height for every body cell (HISTORY_ROW_HEIGHT): h-9, no vertical padding, clipped rather
// than wrapped. The border sits on the cell, inside that height, since the table's borders are
// separate.
const CELL = "h-9 truncate border-b py-0";
const NUMERIC_CELL = `${CELL} text-right font-mono tabular-nums`;

export interface HistoryTableProps {
  /** The rows the view keeps, in its order: newest first without a sort. */
  rows: readonly LedgerRow[];
  /** Id of the page heading that names the scrolling region. */
  labelledBy: string;
  /** Same keys and order as HISTORY_COLUMNS. */
  specs: readonly ColumnSpec<LedgerRow>[];
  view: TableView;
  /** Values offered by each enum column's filter, by column key. */
  facets: Readonly<Record<string, readonly Facet[]>>;
  /** Any change scrolls back to the top; a live row does not change it. */
  resetKey: string;
  onSort: (column: string, dir: SortDirection | null, additive: boolean) => void;
  onCriterion: (column: string, criterion: Criterion | null) => void;
}

/**
 * The history as one scrolling table: sticky, sortable and filterable header, only the rows in view
 * rendered, and the timeline bar along its right edge while no sort is applied. The page does not
 * remount it when the view changes: a new `resetKey` brings it back to its top, while a row
 * arriving live leaves the reader where they are.
 *
 * Not `Table` from @ib/ui: its `overflow-x-auto` wrapper would become the header's scrolling
 * ancestor, and the header would stick to it rather than to the container that scrolls.
 */
export function HistoryTable({ rows, labelledBy, specs, view, facets, resetKey, onSort, onCriterion }: HistoryTableProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  // A stable function: getItemKey is a dependency of the virtualizer's measurement memo, so a new
  // function identity on every render would rebuild every row's measurement on each scroll frame.
  const getItemKey = useCallback((index: number) => rows[index].transaction.externalId, [rows]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => HISTORY_ROW_HEIGHT,
    getItemKey,
    overscan: OVERSCAN,
    // React 19 warns on flushSync from a lifecycle; an ordinary re-render is enough here.
    useFlushSync: false,
    // isScrolling is what shows the timeline's floating month during an ordinary scroll.
    isScrollingResetDelay: SCRUB_LABEL_LINGER_MS,
  });

  // Back to the top on a new search, criterion or sort. Not a remount: the filter popovers live in
  // this header and would close under the reader's fingers. The synchronous scroll event lets the
  // virtualizer read the new offset before paint; a row arriving live leaves resetKey unchanged.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || element.scrollTop === 0) return;
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  }, [resetKey]);

  const timeline = useMemo(() => buildTimeline(rows.map((row) => row.transaction.when)), [rows]);

  const items = virtualizer.getVirtualItems();
  const paddingTop = items[0]?.start ?? 0;
  const paddingBottom = virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0);
  const viewport = virtualizer.scrollRect?.height ?? 0;
  const firstVisible = Math.max(0, Math.min(rows.length - 1, Math.floor((virtualizer.scrollOffset ?? 0) / HISTORY_ROW_HEIGHT)));
  const visibleCount = Math.max(1, Math.floor((viewport - HISTORY_HEADER_HEIGHT) / HISTORY_ROW_HEIGHT));

  // Written straight into scrollTop, not through virtualizer.scrollToOffset: that one calls
  // Element.scrollTo, which jsdom lacks. The browser fires a scroll event and the virtualizer follows.
  const seek = (rowIndex: number) => {
    if (scrollRef.current) scrollRef.current.scrollTop = rowIndex * HISTORY_ROW_HEIGHT;
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 gap-1">
      <div
        ref={scrollRef}
        role="region"
        aria-labelledby={labelledBy}
        tabIndex={0}
        className="min-w-0 flex-1 overflow-auto"
      >
        <table className="w-full min-w-[64rem] table-fixed caption-bottom border-separate border-spacing-0 text-sm">
          <colgroup>
            {HISTORY_COLUMNS.map((column) => (
              <col key={column.key} style={{ width: column.width }} />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow className="border-b-0 hover:bg-transparent">
              {HISTORY_COLUMNS.map((column, index) => (
                <ColumnHeader
                  key={column.key}
                  meta={specs[index]}
                  label={t(`history.columns.${column.key}`)}
                  view={view}
                  facets={facets[column.key]}
                  numeric={column.numeric}
                  className={`sticky top-0 z-10 border-b bg-card ${column.numeric ? "text-right" : ""}`}
                  // Anchored on the cash points when a file carries a Cash Report; the Consistency
                  // page checks it, the title says so on the column itself.
                  title={column.balance ? t("history.columns.balanceHint") : undefined}
                  onSort={(dir, additive) => onSort(column.key, dir, additive)}
                  onCriterion={(criterion) => onCriterion(column.key, criterion)}
                />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={HISTORY_COLUMNS.length} className="py-12 text-center text-sm text-muted-foreground">
                  {t("history.noResults")}
                </td>
              </tr>
            )}
            {paddingTop > 0 && <SpacerRow height={paddingTop} />}
            {items.map((item) => (
              <TransactionRow key={item.key} row={rows[item.index]} />
            ))}
            {paddingBottom > 0 && <SpacerRow height={paddingBottom} />}
          </TableBody>
        </table>
      </div>
      {view.sort.length === 0 && (
        <TimelineScrubber
          timeline={timeline}
          total={rows.length}
          firstVisible={firstVisible}
          visibleCount={visibleCount}
          height={viewport}
          scrolling={virtualizer.isScrolling}
          onSeek={seek}
        />
      )}
    </div>
  );
}

/** Stands for the rows out of view. Hidden from assistive tech: it is not a row of the history. */
function SpacerRow({ height }: { height: number }) {
  return (
    <tr aria-hidden="true" style={{ height }}>
      <td colSpan={HISTORY_COLUMNS.length} className="p-0" />
    </tr>
  );
}

// Memoized: each scroll re-render would otherwise re-render every row in view (formatting, ~11
// cells each) although its `row` object is unchanged.
const TransactionRow = memo(function TransactionRow({ row }: { row: LedgerRow }) {
  const { t } = useTranslation();
  const { transaction, cash, balances } = row;
  // Cash movements (deposits, dividends, fees) carry no symbol; IB's own
  // description is the only thing that tells two of them apart.
  const label = formatContract(transaction) || transaction.description;
  return (
    <TableRow className="border-b-0">
      <TableCell className={CELL}>{formatDateTime(transaction.when)}</TableCell>
      <TableCell className={`${CELL} text-muted-foreground`}>
        {t(`history.kinds.${transaction.kind}`, { defaultValue: transaction.kind })}
      </TableCell>
      {/* IB descriptions run up to 512 chars: the fixed column clips them, the title keeps them. */}
      <TableCell className={`${CELL} font-medium`} title={label}>
        {label}
      </TableCell>
      <TableCell className={NUMERIC_CELL} title={transaction.quantity === null ? undefined : String(transaction.quantity)}>
        {transaction.quantity ?? "—"}
      </TableCell>
      <TableCell className={NUMERIC_CELL} title={transaction.price === null ? undefined : formatPrice(transaction.price)}>
        {transaction.price === null ? "—" : formatPrice(transaction.price)}
      </TableCell>
      <TableCell className={NUMERIC_CELL} title={transaction.amount === null ? undefined : formatAmount(transaction.amount)}>
        {transaction.amount === null ? "—" : formatAmount(transaction.amount)}
      </TableCell>
      <TableCell
        className={NUMERIC_CELL}
        title={transaction.commission === null ? undefined : formatAmount(transaction.commission)}
      >
        {transaction.commission === null ? "—" : formatAmount(transaction.commission)}
      </TableCell>
      <TableCell className={NUMERIC_CELL} title={cash === null ? undefined : formatAmount(cash)}>
        {cash === null ? "—" : formatAmount(cash)}
      </TableCell>
      <TableCell className={`${CELL} text-muted-foreground`}>{transaction.currency}</TableCell>
      {/* Running balances, not this row's impact: they are shown on every
          row, including one that moves the other currency. */}
      <TableCell className={NUMERIC_CELL} title={formatAmount(balances.USD)}>
        {formatAmount(balances.USD)}
      </TableCell>
      <TableCell className={NUMERIC_CELL} title={formatAmount(balances.EUR)}>
        {formatAmount(balances.EUR)}
      </TableCell>
    </TableRow>
  );
});
