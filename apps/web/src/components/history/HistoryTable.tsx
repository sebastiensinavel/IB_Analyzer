import { memo, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { LedgerRow } from "@ib/ledger";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ib/ui/table";
import { TimelineScrubber } from "@/components/history/TimelineScrubber";
import { formatAmount, formatContract, formatDateTime, formatPrice } from "@/lib/format";
import { HISTORY_COLUMNS, HISTORY_HEADER_HEIGHT, HISTORY_ROW_HEIGHT, SCRUB_LABEL_LINGER_MS } from "@/lib/historyColumns";
import { buildTimeline } from "@/lib/historyTimeline";

const OVERSCAN = 10;
// One height for every body cell (HISTORY_ROW_HEIGHT): h-9, no vertical padding, clipped rather
// than wrapped. The border sits on the cell, inside that height, since the table's borders are
// separate.
const CELL = "h-9 truncate border-b py-0";
const NUMERIC_CELL = `${CELL} text-right font-mono tabular-nums`;

export interface HistoryTableProps {
  /** The filtered rows, newest first. */
  rows: readonly LedgerRow[];
  /** Id of the page heading that names the scrolling region. */
  labelledBy: string;
}

/**
 * The history as one scrolling table: sticky header, only the rows in view rendered, and the
 * timeline bar along its right edge. The page remounts it (`key`) when a filter changes: a fresh
 * scroll container starts at its top before anything is painted, while a row arriving live
 * leaves the reader where they are.
 *
 * Not `Table` from @ib/ui: its `overflow-x-auto` wrapper would become the header's scrolling
 * ancestor, and the header would stick to it rather than to the container that scrolls.
 */
export function HistoryTable({ rows, labelledBy }: HistoryTableProps) {
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
        className="min-w-0 flex-1 overflow-auto [scrollbar-width:thin]"
      >
        <table className="w-full min-w-[64rem] table-fixed caption-bottom border-separate border-spacing-0 text-sm">
          <colgroup>
            {HISTORY_COLUMNS.map((column) => (
              <col key={column.key} style={{ width: column.width }} />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow className="border-b-0 hover:bg-transparent">
              {HISTORY_COLUMNS.map((column) => (
                <TableHead
                  key={column.key}
                  className={`sticky top-0 z-10 truncate border-b bg-card ${column.numeric ? "text-right" : ""}`}
                  // Anchored on the cash points when a file carries a Cash Report; the Consistency
                  // page checks it, the title says so on the column itself.
                  title={column.balance ? t("history.columns.balanceHint") : undefined}
                >
                  {t(`history.columns.${column.key}`)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paddingTop > 0 && <SpacerRow height={paddingTop} />}
            {items.map((item) => (
              <TransactionRow key={item.key} row={rows[item.index]} />
            ))}
            {paddingBottom > 0 && <SpacerRow height={paddingBottom} />}
          </TableBody>
        </table>
      </div>
      <TimelineScrubber
        timeline={timeline}
        total={rows.length}
        firstVisible={firstVisible}
        visibleCount={visibleCount}
        height={viewport}
        scrolling={virtualizer.isScrolling}
        onSeek={seek}
      />
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
      <TableCell className={NUMERIC_CELL}>{transaction.quantity ?? "—"}</TableCell>
      <TableCell className={NUMERIC_CELL}>{transaction.price === null ? "—" : formatPrice(transaction.price)}</TableCell>
      <TableCell className={NUMERIC_CELL}>{transaction.amount === null ? "—" : formatAmount(transaction.amount)}</TableCell>
      <TableCell className={NUMERIC_CELL}>
        {transaction.commission === null ? "—" : formatAmount(transaction.commission)}
      </TableCell>
      <TableCell className={NUMERIC_CELL}>{cash === null ? "—" : formatAmount(cash)}</TableCell>
      <TableCell className={`${CELL} text-muted-foreground`}>{transaction.currency}</TableCell>
      {/* Running balances, not this row's impact: they are shown on every
          row, including one that moves the other currency. */}
      <TableCell className={NUMERIC_CELL}>{formatAmount(balances.USD)}</TableCell>
      <TableCell className={NUMERIC_CELL}>{formatAmount(balances.EUR)}</TableCell>
    </TableRow>
  );
});
