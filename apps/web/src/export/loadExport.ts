import { alertStatus, autoAlerts, manualAlerts, stateOf, type AlertState } from "@ib/alerts";
import { strategyLevels } from "@ib/ledger";
import { loadAccountJournals } from "@/db/journals";
import type { AppDatabase } from "@/db/schema";
import { heldTickers } from "@/db/sectors";
import { alertMargins } from "@/lib/alertMargins";
import { activeStrategies } from "@/lib/strategies";
import { exportLevelsOf, mergeExportLevels, type ExportLevel } from "@/lib/tradingview";

export interface ExportData {
  /** Every account's held tickers, an option under its underlying (`heldTickers`). */
  tickers: ReadonlySet<string>;
  /** Every account's levels and live alert thresholds, merged (`mergeExportLevels`). */
  levels: ExportLevel[];
}

/** One account's levels: what the Positions charts draw (active strategies plus Others), then its alerts. */
async function accountLevels(db: AppDatabase, accountId: string): Promise<ExportLevel[]> {
  const loaded = await loadAccountJournals(db, accountId);
  if (loaded === null) return [];
  const { account, journals } = loaded;
  const rows = journals.report.rows;
  const strategies = [...activeStrategies(account), "others" as const];
  const tickers = [...new Set(rows.filter((row) => row.endWhen === null).map((row) => row.ticker))].sort();
  const levels = tickers.flatMap((ticker) => exportLevelsOf(ticker, strategyLevels(rows, ticker, strategies)));

  const [defs, stored] = await Promise.all([
    db.alerts.where("accountId").equals(accountId).toArray(),
    db.alertStates.where("accountId").equals(accountId).toArray(),
  ]);
  const states = new Map(stored.map((s) => [s.alertId, s as AlertState]));
  for (const alert of [...manualAlerts(defs), ...autoAlerts(rows, alertMargins(account), states)]) {
    if (alert.thresholds === null || alertStatus(alert, stateOf(states, alert.id)) === "disabled") continue;
    for (const threshold of alert.thresholds) levels.push({ ticker: alert.ticker, kind: "alert", price: threshold.price, quantity: null });
  }
  return levels;
}

/**
 * What the Export page hands TradingView (sub-project 44): read from the base for every account at
 * once, never stored. Same journals as the alert watcher (`loadAccountJournals`).
 */
export async function loadExport(db: AppDatabase): Promise<ExportData> {
  const [accounts, snapshots] = await Promise.all([db.accounts.toArray(), db.snapshots.toArray()]);
  const perAccount = await Promise.all(accounts.map((account) => accountLevels(db, account.id)));
  return {
    tickers: heldTickers(snapshots.flatMap((snapshot) => snapshot.positions)),
    levels: mergeExportLevels(perAccount.flat()),
  };
}
