import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { groupedPositions } from "@ib/coverage";
import { anchoredBalances } from "@ib/ledger";
import { buttonVariants } from "@ib/ui/button";
import { Card, CardContent } from "@ib/ui/card";
import { Input } from "@ib/ui/input";
import { CashBalancesCard } from "@/components/CashBalancesCard";
import { PositionGroupCard } from "@/components/PositionGroupCard";
import { useAccountRiskReport } from "@/db/AccountDataProvider";
import { useCashPoints, useLedger } from "@/db/hooks";
import { usePageSearch } from "@/hooks/useTableView";
import { BALANCE_CURRENCIES } from "@/lib/currencies";
import { positionColumnSpecs } from "@/lib/positionColumns";
import { groupTitleKey } from "@/lib/riskReport";
import { applyView, EMPTY_VIEW } from "@/lib/tableView";
import { pageSearchKey } from "@/lib/tableViewStorage";

export function PositionsPage() {
  const { accountId = "" } = useParams<{ accountId: string }>();
  const { t } = useTranslation();
  const { snapshot, report, sectorOf } = useAccountRiskReport();
  const specs = useMemo(() => positionColumnSpecs(sectorOf), [sectorOf]);
  const search = usePageSearch(pageSearchKey(accountId, "positions"));
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

  // Groups empty in the snapshot never show. The page search runs on the ticker, which means the
  // same thing in every group; a group it empties goes away. A group emptied by its own column
  // filters stays, so its filters can be cleared.
  const groups = groupedPositions(report.positions)
    .filter((group) => group.positions.length > 0)
    .map((group) => ({ group, searched: applyView(group.positions, specs, EMPTY_VIEW, { text: search.applied, ticker: (position) => position.symbol }) }))
    .filter(({ searched }) => searched.length > 0);

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

      {groups.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("positions.noResults")}</p>
          </CardContent>
        </Card>
      )}

      {groups.map(({ group, searched }) => (
        <PositionGroupCard
          key={group.id}
          accountId={accountId}
          groupId={group.id}
          title={t(groupTitleKey(group.id))}
          positions={group.positions}
          searched={searched}
          specs={specs}
          sectorOf={sectorOf}
        />
      ))}

      {cashCard}
    </div>
  );
}
