import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  strategyPositions,
  type PositionsStrategy,
  type PricedSnapshot,
  type RiskReport,
  type StrategyLine,
  type WheelShareLine,
} from "@ib/coverage";
import { contractId, formatContractLabel, type JournalRow } from "@ib/ledger";
import { Badge } from "@ib/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ib/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ib/ui/tooltip";
import { PositionRow } from "@/components/PositionRow";
import { DataTable, DataTableHeader } from "@/components/table/DataTable";
import { useAccountJournals, useAccountRiskReport } from "@/db/AccountDataProvider";
import type { SnapshotRecord } from "@/db/schema";
import { formatMoney, formatPrice } from "@/lib/format";
import { POSITION_COLUMNS, WHEEL_SHARE_COLUMNS } from "@/lib/positionColumns";
import { strategyCoverageBadges, usedBadge } from "@/lib/riskReport";
import { cn } from "@/lib/utils";

export type { PositionsStrategy };

type SectorOf = (symbol: string) => string | null;

const NO_ROWS: readonly JournalRow[] = [];
const NUMERIC = "text-right font-mono tabular-nums";

function pricedSnapshot(snapshot: SnapshotRecord | null | undefined, report: RiskReport | null | undefined): PricedSnapshot | null {
  return snapshot && report ? { positions: snapshot.positions, report } : null;
}

/**
 * A strategy's open positions (spec of sub-project 16, §5.2): its journal's open lines priced from
 * the snapshot, computed from what the shell already holds, never stored.
 */
export function StrategyPositionsPage({ strategy }: { strategy: PositionsStrategy }) {
  const { t } = useTranslation();
  const view = useAccountJournals();
  const { snapshot, report, sectorOf } = useAccountRiskReport();
  const ready = view.status === "ready" && snapshot !== undefined && report !== undefined;
  const rows = view.status === "ready" ? view.report.rows : NO_ROWS;
  const wheel = useMemo(
    () => (ready && strategy === "wheel" ? strategyPositions(rows, "wheel", pricedSnapshot(snapshot, report)) : null),
    [ready, strategy, rows, snapshot, report],
  );
  const leaps = useMemo(
    () => (ready && strategy === "leaps" ? strategyPositions(rows, "leaps", pricedSnapshot(snapshot, report)) : null),
    [ready, strategy, rows, snapshot, report],
  );

  if (!ready) return <div className="p-6 text-sm text-muted-foreground">{t("common.loading")}</div>;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="font-heading text-lg font-semibold tracking-tight">{t(`strategyPositions.title.${strategy}`)}</h1>
      {wheel && (
        <>
          <GroupCard title={t("strategyPositions.groups.assignedShares")} empty={wheel.shares.length === 0}>
            <WheelSharesTable lines={wheel.shares} sectorOf={sectorOf} />
          </GroupCard>
          <LinesCard title={t("strategyPositions.groups.optionSales")} lines={wheel.groups.optionSells} sectorOf={sectorOf} strategy={strategy} />
        </>
      )}
      {leaps && (
        <>
          <LinesCard title={t("strategyPositions.groups.optionBuys")} lines={leaps.groups.optionBuys} sectorOf={sectorOf} strategy={strategy} />
          <LinesCard title={t("strategyPositions.groups.optionSales")} lines={leaps.groups.optionSells} sectorOf={sectorOf} strategy={strategy} />
          {/* Shares a LEAPS delivered are rare: their card only shows when there are some. */}
          {leaps.groups.long.length > 0 && (
            <LinesCard title={t("strategyPositions.groups.shares")} lines={leaps.groups.long} sectorOf={sectorOf} strategy={strategy} />
          )}
        </>
      )}
    </div>
  );
}

function GroupCard({ title, empty, children }: { title: string; empty: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Card aria-label={title}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {empty ? <p className="text-sm text-muted-foreground">{t("strategyPositions.empty")}</p> : children}
      </CardContent>
    </Card>
  );
}

function LinesCard({
  title,
  lines,
  sectorOf,
  strategy,
}: {
  title: string;
  lines: readonly StrategyLine[];
  sectorOf: SectorOf;
  strategy: PositionsStrategy;
}) {
  return (
    <GroupCard title={title} empty={lines.length === 0}>
      <DataTable columns={POSITION_COLUMNS} minWidth="60rem">
        <DataTableHeader columns={POSITION_COLUMNS} labelKey="positions.columns" />
        <TableBody>
          {lines.map((line) => (
            <PositionRow
              key={contractId(line.contract)}
              values={{
                contract: formatContractLabel(line.contract),
                label: line.label,
                sector: sectorOf(line.contract.ticker),
                marketValue: line.marketValue,
                quantity: line.quantity,
                avgPrice: line.avgPrice,
                lastPrice: line.lastPrice,
                unrealizedPnl: line.unrealizedPnl,
                decision: line.decision,
                coverage: strategyCoverageBadges(line, strategy),
              }}
            />
          ))}
        </TableBody>
      </DataTable>
    </GroupCard>
  );
}

function WheelSharesTable({ lines, sectorOf }: { lines: readonly WheelShareLine[]; sectorOf: SectorOf }) {
  const { t } = useTranslation();
  return (
    <Table className="min-w-[60rem] table-fixed [&_td]:whitespace-normal [&_th]:whitespace-normal">
      <colgroup>
        {WHEEL_SHARE_COLUMNS.map((column) => (
          <col key={column.key} style={{ width: column.width }} />
        ))}
      </colgroup>
      <TableHeader>
        <TableRow>
          {WHEEL_SHARE_COLUMNS.map((column) => (
            <TableHead key={column.key} className={cn(column.numeric && "text-right")}>
              {t(`strategyPositions.columns.${column.key}`)}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line) => (
          <WheelShareRow key={`${line.ticker}|${line.currency}`} line={line} sector={sectorOf(line.ticker)} />
        ))}
      </TableBody>
    </Table>
  );
}

function WheelShareRow({ line, sector }: { line: WheelShareLine; sector: string | null }) {
  const { t } = useTranslation();
  const pnl = line.unrealizedPnl;
  const callPrice = formatPrice(line.averageCallStrike);
  // The same badge as the Positions page gives a long stock position, on the Wheel's own shares.
  const covered = usedBadge(line.coveredShares, line.quantity);
  return (
    <TableRow>
      <TableCell className="font-medium">{line.ticker}</TableCell>
      <TableCell>{sector && <Badge variant="outline">{sector}</Badge>}</TableCell>
      <TableCell className={NUMERIC}>{line.quantity}</TableCell>
      <TableCell className={NUMERIC}>{formatPrice(line.averageAssignmentPrice)}</TableCell>
      {line.callStrikeBelowAssignment ? (
        <TableCell className={cn(NUMERIC, "bg-warning/25")}>
          <Tooltip>
            <TooltipTrigger render={<span>{callPrice}</span>} />
            <TooltipContent>{t("strategyPositions.callBelowAssignment")}</TooltipContent>
          </Tooltip>
        </TableCell>
      ) : (
        <TableCell className={NUMERIC}>{callPrice}</TableCell>
      )}
      <TableCell className={NUMERIC}>{formatMoney(line.assignedTotal)}</TableCell>
      <TableCell className={NUMERIC}>{formatPrice(line.lastPrice)}</TableCell>
      <TableCell className={cn(NUMERIC, pnl !== null && (pnl >= 0 ? "text-success" : "text-destructive"))}>{formatMoney(pnl)}</TableCell>
      <TableCell>
        <Badge variant={covered.variant}>{covered.label}</Badge>
      </TableCell>
    </TableRow>
  );
}
