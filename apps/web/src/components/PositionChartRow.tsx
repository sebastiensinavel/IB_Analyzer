/**
 * La ligne injectée sous une position cliquée : le graphe du sous-jacent, avec les niveaux de
 * la stratégie de la page.
 *
 * L'agent local est optionnel (spec §2) : son absence n'est jamais une erreur, seulement un
 * message qui dit quoi installer. La ligne s'ouvre toujours, tout de suite : un clic fait
 * toujours quelque chose.
 */
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { Strategy } from "@ib/ledger";
import { strategyLevels } from "@ib/ledger";
import { TableCell, TableRow } from "@ib/ui/table";
import { fetchBars, type PriceBar } from "@/agent/client";
import { useAccountJournals } from "@/db/AccountDataProvider";
import { useAccount } from "@/db/hooks";
import { useTheme } from "@/hooks/useTheme";
import { chartProxyOf } from "@/lib/chartProxies";

// Chargée seulement quand un graphe s'ouvre vraiment : `lightweight-charts` ne doit pas peser
// sur l'import de tout ce qui affiche cette ligne, dont le tableau de bord (`DashboardPage`).
const PriceChart = lazy(() => import("@/components/PriceChart").then((m) => ({ default: m.PriceChart })));

export interface PositionChartRowProps {
  ticker: string;
  strategies: readonly Strategy[];
  columnCount: number;
  /** Inconnue de la carte Suggestion de position : la valeur par défaut de `fetchBars` s'applique. */
  currency?: string;
}

type State =
  | { status: "loading" }
  | { status: "bars"; bars: PriceBar[] }
  | { status: "no-agent" }
  | { status: "agent-error" }
  | { status: "tws-down"; port: number }
  | { status: "no-bars" };

export function PositionChartRow({ ticker, strategies, columnCount, currency }: PositionChartRowProps) {
  const { t } = useTranslation();
  const { accountId = "" } = useParams<{ accountId: string }>();
  const account = useAccount(accountId);
  // `useAccountJournals` rend une union discriminée : `{ status: "loading" }` ou
  // `{ status: "ready", report, identityIssues }` (apps/web/src/db/hooks.ts).
  const journals = useAccountJournals();
  const { isDark } = useTheme();
  const [state, setState] = useState<State>({ status: "loading" });

  // La fiche entière change de référence à chaque écriture dans `db.accounts`, y compris une
  // synchro qui ne note que sa date : ne dépendre que du port et du fait que la fiche soit
  // chargée évite de redemander deux ans de barres pour rien, tout en gardant la distinction
  // entre « fiche en cours de chargement » (`accountLoaded` faux) et « pas de port ».
  const accountLoaded = account !== undefined;
  const port = account?.twsPort;
  // Le titre qu'IB sait servir : le ticker lui-même, ou son substitut quand IB n'en a aucun
  // historique. Les niveaux, eux, restent calculés sur `ticker` : ce sont ses strikes.
  const proxy = chartProxyOf(ticker);
  const asked = proxy ?? ticker;

  useEffect(() => {
    if (!accountLoaded) return;
    if (port === undefined) {
      setState({ status: "no-agent" });
      return;
    }
    let cancelled = false;
    // Aucun cache : chaque ouverture interroge TWS, barre du jour comprise.
    void fetchBars(port, asked, currency).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.code === "tws-unreachable") setState({ status: "tws-down", port });
        else if (result.code === "agent-error") setState({ status: "agent-error" });
        else setState({ status: "no-agent" });
        return;
      }
      setState(result.payload.bars.length === 0 ? { status: "no-bars" } : { status: "bars", bars: result.payload.bars });
    });
    return () => {
      cancelled = true;
    };
  }, [accountLoaded, port, asked, currency]);

  const levels = useMemo(
    () => (journals.status === "ready" ? strategyLevels(journals.report.rows, ticker, strategies) : []),
    [journals, ticker, strategies],
  );

  return (
    <TableRow data-testid="position-chart-row" className="hover:bg-transparent [&:hover>td:first-child]:shadow-none">
      <TableCell colSpan={columnCount} className="bg-muted/30 p-4">
        {state.status === "bars" ? (
          <>
            {proxy !== null && (
              <p className="mb-2 text-xs text-muted-foreground">{t("charts.proxy", { proxy, ticker })}</p>
            )}
            <Suspense
              fallback={
                <div className="flex h-24 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                  <span>{t("charts.loading")}</span>
                </div>
              }
            >
              <PriceChart bars={state.bars} levels={levels} isDark={isDark} />
            </Suspense>
          </>
        ) : (
          <div className="flex h-24 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            {state.status === "loading" && <span>{t("charts.loading")}</span>}
            {state.status === "no-agent" && (
              <>
                <span>{t("charts.noAgent")}</span>
                <Link to="/help" className="underline">
                  {t("charts.noAgentLink")}
                </Link>
              </>
            )}
            {state.status === "agent-error" && <span>{t("charts.agentError")}</span>}
            {state.status === "tws-down" && <span>{t("charts.twsDown", { port: state.port })}</span>}
            {state.status === "no-bars" && <span>{t("charts.noBars", { ticker: asked })}</span>}
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
