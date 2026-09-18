import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { DETAIL_GROUPS, groupedPositions, type AnalyzedPosition, type DetailGroupId } from "@ib/coverage";
import { anchoredBalances } from "@ib/ledger";
import { buttonVariants } from "@ib/ui/button";
import { Card, CardContent } from "@ib/ui/card";
import { Input } from "@ib/ui/input";
import { CashBalancesCard } from "@/components/CashBalancesCard";
import { ExpiryFilterBar } from "@/components/ExpiryFilterBar";
import { PositionGroupCard } from "@/components/PositionGroupCard";
import { useAccountRiskReport } from "@/db/AccountDataProvider";
import { useCashPoints, useLedger } from "@/db/hooks";
import { usePositionGroupViews } from "@/hooks/usePositionGroupViews";
import { usePageSearch } from "@/hooks/useTableView";
import { BALANCE_CURRENCIES } from "@/lib/currencies";
import { expiryChoices, reportToday } from "@/lib/expiryFilter";
import { positionColumnSpecs } from "@/lib/positionColumns";
import { groupTitleKey } from "@/lib/riskReport";
import { activeExpiry, filterBoxes, searchBoxes } from "@/lib/tableBoxes";
import { pageSearchKey } from "@/lib/tableViewStorage";

export function PositionsPage() {
  const { accountId = "" } = useParams<{ accountId: string }>();
  const { t } = useTranslation();
  const { snapshot, report, sectorOf } = useAccountRiskReport();
  const specs = useMemo(() => positionColumnSpecs(sectorOf), [sectorOf]);
  const search = usePageSearch(pageSearchKey(accountId, "positions"));
  const views = usePositionGroupViews(accountId, specs);
  const setExpiry = useCallback(
    (label: string | null) => DETAIL_GROUPS.forEach((group) => views[group.id].setCriterion("position", label)),
    [views],
  );
  const ledger = useLedger(accountId);
  const points = useCashPoints(accountId);
  // The cash comes from the ledger, not the snapshot: shown with or without positions.
  const anchored = useMemo(
    () => (ledger && points ? anchoredBalances(ledger, BALANCE_CURRENCIES, points) : undefined),
    [ledger, points],
  );
  const cashCard = anchored && <CashBalancesCard rows={anchored.rows} checks={anchored.checks} />;

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

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-heading text-lg font-semibold tracking-tight">{t("nav.positions")}</h1>

      <Input
        value={search.input}
        onChange={(event) => search.setInput(event.target.value)}
        placeholder={t("positions.searchPlaceholder")}
        aria-label={t("positions.searchLabel")}
        className="font-mono"
      />

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
        />
      ))}

      {cashCard}
    </div>
  );
}
