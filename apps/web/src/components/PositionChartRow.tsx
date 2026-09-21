/**
 * La ligne injectée sous une position cliquée : le graphe du sous-jacent, avec les niveaux de
 * la stratégie de la page.
 *
 * L'agent local est optionnel (spec §2) : son absence n'est jamais une erreur, seulement un
 * message qui dit quoi installer. La ligne s'ouvre toujours, tout de suite : un clic fait
 * toujours quelque chose.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { Strategy } from "@ib/ledger";
import { strategyLevels } from "@ib/ledger";
import { TableCell, TableRow } from "@ib/ui/table";
import { fetchBars, type PriceBar } from "@/agent/client";
import { PriceChart } from "@/components/PriceChart";
import { useAccountJournals } from "@/db/AccountDataProvider";
import { useAccount } from "@/db/hooks";
import { useTheme } from "@/hooks/useTheme";

export interface PositionChartRowProps {
  ticker: string;
  strategies: readonly Strategy[];
  columnCount: number;
}

type State =
  | { status: "loading" }
  | { status: "bars"; bars: PriceBar[] }
  | { status: "no-agent" }
  | { status: "tws-down"; port: number }
  | { status: "no-bars" };

export function PositionChartRow({ ticker, strategies, columnCount }: PositionChartRowProps) {
  const { t } = useTranslation();
  const { accountId = "" } = useParams<{ accountId: string }>();
  const account = useAccount(accountId);
  // `useAccountJournals` rend une union discriminée : `{ status: "loading" }` ou
  // `{ status: "ready", report, identityIssues }` (apps/web/src/db/hooks.ts).
  const journals = useAccountJournals();
  const { isDark } = useTheme();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (account === undefined) return;
    const port = account?.twsPort;
    if (port === undefined) {
      setState({ status: "no-agent" });
      return;
    }
    let cancelled = false;
    // Aucun cache : chaque ouverture interroge TWS, barre du jour comprise.
    void fetchBars(port, ticker).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setState(result.code === "tws-unreachable" ? { status: "tws-down", port } : { status: "no-agent" });
        return;
      }
      setState(result.payload.bars.length === 0 ? { status: "no-bars" } : { status: "bars", bars: result.payload.bars });
    });
    return () => {
      cancelled = true;
    };
  }, [account, ticker]);

  // `strategies` arrive souvent en tableau littéral : c'est son contenu qui identifie la
  // portée, pas sa référence. Sans cette mémoïsation, chaque rendu de la page rendrait un
  // tableau neuf, et l'effet de dessin détacherait puis rattacherait la primitive pour rien.
  const scope = strategies.join(",");
  const levels = useMemo(
    () => (journals.status === "ready" ? strategyLevels(journals.report.rows, ticker, scope.split(",") as Strategy[]) : []),
    [journals, ticker, scope],
  );

  return (
    <TableRow data-testid="position-chart-row" className="hover:bg-transparent">
      <TableCell colSpan={columnCount} className="bg-muted/30 p-4">
        {state.status === "bars" ? (
          <PriceChart bars={state.bars} levels={levels} isDark={isDark} />
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
            {state.status === "tws-down" && <span>{t("charts.twsDown", { port: state.port })}</span>}
            {state.status === "no-bars" && <span>{t("charts.noBars", { ticker })}</span>}
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}
