import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { anchoredBalances } from "@ib/ledger";
import { Card, CardContent } from "@ib/ui/card";
import { Input } from "@ib/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ib/ui/select";
import { HistoryTable } from "@/components/history/HistoryTable";
import { ActiveFilters } from "@/components/table/ActiveFilters";
import { useCashPoints, useLedger } from "@/db/hooks";
import { usePageSearch, useTableView } from "@/hooks/useTableView";
import { BALANCE_CURRENCIES } from "@/lib/currencies";
import { historyColumnSpecs, historyTicker } from "@/lib/historyColumns";
import { applyView, facetValues } from "@/lib/tableView";
import { pageSearchKey, tableViewKey } from "@/lib/tableViewStorage";

export function HistoryPage() {
  const { accountId = "" } = useParams<{ accountId: string }>();
  const { t } = useTranslation();
  const titleId = useId();
  const ledger = useLedger(accountId);
  const points = useCashPoints(accountId);
  const specs = useMemo(() => historyColumnSpecs((key) => t(key)), [t]);
  const table = useTableView(tableViewKey(accountId, "history"), specs);
  const search = usePageSearch(pageSearchKey(accountId, "history"));

  // Balances run over the whole ledger, oldest first, anchored on the cash points, before any
  // filter or sort: a row keeps its balance whatever the view. The default order is newest first.
  const anchored = useMemo(
    () => (ledger && points ? anchoredBalances(ledger, BALANCE_CURRENCIES, points) : undefined),
    [ledger, points],
  );
  const rows = useMemo(() => (anchored ? [...anchored.rows].reverse() : undefined), [anchored]);
  const visible = useMemo(
    () => (rows ? applyView(rows, specs, table.view, { text: search.applied, ticker: historyTicker }) : undefined),
    [rows, specs, table.view, search.applied],
  );

  const typeSpec = specs.find((spec) => spec.key === "type")!;
  const typeCriterion = table.view.criteria.type;
  const checkedTypes: readonly (string | null)[] = Array.isArray(typeCriterion) ? typeCriterion : [];
  // A stable key for the memo below: the criterion array is a new object on every stored view.
  const checkedKey = JSON.stringify(checkedTypes);
  // Counted over the whole ledger: a type does not vanish because another filter emptied its rows.
  const facets = useMemo(
    () => ({ type: rows ? facetValues(rows, typeSpec, JSON.parse(checkedKey) as (string | null)[]) : [] }),
    [rows, typeSpec, checkedKey],
  );

  if (!visible) {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  const resetKey = JSON.stringify([search.applied, table.view]);

  return (
    // 3rem is AppLayout's title bar (h-12): changing one means changing the other, there is no
    // shared variable between them.
    <div className="flex h-[calc(100svh-3rem)] flex-col gap-4 p-4 md:p-6">
      <h1 id={titleId} className="font-heading text-lg font-semibold tracking-tight">
        {t("nav.history")}
      </h1>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search.input}
          onChange={(event) => search.setInput(event.target.value)}
          placeholder={t("history.searchPlaceholder")}
          aria-label={t("history.searchLabel")}
          className="max-w-xs font-mono"
        />
        <Select
          multiple
          value={checkedTypes.filter((value): value is string => value !== null)}
          onValueChange={(next: string[]) => table.setCriterion("type", next)}
        >
          <SelectTrigger className="w-56" aria-label={t("history.kindFilter")}>
            <SelectValue>
              {(value: string[]) =>
                value.length === 0 ? t("history.allKinds") : value.map((kind) => t(`history.kinds.${kind}`)).join(", ")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {facets.type
              .filter((facet): facet is typeof facet & { value: string } => facet.value !== null)
              .map((facet) => (
                <SelectItem key={facet.value} value={facet.value}>
                  {`${facet.label} (${facet.count})`}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      <ActiveFilters
        specs={specs}
        view={table.view}
        columnLabel={(key) => t(`history.columns.${key}`)}
        onClearColumn={table.clearColumn}
        onClearAll={table.clearAll}
      />

      <Card className="min-h-0 flex-1 py-0">
        <CardContent className="flex min-h-0 flex-1 px-0">
          {/* Keyed on the account only: a new account starts at the top in a fresh container. */}
          <HistoryTable
            key={accountId}
            rows={visible}
            labelledBy={titleId}
            specs={specs}
            view={table.view}
            facets={facets}
            resetKey={resetKey}
            onSort={table.toggleSort}
            onCriterion={table.setCriterion}
          />
        </CardContent>
      </Card>
    </div>
  );
}
