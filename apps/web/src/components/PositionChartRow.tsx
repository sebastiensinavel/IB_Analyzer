/**
 * The row injected under a clicked position: one chart, full width, several rows tall.
 *
 * Prototype (branche `prototype-graphes`) : the chart is always BTDR with the two annotations
 * of `lib/chartPrototype.ts`, whatever line was clicked. Bars come from TWS through the local
 * agent; when it cannot answer, a stand-in series is drawn and said to be one.
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { Badge } from "@ib/ui/badge";
import { TableCell, TableRow } from "@ib/ui/table";
import { fetchBars, type PriceBar } from "@/agent/client";
import { PriceChart } from "@/components/PriceChart";
import { useAccount } from "@/db/hooks";
import { useTheme } from "@/hooks/useTheme";
import { demoBars, PROTOTYPE_EVENT_DATE, PROTOTYPE_LEVEL, PROTOTYPE_SYMBOL } from "@/lib/chartPrototype";

type Source = "loading" | "tws" | "demo";

export function PositionChartRow({ columnCount }: { columnCount: number }) {
  const { accountId = "" } = useParams<{ accountId: string }>();
  const account = useAccount(accountId);
  const { isDark } = useTheme();
  const [bars, setBars] = useState<readonly PriceBar[]>([]);
  const [source, setSource] = useState<Source>("loading");

  useEffect(() => {
    if (account === undefined) return;
    let cancelled = false;
    const port = account?.twsPort;
    const load = async () => {
      const result = port === undefined ? null : await fetchBars(port, PROTOTYPE_SYMBOL);
      if (cancelled) return;
      if (result?.ok && result.payload.bars.length > 0) {
        setBars(result.payload.bars);
        setSource("tws");
        return;
      }
      // The agent is optional (spec §2): no TWS is never an error, only a chart with nothing
      // real in it - and the badge says so.
      setBars(demoBars());
      setSource("demo");
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [account]);

  return (
    <TableRow data-testid="position-chart-row" className="hover:bg-transparent">
      <TableCell colSpan={columnCount} className="bg-muted/30 p-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="font-medium">{PROTOTYPE_SYMBOL}</span>
            <Badge variant="outline">{PROTOTYPE_LEVEL}</Badge>
            <Badge variant="outline">{PROTOTYPE_EVENT_DATE}</Badge>
            {source === "demo" && <Badge variant="destructive">Données de démonstration</Badge>}
            {source === "loading" && <span className="text-xs text-muted-foreground">…</span>}
          </div>
          {source !== "loading" && (
            <PriceChart bars={bars} level={PROTOTYPE_LEVEL} eventDate={PROTOTYPE_EVENT_DATE} isDark={isDark} />
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
