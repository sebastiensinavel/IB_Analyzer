import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  alertBadgeCounts,
  alertStatus,
  autoAlerts,
  chooseAnchor,
  evaluateAlerts,
  manualAlerts,
  staleStateIds,
  stateOf,
  type Alert,
  type AlertBadgeCounts,
  type AlertMargins,
  type AlertState,
  type AlertStatus,
  type PriceQuote,
  type WheelAlert,
} from "@ib/alerts";
import type { JournalRow } from "@ib/ledger";
import { fetchBars } from "@/agent/client";
import { useUnderlyingQuotesMap } from "@/agent/quotes";
import { useAgentPresence } from "@/agent/useAgentSync";
import { deleteAlertStates, patchAlertStates, setAlertAnchor } from "@/db/alerts";
import { useDb } from "@/db/DbProvider";
import { useAccount, useScopedLiveQuery, type JournalsView } from "@/db/hooks";
import type { AppDatabase, SnapshotRecord } from "@/db/schema";
import { alertMargins } from "@/lib/alertMargins";
import { notifyTriggered } from "./notify";
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

interface PassInputs {
  db: AppDatabase;
  accountId: string;
  rows: readonly JournalRow[];
  margins: AlertMargins;
  priceOf: (ticker: string) => PriceQuote | null;
}

/**
 * Une passe : purge des états d'alertes automatiques disparues et transitions dues au cours, lues
 * sur les états **de la base** dans la même transaction que leur écriture — jamais sur ceux du
 * dernier rendu, qu'une écriture précédente n'a peut-être pas encore rafraîchis : une passe
 * rejouée n'écrit donc jamais deux fois la même transition, ni ne notifie deux fois.
 */
async function runPass({ db, accountId, rows, margins, priceOf }: PassInputs): Promise<{ alert: Alert; price: number | undefined }[]> {
  return db.transaction("rw", [db.alerts, db.alertStates], async () => {
    const [defs, stored] = await Promise.all([
      db.alerts.where("accountId").equals(accountId).toArray(),
      db.alertStates.where("accountId").equals(accountId).toArray(),
    ]);
    const states = new Map(stored.map((s) => [s.alertId, s]));
    const alerts: Alert[] = [...manualAlerts(defs), ...autoAlerts(rows, margins, states)];
    const stale = staleStateIds(alerts, stored);
    if (stale.length > 0) await deleteAlertStates(db, accountId, stale);
    const now = new Date().toISOString();
    const patches = evaluateAlerts(alerts, states, priceOf, now);
    await patchAlertStates(db, accountId, patches);
    const byId = new Map(alerts.map((a) => [a.id, a]));
    return patches
      .filter((p) => p.patch.triggeredAt != null)
      .map((p) => ({ alert: byId.get(p.alertId) as Alert, price: priceOf((byId.get(p.alertId) as Alert).ticker)?.price }));
  });
}

/**
 * Les alertes du compte à l'écran, évaluées dans la coquille (spec §6) : monté une fois par
 * `AccountDataProvider`. Rien ne s'écrit avant que journaux, alertes, états, compte et snapshot
 * soient chargés — et chargés pour ce compte-ci.
 */
export function useAlertEngine(accountId: string, journals: JournalsView, snapshot: SnapshotRecord | null | undefined): AlertsView {
  const db = useDb();
  const navigate = useNavigate();
  const { t } = useTranslation();
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
  const tRef = useRef(t);
  useEffect(() => {
    openAlerts.current = () => void navigate(`/accounts/${accountId}/alerts`);
    tRef.current = t;
  }, [navigate, accountId, t]);

  useEffect(() => {
    if (!ready || rows === null || margins === null) {
      latest.current = null;
      return;
    }
    latest.current = { db, accountId, rows, margins, priceOf };
    const q = queue.current;
    if (q.scheduled) return;
    q.scheduled = true;
    q.tail = q.tail.then(async () => {
      q.scheduled = false;
      const inputs = latest.current;
      if (inputs === null) return;
      try {
        const triggered = await runPass(inputs);
        for (const { alert, price } of triggered) notifyTriggered(alert, () => openAlerts.current(), tRef.current, price);
      } catch {
        // Une base fermée (onglet dépassé par un schéma plus récent) : la passe suivante réessaie.
      }
    });
    // `stored` n'est pas lu ici, mais une écriture d'état (le bouton « Vu ») doit relancer une passe.
  }, [ready, db, accountId, rows, margins, priceOf, defs, stored]);

  // S₀ : le prix du moment si la vente est fraîche, sinon la barre du jour de la vente (spec §6.2).
  const port = account?.twsPort;
  const syncedAt = account?.lastAgentSyncAt;
  const barsAsked = useRef(new Set<string>());
  useEffect(() => {
    if (!ready || alerts === null) return;
    const pending = alerts.filter((a): a is WheelAlert => a.kind === "wheel" && a.anchor === null);
    if (pending.length === 0) return;
    const live = (ticker: string) => {
      if (ownSnapshot?.source !== "agent") return null;
      const quote = priceOf(ticker);
      return quote?.realtime ? { price: quote.price, at: ownSnapshot.asOf } : null;
    };
    const needBars = new Map<string, WheelAlert[]>();
    for (const alert of pending) {
      const anchor = chooseAnchor({ saleWhen: alert.saleWhen, observedAt: new Date().toISOString(), live: live(alert.ticker), dayBar: null });
      if (anchor !== null) void setAlertAnchor(db, accountId, alert.id, anchor).catch(() => {});
      else needBars.set(`${alert.ticker}|${alert.currency}`, [...(needBars.get(`${alert.ticker}|${alert.currency}`) ?? []), alert]);
    }
    if (presence !== "present" || port === undefined) return;
    for (const [key, group] of needBars) {
      const guard = `${accountId}|${key}|${syncedAt ?? ""}`;
      if (barsAsked.current.has(guard)) continue;
      barsAsked.current.add(guard);
      const { ticker, currency } = group[0];
      void fetchBars(port, ticker, currency).then(async (result) => {
        if (!result.ok) return;
        for (const alert of group) {
          const bar = result.payload.bars.find((b) => b.date === alert.saleWhen.slice(0, 10));
          const anchor = chooseAnchor({
            saleWhen: alert.saleWhen,
            observedAt: new Date().toISOString(),
            live: null,
            dayBar: bar ? { average: bar.average, close: bar.close } : null,
          });
          if (anchor !== null) await setAlertAnchor(db, accountId, alert.id, anchor);
        }
      }).catch(() => {});
    }
  }, [ready, alerts, ownSnapshot, priceOf, presence, port, syncedAt, db, accountId]);

  return view;
}
