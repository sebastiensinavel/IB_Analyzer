import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  alertBadgeCounts,
  alertStatus,
  autoAlerts,
  manualAlerts,
  stateOf,
  type Alert,
  type AlertBadgeCounts,
  type AlertMargins,
  type AlertState,
  type AlertStatus,
  type PriceQuote,
} from "@ib/alerts";
import { fetchBars } from "@/agent/client";
import { useUnderlyingQuotesMap } from "@/agent/quotes";
import { useAgentPresence } from "@/agent/useAgentSync";
import { useDb } from "@/db/DbProvider";
import { useAccount, useAccounts, useScopedLiveQuery, type JournalsView } from "@/db/hooks";
import type { SnapshotRecord } from "@/db/schema";
import { alertMargins } from "@/lib/alertMargins";
import { anchorPending } from "./anchors";
import { notifyTriggered } from "./notify";
import { noPrice, runPass, type PassInputs } from "./pass";
import { alertPriceOf } from "./prices";

export interface AlertView {
  alert: Alert;
  state: AlertState;
  status: AlertStatus;
  price: PriceQuote | null;
  /** Fraction du cours jusqu'au seuil le plus proche, négative une fois franchi ; `null` sans cours ni seuil. */
  distance: number | null;
}

export type AlertsView =
  | { status: "loading" }
  | { status: "ready"; alerts: AlertView[]; badges: AlertBadgeCounts; manualTickers: string[] };

/** Signée : positive tant qu'aucun seuil n'est atteint, la plus petite l'emporte. */
function distanceOf(alert: Alert, price: PriceQuote | null): number | null {
  if (price === null || alert.thresholds === null || alert.thresholds.length === 0 || price.price === 0) return null;
  return Math.min(
    ...alert.thresholds.map((t) => (t.direction === "above" ? t.price - price.price : price.price - t.price) / price.price),
  );
}

/**
 * Les alertes du compte à l'écran, évaluées dans la coquille (spec §6) : monté une fois par
 * `AccountDataProvider`. Rien ne s'écrit avant que journaux, alertes, états, compte et snapshot
 * soient chargés — et chargés pour ce compte-ci.
 */
export function useAlertEngine(accountId: string, journals: JournalsView, snapshot: SnapshotRecord | null | undefined): AlertsView {
  const db = useDb();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const accounts = useAccounts();
  const account = useAccount(accountId);
  const defs = useScopedLiveQuery(accountId, () => db.alerts.where("accountId").equals(accountId).toArray(), [db, accountId]);
  const stored = useScopedLiveQuery(accountId, () => db.alertStates.where("accountId").equals(accountId).toArray(), [db, accountId]);
  const quotes = useUnderlyingQuotesMap();
  const presence = useAgentPresence().status;

  const states = useMemo(() => new Map((stored ?? []).map((s) => [s.alertId, s as AlertState])), [stored]);
  const marginsKey = account ? JSON.stringify(alertMargins(account)) : null;
  const margins = useMemo<AlertMargins | null>(() => (marginsKey === null ? null : JSON.parse(marginsKey)), [marginsKey]);
  const ownSnapshot = snapshot === undefined || (snapshot !== null && snapshot.accountId !== accountId) ? undefined : snapshot;
  const priceOf = useMemo(() => alertPriceOf(ownSnapshot ?? null, quotes), [ownSnapshot, quotes]);
  const rows = journals.status === "ready" ? journals.report.rows : null;

  const alerts = useMemo(() => {
    if (rows === null || defs === undefined || stored === undefined || margins === null) return null;
    return [...manualAlerts(defs), ...autoAlerts(rows, margins, states)];
  }, [rows, defs, stored, margins, states]);
  const ready = alerts !== null && ownSnapshot !== undefined;

  const view = useMemo<AlertsView>(() => {
    if (!ready || alerts === null || rows === null) return { status: "loading" };
    return {
      status: "ready",
      alerts: alerts.map((alert) => {
        const state = stateOf(states, alert.id);
        const price = priceOf(alert.ticker);
        return { alert, state, status: alertStatus(alert, state), price, distance: distanceOf(alert, price) };
      }),
      badges: alertBadgeCounts(alerts, states, rows),
      manualTickers: [...new Set(alerts.filter((a) => a.kind === "manual").map((a) => a.ticker))].sort(),
    };
  }, [ready, alerts, rows, states, priceOf]);

  // Évaluation et purge : une passe à la fois, la dernière entrée gagne. Une passe demandée
  // pendant qu'une autre tourne attend son tour et lit alors les entrées les plus récentes.
  const latest = useRef<PassInputs | null>(null);
  const queue = useRef<{ tail: Promise<void>; scheduled: boolean }>({ tail: Promise.resolve(), scheduled: false });
  const openAlerts = useRef<() => void>(() => {});
  const tRef = useRef({ t, locale: i18n.language, named: false });
  useEffect(() => {
    openAlerts.current = () => void navigate(`/accounts/${accountId}/alerts`);
    tRef.current = { t, locale: i18n.language, named: (accounts?.length ?? 0) > 1 };
  }, [navigate, accountId, t, i18n.language, accounts]);

  useEffect(() => {
    if (!ready || rows === null || margins === null) {
      latest.current = null;
      return;
    }
    // Sans agent, aucun cours n'est frais : le snapshot `agent` stocké et les cotations en mémoire
    // peuvent dater de la veille (un rechargement au matin, TWS pas encore lancé). La passe purge
    // alors toujours, mais ne déclenche ni ne réarme rien.
    latest.current = { db, accountId, rows, margins, priceOf: presence === "present" ? priceOf : noPrice };
    const q = queue.current;
    if (q.scheduled) return;
    q.scheduled = true;
    q.tail = q.tail.then(async () => {
      q.scheduled = false;
      const inputs = latest.current;
      if (inputs === null) return;
      try {
        const triggered = await runPass(inputs);
        for (const { alert, price } of triggered) notifyTriggered(alert, () => openAlerts.current(), tRef.current.t, tRef.current.locale, price, tRef.current.named ? inputs.accountId : undefined);
      } catch {
        // Une base fermée (onglet dépassé par un schéma plus récent) : la passe suivante réessaie.
      }
    });
    // `stored` n'est pas lu ici, mais une écriture d'état (le bouton « Vu ») doit relancer une passe.
  }, [ready, db, accountId, rows, margins, priceOf, presence, defs, stored]);

  // S₀ : le prix du moment si la vente est fraîche, sinon la barre du jour de la vente (spec §6.2).
  const port = account?.twsPort;
  const syncedAt = account?.lastAgentSyncAt;
  useEffect(() => {
    if (!ready || alerts === null) return;
    void anchorPending(db, accountId, alerts, {
      snapshot: ownSnapshot ?? null, priceOf, port, agentPresent: presence === "present", syncedAt,
      observedAt: new Date().toISOString(), fetchBars,
    });
  }, [ready, alerts, ownSnapshot, priceOf, presence, port, syncedAt, db, accountId]);

  return view;
}
