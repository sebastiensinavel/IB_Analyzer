import { Fragment } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CondorLegLine, CondorLine } from "@ib/coverage";
import { formatContractLabel } from "@ib/ledger";
import { Badge } from "@ib/ui/badge";
import { Button } from "@ib/ui/button";
import { TableCell, TableRow } from "@ib/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ib/ui/tooltip";
import { NUMERIC, toneOf } from "@/components/PositionRow";
import { formatDayChange, formatMoney, formatPrice } from "@/lib/format";
import { decisionBadge, uncoveredBadge } from "@/lib/riskReport";
import { cn } from "@/lib/utils";

/**
 * One condor and, unfolded, its four legs, on the twelve POSITION_COLUMNS (spec of sub-project 34,
 * §3–§4). A click on the row opens the chart like any position line; the chevron only folds.
 */
export function CondorRows({
  line,
  sector,
  unfolded,
  onFold,
  onChart,
  charted,
}: {
  line: CondorLine;
  sector: string | null;
  unfolded: boolean;
  onFold: () => void;
  onChart: () => void;
  charted: boolean;
}) {
  const { t } = useTranslation();
  const decision = decisionBadge(line.decision);
  const partial = line.kind === "partial_iron_condor";
  const pnl = formatMoney(line.pnl);
  return (
    <Fragment>
      <TableRow onClick={onChart} data-state={charted ? "selected" : undefined} className="cursor-pointer">
        <TableCell className="font-medium">
          <span className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0"
              onClick={(event) => {
                event.stopPropagation();
                onFold();
              }}
              aria-label={t(unfolded ? "journal.collapse" : "journal.expand")}
            >
              {unfolded ? <ChevronDown /> : <ChevronRight />}
            </Button>
            {/* A bare text node is an anonymous flex item whose default min-width: auto refuses to
                shrink below its full content width, so it overflows the fixed-width column instead
                of wrapping (a long condor title, unlike a two-line option label, overran the 12%
                position column into the Type column). min-w-0 lets it shrink; break-normal keeps
                a strike like "480/485" from splitting mid-number, and a <wbr /> after each "/"
                offers the browser a break point there instead, so "0/525" never lands alone on a
                line (spec of sub-project 34, review finding). */}
            <span className="min-w-0 break-normal">
              {line.title.split("/").map((part, index, parts) => (
                <Fragment key={index}>
                  {part}
                  {index < parts.length - 1 && (
                    <Fragment>
                      /<wbr />
                    </Fragment>
                  )}
                </Fragment>
              ))}
            </span>
          </span>
        </TableCell>
        <TableCell className="text-muted-foreground">{line.label}</TableCell>
        <TableCell>{sector && <Badge variant="outline">{sector}</Badge>}</TableCell>
        <TableCell className={NUMERIC}>{formatMoney(line.marketValue)}</TableCell>
        <TableCell className={NUMERIC}>{line.quantity}</TableCell>
        <TableCell className={NUMERIC}>{formatPrice(line.credit)}</TableCell>
        <TableCell className={NUMERIC}>{formatPrice(line.closingCost)}</TableCell>
        <TableCell className={NUMERIC}>{formatDayChange(null)}</TableCell>
        <TableCell className={cn(NUMERIC, toneOf(line.dailyPnl))}>{formatMoney(line.dailyPnl)}</TableCell>
        <TableCell className={cn(NUMERIC, toneOf(line.pnl))}>
          {partial ? (
            <Tooltip>
              <TooltipTrigger render={<span>{pnl}</span>} />
              <TooltipContent>{t("strategyPositions.realizedPart", { amount: formatMoney(line.realizedPnl) })}</TooltipContent>
            </Tooltip>
          ) : (
            pnl
          )}
        </TableCell>
        <TableCell>{decision && <Badge variant={decision.variant}>{decision.label}</Badge>}</TableCell>
        <TableCell>{line.naked > 0 && <NakedBadge quantity={line.naked} />}</TableCell>
      </TableRow>
      {unfolded && line.legs.map((leg) => <LegRow key={`${leg.contract.right}${leg.contract.strike}`} leg={leg} sector={sector} />)}
    </Fragment>
  );
}

function NakedBadge({ quantity }: { quantity: number }) {
  const badge = uncoveredBadge(quantity);
  return <Badge variant={badge.variant}>{badge.label}</Badge>;
}

function LegRow({ leg, sector }: { leg: CondorLegLine; sector: string | null }) {
  const { t } = useTranslation();
  return (
    <TableRow data-testid="condor-leg" className="text-muted-foreground">
      <TableCell className="pl-10">{formatContractLabel(leg.contract)}</TableCell>
      <TableCell>{leg.closed ? `${leg.label} · ${t("strategyPositions.closedLeg")}` : leg.label}</TableCell>
      <TableCell>{sector && <Badge variant="outline">{sector}</Badge>}</TableCell>
      <TableCell className={NUMERIC}>{formatMoney(leg.marketValue)}</TableCell>
      <TableCell className={NUMERIC}>{leg.quantity}</TableCell>
      <TableCell className={NUMERIC}>{formatPrice(leg.openPrice)}</TableCell>
      <TableCell className={NUMERIC}>{formatPrice(leg.lastPrice)}</TableCell>
      <TableCell className={cn(NUMERIC, toneOf(leg.dayChange))}>{formatDayChange(leg.dayChange)}</TableCell>
      <TableCell className={cn(NUMERIC, toneOf(leg.dailyPnl))}>{formatMoney(leg.dailyPnl)}</TableCell>
      <TableCell className={cn(NUMERIC, toneOf(leg.pnl))}>{formatMoney(leg.pnl)}</TableCell>
      <TableCell />
      <TableCell>{leg.naked > 0 && <NakedBadge quantity={leg.naked} />}</TableCell>
    </TableRow>
  );
}
