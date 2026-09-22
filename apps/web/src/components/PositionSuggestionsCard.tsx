import { Fragment, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { MAX_SUGGESTIONS, MAX_SUGGESTION_TICKER_SHARE, MIN_SUGGESTION_SCORE, positionSuggestions, type RiskReport } from "@ib/coverage";
import { STRATEGIES } from "@ib/ledger";
import { buttonVariants } from "@ib/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ib/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ib/ui/table";
import { PositionChartRow } from "@/components/PositionChartRow";
import { useSectors } from "@/db/hooks";
import { useOpenChart } from "@/hooks/useOpenChart";
import { formatPercent, formatRate } from "@/lib/format";
import { cn } from "@/lib/utils";

const COLUMNS = [
  { key: "rank", numeric: true },
  { key: "ticker", numeric: false },
  { key: "sector", numeric: false },
  { key: "score", numeric: true },
  { key: "sectorShare", numeric: true },
  { key: "tickerShare", numeric: true },
] as const;

const NUMERIC = "text-right font-mono tabular-nums";

/** Tickers of the shared sector table worth a position on the account on screen (spec of sub-project 16, §5.4). */
export function PositionSuggestionsCard({ accountId, report }: { accountId: string; report: RiskReport | null }) {
  const { t } = useTranslation();
  const sectors = useSectors();
  // `[]` rather than `undefined` while the sector table loads: the guard below returns before
  // this value is ever read in that state, so the render needs no third case.
  const suggestions = useMemo(() => (sectors ? positionSuggestions([...sectors.values()], report) : []), [sectors, report]);
  const chart = useOpenChart();
  const title = t("dashboard.suggestions.title");

  // Nothing to suggest from, and nothing to say about it: a sector table where no ticker has
  // been scored yet cannot rank anything, so the card would only be an empty box competing with
  // whatever the page is actually telling the user to do — on a brand new account, the first
  // step. Once a single score exists the card comes back, empty state included: from then on
  // "no ticker meets the criteria" is a real answer about real rows, not a missing table.
  //
  // A table still loading counts as unscored, so the card appears once rather than flashing a
  // "Chargement…" box that a moment later has no reason to be there. That is also why the
  // render below never has to handle `suggestions === undefined`: past this line the sector
  // table has answered.
  if (!sectors || ![...sectors.values()].some((row) => row.score !== null)) return null;

  return (
    <Card aria-label={title}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {t("dashboard.suggestions.rule", { max: MAX_SUGGESTIONS, score: MIN_SUGGESTION_SCORE, share: formatPercent(MAX_SUGGESTION_TICKER_SHARE) })}
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {suggestions.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">{t("dashboard.suggestions.empty")}</p>
            <Link to={`/accounts/${accountId}/sectors`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              {t("dashboard.suggestions.emptyLink")}
            </Link>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {COLUMNS.map((column) => (
                  <TableHead key={column.key} className={cn(column.numeric && "text-right")}>
                    {t(`dashboard.suggestions.columns.${column.key}`)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {suggestions.map((suggestion) => {
                const key = `suggestions|${suggestion.ticker}`;
                return (
                  <Fragment key={suggestion.ticker}>
                    <TableRow onClick={() => chart.toggle(key)} data-state={chart.isOpen(key) ? "selected" : undefined} className="cursor-pointer">
                      <TableCell className={NUMERIC}>{suggestion.rank}</TableCell>
                      <TableCell className="font-medium">{suggestion.ticker}</TableCell>
                      <TableCell>{suggestion.sector}</TableCell>
                      <TableCell className={NUMERIC}>{suggestion.score}</TableCell>
                      <TableCell className={NUMERIC}>{formatRate(suggestion.sectorShare)}</TableCell>
                      <TableCell className={NUMERIC}>{formatRate(suggestion.tickerShare)}</TableCell>
                    </TableRow>
                    {chart.isOpen(key) && (
                      <PositionChartRow ticker={suggestion.ticker} strategies={STRATEGIES} columnCount={COLUMNS.length} />
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
