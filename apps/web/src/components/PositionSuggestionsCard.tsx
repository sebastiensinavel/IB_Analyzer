import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { MAX_SUGGESTIONS, MAX_SUGGESTION_TICKER_SHARE, MIN_SUGGESTION_SCORE, positionSuggestions, type RiskReport } from "@ib/coverage";
import { buttonVariants } from "@ib/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ib/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ib/ui/table";
import { useSectors } from "@/db/hooks";
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
  const suggestions = useMemo(() => (sectors ? positionSuggestions([...sectors.values()], report) : undefined), [sectors, report]);
  const title = t("dashboard.suggestions.title");

  return (
    <Card aria-label={title}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {t("dashboard.suggestions.rule", { max: MAX_SUGGESTIONS, score: MIN_SUGGESTION_SCORE, share: formatPercent(MAX_SUGGESTION_TICKER_SHARE) })}
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {suggestions === undefined ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : suggestions.length === 0 ? (
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
              {suggestions.map((suggestion) => (
                <TableRow key={suggestion.ticker}>
                  <TableCell className={NUMERIC}>{suggestion.rank}</TableCell>
                  <TableCell className="font-medium">{suggestion.ticker}</TableCell>
                  <TableCell>{suggestion.sector}</TableCell>
                  <TableCell className={NUMERIC}>{suggestion.score}</TableCell>
                  <TableCell className={NUMERIC}>{formatRate(suggestion.sectorShare)}</TableCell>
                  <TableCell className={NUMERIC}>{formatRate(suggestion.tickerShare)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
