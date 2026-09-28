import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { DETAIL_GROUPS, groupedPositions, liquidationValue, type AnalyzedPosition, type DetailGroupId } from "@ib/coverage";
import { buttonVariants } from "@ib/ui/button";
import { Card, CardContent } from "@ib/ui/card";
import { CashBalancesCard } from "@/components/CashBalancesCard";
import { ExpiryFilterBar } from "@/components/ExpiryFilterBar";
import { headerTotals, HeaderTotals, type HeaderTotalsValue } from "@/components/HeaderTotals";
import { PositionGroupCard } from "@/components/PositionGroupCard";
import { PageSearchInput } from "@/components/table/PageSearchInput";
import { useAccountRiskReport } from "@/db/AccountDataProvider";
import { useCurrentCash } from "@/hooks/useCurrentCash";
import { useOpenChart } from "@/hooks/useOpenChart";
import { usePositionGroupViews } from "@/hooks/usePositionGroupViews";
import { usePageSearch } from "@/hooks/useTableView";
import { useUnderlyingDayChange } from "@/hooks/useUnderlyingDayChange";
import { expiryChoices, reportToday } from "@/lib/expiryFilter";
import { positionColumnSpecs } from "@/lib/positionColumns";
import { groupTitleKey } from "@/lib/riskReport";
import { activeExpiry, filterBoxes, searchBoxes } from "@/lib/tableBoxes";
import { activeCriteria } from "@/lib/tableView";
import { pageSearchKey } from "@/lib/tableViewStorage";

const POSITION_TOTALS_PICK = {
  daily: (p: AnalyzedPosition) => p.dailyPnl,
  value: (p: AnalyzedPosition) => p.marketValue,
  pnl: (p: AnalyzedPosition) => p.unrealizedPnl,
};

export function PositionsPage() {
  const { accountId = "" } = useParams<{ accountId: string }>();
  const { t } = useTranslation();
  const { snapshot, report, sectorOf } = useAccountRiskReport();
  const resolveUnderlying = useUnderlyingDayChange();
  const underlyingOf = useCallback((ticker: string) => resolveUnderlying(ticker).value, [resolveUnderlying]);
  const specs = useMemo(() => positionColumnSpecs(sectorOf, underlyingOf), [sectorOf, underlyingOf]);
  const search = usePageSearch(pageSearchKey(accountId, "positions"));
  const views = usePositionGroupViews(accountId, specs);
  const setExpiry = useCallback(
    (label: string | null) => DETAIL_GROUPS.forEach((group) => views[group.id].setCriterion("position", label)),
    [views],
  );
  // One chart at a time for the whole page, whichever group holds the line.
  const chart = useOpenChart();
  // The cash comes from the ledger, not the snapshot: shown with or without positions.
  const current = useCurrentCash(accountId);
  const cashCard = current && <CashBalancesCard rows={current.anchored.rows} checks={current.anchored.checks} />;

  if (report === undefined || snapshot === undefined) {
    return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  if (report === null || snapshot === null) {
    return (
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <h1 className="font-heading text-lg font-semibold tracking-tight">{t("nav.positions")}</h1>
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("positions.empty")}</p>
            <Link to={`/accounts/${accountId}/sources`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("positions.emptyLink")}
            </Link>
          </CardContent>
        </Card>
        {cashCard}
      </div>
    );
  }

  // Which boxes show, and what each one holds: lib/tableBoxes.ts, shared with the strategy pages.
  const ids = DETAIL_GROUPS.map((group) => group.id);
  const viewOf = Object.fromEntries(ids.map((id) => [id, views[id].view]));
  const searched = searchBoxes(
    groupedPositions(report.positions).map((group) => ({ id: group.id, title: t(groupTitleKey(group.id)), all: group.positions })),
    specs,
    { text: search.applied, ticker: (position: AnalyzedPosition) => position.symbol },
  );

  // The buttons follow the ticker search but never the column filters: the expiry chosen would
  // otherwise be the only one left to choose.
  const choices = expiryChoices(searched.flatMap((box) => box.searched), reportToday());
  const expiry = activeExpiry(choices, ids, viewOf);
  const boxes = filterBoxes(searched, specs, viewOf, expiry !== null);

  // Page header: the sum of what the boxes actually show (spec §5), cash included only when no
  // search or column filter narrows the page — a filter takes the cash out and says so.
  const shown = boxes.flatMap((box) => box.rows);
  const filtered = search.applied.trim() !== "" || ids.some((id) => activeCriteria(specs, viewOf[id]).length > 0);
  // A currency's cash joins the value when the page shows a position in it, or when it is known
  // and not zero: a USD-only account draws no EUR line, but a USD cash not known stays missing.
  const shownCurrencies = new Set(shown.map((p) => p.currency));
  const cash =
    current &&
    Object.fromEntries(Object.entries(current.cash).filter(([currency, value]) => shownCurrencies.has(currency) || (value !== null && value !== 0)));
  const pageTotals: HeaderTotalsValue = {
    ...headerTotals(shown, (p) => p.currency, POSITION_TOTALS_PICK),
    ...(filtered ? { valueNote: t("totals.cashExcluded") } : { value: liquidationValue(shown, cash) }),
  };

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="font-heading text-lg font-semibold tracking-tight">{t("nav.positions")}</h1>
        <div data-testid="page-totals">
          <HeaderTotals totals={pageTotals} />
        </div>
      </div>

      <PageSearchInput search={search} />

      <ExpiryFilterBar choices={choices} active={expiry} onPick={setExpiry} />

      {boxes.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("positions.noResults")}</p>
          </CardContent>
        </Card>
      )}

      {boxes.map((box) => (
        <PositionGroupCard
          key={box.id}
          title={box.title as string}
          positions={box.facetRows}
          rows={box.rows}
          table={views[box.id as DetailGroupId]}
          specs={specs}
          sectorOf={sectorOf}
          chart={chart}
          boxId={box.id}
          totals={headerTotals(box.rows, (p) => p.currency, POSITION_TOTALS_PICK)}
        />
      ))}

      {cashCard}
    </div>
  );
}
