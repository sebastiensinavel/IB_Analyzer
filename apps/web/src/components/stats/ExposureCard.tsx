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
  /** Said in place of the donut when nothing is open. */
  empty: string;
  sectorOf: (ticker: string) => string | null;
  isDark: boolean;
  /** The dashboard's legend table: sector and share only, no amounts. */
  shareOnly?: boolean;
}

/**
 * What a scope ties up per sector now: its legend table on the right at its own width, scrolling
 * within the donut's height under a sticky header, and the donut on the left in the rest, 13 rem at
 * least. The same card fills a statistics page and the dashboard, whose table keeps the sector and
 * its share alone. Only a very narrow card puts the table under the donut.
 */
export function ExposureCard({ capital, detailed, empty, sectorOf, isDark, shareOnly = false }: ExposureCardProps) {
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
          <div className="grid items-center gap-6 @md:grid-cols-[minmax(13rem,1fr)_auto]">
            <div data-testid="exposure-chart" className="relative w-full">
              <ReactECharts
                option={exposureOption(slices, t("stats.exposure.other"), colors, capital.currency)}
                opts={{ renderer: "svg" }}
                style={{ height: 260, width: "100%" }}
              />
              {/* The largest sector in the hole, as the mockup names its largest class. */}
              <div data-testid="exposure-center" className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="max-w-[120px] text-center">
                  <b className="block font-mono text-xl font-semibold tracking-tight tabular-nums">{formatRate(slices[0].share)}</b>
                  <span className="block truncate text-[11px] text-subtle-foreground">{slices[0].sector}</span>
                </div>
              </div>
            </div>
            <div
              data-testid="exposure-table"
              className="max-h-[260px] overflow-y-auto [&_[data-slot=table-container]]:overflow-visible"
            >
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>{t("stats.exposure.sector")}</TableHead>
                    {detailed && (
                      <>
                        <TableHead className="text-right">{t("stats.exposure.assigned")}</TableHead>
                        <TableHead className="text-right">{t("stats.exposure.putCash")}</TableHead>
                      </>
                    )}
                    {!shareOnly && <TableHead className="text-right">{t("stats.exposure.total")}</TableHead>}
                    <TableHead className="text-right">{t("stats.exposure.share")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slices.map((slice, index) => (
                    <TableRow key={slice.sector}>
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-2">
                          <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: swatchColor(slice, index, colors) }} />
                          {slice.sector}
                        </span>
                      </TableCell>
                      {detailed && (
                        <>
                          <TableCell className="text-right font-mono tabular-nums">{formatAmount(slice.assigned)}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{formatAmount(slice.putCash)}</TableCell>
                        </>
                      )}
                      {!shareOnly && <TableCell className="text-right font-mono tabular-nums">{formatAmount(slice.total)}</TableCell>}
                      <TableCell className="text-right font-mono tabular-nums text-subtle-foreground">{formatRate(slice.share)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
