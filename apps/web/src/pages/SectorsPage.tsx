import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@ib/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { Input } from "@ib/ui/input";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@ib/ui/table";
import { SectorAddRow } from "@/components/sectors/SectorAddRow";
import { SectorRow } from "@/components/sectors/SectorRow";
import { CATEGORY_LIST_ID, STATUS_LIST_ID } from "@/components/sectors/lists";
import { useDb } from "@/db/DbProvider";
import { useHeldTickers, useSectors } from "@/db/hooks";
import type { SectorRecord } from "@/db/schema";
import { importSectorCsv, type SectorImportReport } from "@/db/sectors";
import { formatDateTime } from "@/lib/format";

const COLUMNS = ["ticker", "name", "category", "score", "status", "ongoing"] as const;
const RIGHT_ALIGNED = new Set<string>(["score", "ongoing"]);

/** A row is shown when its ticker, name or sector contains the filter, case aside. */
function matches(record: SectorRecord, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  return needle === "" || [record.ticker, record.name, record.category].some((value) => value.toLowerCase().includes(needle));
}

/** The non-empty values of one field, once each, sorted: what a datalist offers. */
function distinct(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value !== ""))].sort((a, b) => a.localeCompare(b));
}

/**
 * The user's sector table: one table for every account, merged from a CSV. It lives under the
 * account's routes only so the shell stays alive around it.
 */
export function SectorsPage() {
  const { t } = useTranslation();
  const db = useDb();
  const sectors = useSectors();
  const held = useHeldTickers();
  const [report, setReport] = useState<SectorImportReport | null>(null);
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => (sectors ? [...sectors.values()].sort((a, b) => a.ticker.localeCompare(b.ticker)) : []), [sectors]);
  const visible = useMemo(() => rows.filter((record) => matches(record, filter)), [rows, filter]);
  const categories = useMemo(() => distinct(rows.map((record) => record.category)), [rows]);
  const statuses = useMemo(() => distinct(rows.map((record) => record.status)), [rows]);
  // The latest write of any row, not an arbitrary one: rows now carry different instants.
  const lastUpdate = rows.reduce<string | null>((latest, record) => (latest === null || record.updatedAt > latest ? record.updatedAt : latest), null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      setReport(await importSectorCsv(db, file));
    } catch (e) {
      setReport({ status: "error", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-heading text-lg font-semibold tracking-tight">{t("nav.sectors")}</h1>
      <p className="text-sm text-muted-foreground">{t("sectors.intro")}</p>

      <Card data-testid="sector-import">
        <CardHeader>
          <CardTitle>{t("sectors.import.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t("sectors.import.hint")}</p>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            aria-label={t("sectors.import.button")}
            className="sr-only"
            disabled={importing}
            onChange={handleFile}
          />
          <div>
            <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={importing}>
              {t(importing ? "sectors.import.importing" : "sectors.import.button")}
            </Button>
          </div>
          {report && (
            <p data-testid="sector-report" className={report.status === "error" ? "text-sm text-destructive" : "text-sm"}>
              {report.status === "ok"
                ? t("sectors.import.ok", { added: report.added, updated: report.updated })
                : t("sectors.import.error", { detail: report.detail })}
            </p>
          )}
        </CardContent>
      </Card>

      <Card data-testid="sector-table">
        <CardHeader>
          <CardTitle>{t("sectors.table.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {sectors && (
            <p className="text-sm">
              {lastUpdate === null
                ? t("sectors.table.empty")
                : t("sectors.table.summary", { count: rows.length, date: formatDateTime(lastUpdate) })}
            </p>
          )}
          <label className="flex max-w-xs flex-col gap-1 text-sm">
            {t("sectors.table.filter")}
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {COLUMNS.map((column) => (
                    <TableHead key={column} className={RIGHT_ALIGNED.has(column) ? "text-right" : undefined}>
                      {t(`sectors.table.columns.${column}`)}
                    </TableHead>
                  ))}
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                <SectorAddRow />
                {visible.map((record) => (
                  <SectorRow key={record.ticker} record={record} ongoing={held && held.has(record.ticker)} />
                ))}
              </TableBody>
            </Table>
          </div>
          <datalist id={CATEGORY_LIST_ID}>
            {categories.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
          <datalist id={STATUS_LIST_ID}>
            {statuses.map((status) => (
              <option key={status} value={status} />
            ))}
          </datalist>
          {rows.length > 0 && visible.length === 0 && <p className="text-sm text-muted-foreground">{t("sectors.table.noMatch")}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
