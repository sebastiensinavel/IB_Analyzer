import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CashCheck, LedgerRow } from "@ib/ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ib/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ib/ui/tooltip";
import { DataTable } from "@/components/table/DataTable";
import { formatAmount } from "@/lib/format";
import { POSITION_COLUMNS } from "@/lib/positionColumns";

interface CashBalancesCardProps {
  /** `anchoredBalances` over the whole ledger of the account, oldest first. */
  rows: LedgerRow[];
  checks: CashCheck[];
}

/**
 * The cash of each currency now: the last anchored balance of the History, so it carries the
 * rows after the latest Cash Report, the agent's intraday executions included. Laid out on the
 * columns of the position tables, one row per currency under Position and Market value, the
 * other columns left empty; what the balance is anchored on sits in a tooltip on the currency.
 * Whether it comes back to the Starting Cash is the Consistency page's business.
 */
export function CashBalancesCard({ rows, checks }: CashBalancesCardProps) {
  const { t } = useTranslation();
  const last = rows.at(-1);
  return (
    <Card aria-label={t("positions.cash.title")}>
      <CardHeader>
        <CardTitle>{t("positions.cash.title")}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <DataTable columns={POSITION_COLUMNS} minWidth="83rem">
          <TableHeader>
            <TableRow>
              {POSITION_COLUMNS.map(({ key }) =>
                key === "position" ? (
                  <TableHead key={key}>{t("positions.columns.position")}</TableHead>
                ) : key === "marketValue" ? (
                  // Bare amounts: a "$" on the EUR row would be a lie, the currency is the position.
                  <TableHead key={key} className="text-right">
                    {t("positions.columns.marketValue")}
                  </TableHead>
                ) : (
                  <TableHead key={key} aria-hidden />
                ),
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {checks.map(({ currency, offset, end }) => {
              // An empty ledger has no row: its balance is the offset alone, which is the Ending
              // Cash when a Cash Report anchors the currency, and nothing known otherwise.
              const amount = last ? last.balances[currency] : end ? offset : null;
              return (
                <TableRow key={currency}>
                  {POSITION_COLUMNS.map(({ key }) =>
                    key === "position" ? (
                      <TableCell key={key} className="font-medium">
                        {amount === null ? (
                          currency
                        ) : (
                          <Tooltip>
                            <TooltipTrigger render={<span className="inline-flex items-center gap-1.5" />}>
                              {currency}
                              <Info aria-hidden className="size-3.5 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent>
                              {end ? t("positions.cash.anchored", { date: end.asOf }) : t("positions.cash.unanchored")}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </TableCell>
                    ) : key === "marketValue" ? (
                      <TableCell key={key} className="text-right font-mono tabular-nums">
                        {amount === null ? "—" : formatAmount(amount)}
                      </TableCell>
                    ) : (
                      <TableCell key={key} aria-hidden />
                    ),
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </DataTable>
      </CardContent>
    </Card>
  );
}
