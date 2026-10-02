import { autoAlerts, evaluateAlerts, manualAlerts, staleStateIds, type Alert, type AlertMargins, type PriceQuote } from "@ib/alerts";
import type { JournalRow } from "@ib/ledger";
import { deleteAlertStates, patchAlertStates } from "@/db/alerts";
import type { AppDatabase } from "@/db/schema";

export const noPrice = (): PriceQuote | null => null;

export interface PassInputs {
  db: AppDatabase;
  accountId: string;
  rows: readonly JournalRow[];
  margins: AlertMargins;
  priceOf: (ticker: string) => PriceQuote | null;
}

export interface Triggered {
  alert: Alert;
  price: number | undefined;
}

/**
 * Une passe : purge des états d'alertes automatiques disparues et transitions dues au cours, lues
 * sur les états **de la base** dans la même transaction que leur écriture — jamais sur ceux du
 * dernier rendu, qu'une écriture précédente n'a peut-être pas encore rafraîchis : une passe
 * rejouée n'écrit donc jamais deux fois la même transition, ni ne notifie deux fois.
 */
export async function runPass({ db, accountId, rows, margins, priceOf }: PassInputs): Promise<Triggered[]> {
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
      .map((p) => {
        const alert = byId.get(p.alertId) as Alert;
        return { alert, price: priceOf(alert.ticker)?.price };
      });
  });
}
