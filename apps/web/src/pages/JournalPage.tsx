import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { JournalRow, Strategy } from "@ib/ledger";
import { Button } from "@ib/ui/button";
import { Card, CardContent } from "@ib/ui/card";
import { Input } from "@ib/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ib/ui/table";
import { useAccountJournals } from "@/db/AccountDataProvider";
import { formatAmount, formatDateTime, formatPrice } from "@/lib/format";
import { LABEL_TONE_CLASS, labelTone } from "@/lib/journalTone";
import { cn } from "@/lib/utils";

const TITLE_KEY: Record<Strategy, string> = { wheel: "nav.wheel", leaps: "nav.leaps", condors: "nav.condors", others: "nav.others" };

const COLUMNS = [
  "startWhen", "label", "ticker", "quantity", "openPrice", "openTotal", "openCommission", "assigned",
  "openNet", "endWhen", "closePrice", "closeTotal", "closeCommission", "closeNet", "pnl", "ongoing", "note",
] as const;

function money(value: number | null): string {
  return value === null ? "—" : formatAmount(value);
}

function flag(value: boolean): string {
  return value ? "1" : "0";
}

interface JournalPageProps {
  strategy: Strategy;
}

export function JournalPage({ strategy }: JournalPageProps) {
  const { t } = useTranslation();
  const view = useAccountJournals();
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  if (view.status === "loading") {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  const rows = view.report.rows.filter((row) => row.strategy === strategy);
  const filtered = rows.filter((row) => row.ticker.toLowerCase().includes(filter.trim().toLowerCase()));

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-heading text-lg font-semibold tracking-tight">{t(TITLE_KEY[strategy])}</h1>
      <Input
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder={t("journal.filterPlaceholder")}
        aria-label={t("journal.filterPlaceholder")}
      />
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t(rows.length === 0 ? "journal.empty" : "journal.noResults")}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {COLUMNS.map((column) => (
                    <TableHead key={column} className={column === "label" || column === "ticker" || column === "note" || column.endsWith("When") ? undefined : "text-right"}>
                      {t(`journal.columns.${column}`)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <JournalRows key={row.id} row={row} expanded={expanded.has(row.id)} onToggle={() => toggle(row.id)} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
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
