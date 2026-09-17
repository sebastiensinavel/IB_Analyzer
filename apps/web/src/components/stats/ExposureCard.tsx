import ReactECharts from "echarts-for-react";
import { useTranslation } from "react-i18next";
import type { StrategyCapital } from "@ib/ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@ib/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@ib/ui/table";
import { exposureOption, sectorSlices, swatchColor } from "@/lib/capitalCharts";
import { chartColors } from "@/lib/chartColors";
import { formatAmount, formatRate } from "@/lib/format";

interface ExposureCardProps {
  capital: StrategyCapital;
  /** The Wheel's split of each sector between the shares assigned and the puts' cash. */
  detailed: boolean;
  /** Said in place of the pie when nothing is open. */
  empty: string;
  sectorOf: (ticker: string) => string | null;
  isDark: boolean;
}

/**
 * What a scope ties up per sector now: a pie and its legend table, side by side when the card is
 * wide enough, the table under the pie otherwise — the same card fills a statistics page and half
 * of the dashboard.
 */
export function ExposureCard({ capital, detailed, empty, sectorOf, isDark }: ExposureCardProps) {
  const { t } = useTranslation();
  const colors = chartColors(isDark);
  const slices = sectorSlices(capital.exposure, sectorOf, t("stats.exposure.unclassified"));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("stats.exposure.title")}</CardTitle>
      </CardHeader>
      <CardContent className="@container">
        {slices.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <div className="grid items-center gap-4 @2xl:grid-cols-2">
            <div data-testid="exposure-chart" className="w-full">
              <ReactECharts
                option={exposureOption(slices, t("stats.exposure.other"), colors, capital.currency)}
                opts={{ renderer: "svg" }}
                style={{ height: 260, width: "100%" }}
              />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("stats.exposure.sector")}</TableHead>
                  {detailed && (
                    <>
                      <TableHead className="text-right">{t("stats.exposure.assigned")}</TableHead>
                      <TableHead className="text-right">{t("stats.exposure.putCash")}</TableHead>
                    </>
                  )}
                  <TableHead className="text-right">{t("stats.exposure.total")}</TableHead>
                  <TableHead className="text-right">{t("stats.exposure.share")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {slices.map((slice, index) => (
                  <TableRow key={slice.sector}>
                    <TableCell className="font-medium">
                      <span className="inline-flex items-center gap-2">
                        <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: swatchColor(slice, index, colors) }} />
                        {slice.sector}
                      </span>
                    </TableCell>
                    {detailed && (
                      <>
                        <TableCell className="text-right font-mono tabular-nums">{formatAmount(slice.assigned)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{formatAmount(slice.putCash)}</TableCell>
                      </>
                    )}
                    <TableCell className="text-right font-mono tabular-nums">{formatAmount(slice.total)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatRate(slice.share)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
