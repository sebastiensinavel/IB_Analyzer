import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import type { JournalRow, Strategy } from "@ib/ledger";
import { Button } from "@ib/ui/button";
import { Card, CardContent } from "@ib/ui/card";
import { TableCell, TableRow } from "@ib/ui/table";
import { FilteredTableBox } from "@/components/table/FilteredTableBox";
import { PageSearchInput } from "@/components/table/PageSearchInput";
import { useAccountJournals } from "@/db/AccountDataProvider";
import { usePageSearch, useTableView } from "@/hooks/useTableView";
import { formatAmount, formatDateTime, formatPrice } from "@/lib/format";
import { JOURNAL_COLUMNS, journalColumnSpecs } from "@/lib/journalColumns";
import { LABEL_TONE_CLASS, labelTone } from "@/lib/journalTone";
import { applyView, EMPTY_VIEW } from "@/lib/tableView";
import { pageSearchKey, tableViewKey } from "@/lib/tableViewStorage";
import { cn } from "@/lib/utils";

const TITLE_KEY: Record<Strategy, string> = { wheel: "nav.wheel", leaps: "nav.leaps", condors: "nav.condors", others: "nav.others" };

function money(value: number | null): string {
  return value === null ? "—" : formatAmount(value);
}

function flag(value: boolean): string {
  return value ? "1" : "0";
}

interface JournalPageProps {
  strategy: Strategy;
}

/**
 * One strategy's journal: a calculated view of the ledger, never stored. One ticker search and one
 * sort-and-filter view, remembered per account and per strategy. The view runs on the head rows
 * only: a condor's legs stay attached to their composite and show when it is unfolded — filtering
 * them apart would detach a leg from its structure or hide a condor one of its legs matches.
 */
export function JournalPage({ strategy }: JournalPageProps) {
  const { accountId = "" } = useParams<{ accountId: string }>();
  const { t } = useTranslation();
  const journals = useAccountJournals();
  const specs = useMemo(() => journalColumnSpecs(t), [t]);
  const search = usePageSearch(pageSearchKey(accountId, `journal:${strategy}`));
  const table = useTableView(tableViewKey(accountId, `journal:${strategy}`), specs);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  if (journals.status === "loading") {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  const all = journals.report.rows.filter((row) => row.strategy === strategy);
  const searched = applyView(all, specs, EMPTY_VIEW, { text: search.applied, ticker: (row: JournalRow) => row.ticker });
  const rows = applyView(searched, specs, table.view);

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const message = all.length === 0 ? "journal.empty" : searched.length === 0 ? "journal.noResults" : null;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-heading text-lg font-semibold tracking-tight">{t(TITLE_KEY[strategy])}</h1>
      <PageSearchInput search={search} />
      {message !== null ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t(message)}</p>
          </CardContent>
        </Card>
      ) : (
        <FilteredTableBox
          columns={JOURNAL_COLUMNS}
          labelKey="journal.columns"
          specs={specs}
          facetRows={all}
          rows={rows}
          table={table}
          emptyKey="journal.noResults"
          rowKey={(row) => row.id}
          renderRow={(row) => <JournalRows row={row} expanded={expanded.has(row.id)} onToggle={() => toggle(row.id)} />}
        />
      )}
    </div>
  );
}

function JournalRows({ row, expanded, onToggle }: { row: JournalRow; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <JournalTableRow row={row} expanded={row.legs ? expanded : undefined} onToggle={onToggle} />
      {expanded && row.legs?.map((leg) => <JournalTableRow key={leg.id} row={leg} leg />)}
    </>
  );
}

function JournalTableRow({ row, leg = false, expanded, onToggle }: { row: JournalRow; leg?: boolean; expanded?: boolean; onToggle?: () => void }) {
  const { t } = useTranslation();
  const tone = labelTone(row);
  const right = "text-right font-mono tabular-nums";
  return (
    <TableRow data-testid={leg ? "journal-leg" : undefined} className={leg ? "text-muted-foreground" : undefined}>
      <TableCell>{formatDateTime(row.startWhen)}</TableCell>
      <TableCell className={cn("font-medium", leg && "pl-8", tone && LABEL_TONE_CLASS[tone])}>
        <span className="flex items-center gap-1" data-testid="journal-label">
          {expanded !== undefined && (
            <Button variant="ghost" size="icon-xs" onClick={onToggle} aria-label={t(expanded ? "journal.collapse" : "journal.expand")}>
              {expanded ? <ChevronDown /> : <ChevronRight />}
            </Button>
          )}
          {row.label}
        </span>
      </TableCell>
      <TableCell>{row.ticker}</TableCell>
      <TableCell className={right}>{row.quantity ?? "—"}</TableCell>
      <TableCell className={right}>{formatPrice(row.openPrice)}</TableCell>
      <TableCell className={right}>{money(row.openTotal)}</TableCell>
      <TableCell className={right}>{money(row.openCommission)}</TableCell>
      <TableCell className={right}>{flag(row.assigned)}</TableCell>
      <TableCell className={right}>{money(row.openNet)}</TableCell>
      <TableCell>{row.endWhen === null ? "—" : formatDateTime(row.endWhen)}</TableCell>
      <TableCell className={right}>{formatPrice(row.closePrice)}</TableCell>
      <TableCell className={right}>{money(row.closeTotal)}</TableCell>
      <TableCell className={right}>{money(row.closeCommission)}</TableCell>
      <TableCell className={right}>{money(row.closeNet)}</TableCell>
      <TableCell className={cn(right, row.pnl !== null && (row.pnl >= 0 ? "text-success" : "text-destructive"))}>{money(row.pnl)}</TableCell>
      <TableCell className={right}>{flag(row.ongoing)}</TableCell>
      <TableCell className="text-muted-foreground">
        {row.note ? t(`journal.notes.${row.note.code}`, { contract: row.note.contract }) : ""}
      </TableCell>
    </TableRow>
  );
}
