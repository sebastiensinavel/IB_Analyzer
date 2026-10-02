import { autoAlerts, manualAlerts, type AlertState } from "@ib/alerts";
import type { BarsResult } from "@/agent/client";
import type { QuoteMap } from "@/agent/quotes";
import { loadAccountJournals } from "@/db/journals";
import type { AppDatabase } from "@/db/schema";
import { alertMargins } from "@/lib/alertMargins";
import { anchorPending } from "./anchors";
import { noPrice, runPass, type Triggered } from "./pass";
import { alertPriceOf } from "./prices";

export interface EvaluateAccountDeps {
  /** false after a failed agent pass: no price is fresh, the pass only purges. */
  fresh: boolean;
  /** Quotes the tickers into the in-memory table (`refreshQuotes`). */
  quote: (port: number, tickers: readonly string[]) => Promise<void>;
  /** The in-memory quote table (`getQuotesSnapshot`). */
  quotes: () => QuoteMap;
  fetchBars: (port: number, symbol: string, currency?: string) => Promise<BarsResult>;
  now: () => Date;
}

/**
 * One account's alerts evaluated outside React, by the watcher (sub-project 43, §4): its journals
 * read from the base, its alerts' tickers quoted, the shell's own pass, then S₀. No React, no DOM:
 * what a Worker would run.
 */
export async function evaluateAccountAlerts(db: AppDatabase, accountId: string, deps: EvaluateAccountDeps): Promise<Triggered[]> {
  const loaded = await loadAccountJournals(db, accountId);
  if (loaded === null) return [];
  const { account, snapshot, journals } = loaded;
  const rows = journals.report.rows;
  const margins = alertMargins(account);
  const [defs, stored] = await Promise.all([
    db.alerts.where("accountId").equals(accountId).toArray(),
    db.alertStates.where("accountId").equals(accountId).toArray(),
  ]);
  const states = new Map(stored.map((s) => [s.alertId, s as AlertState]));
  const alerts = [...manualAlerts(defs), ...autoAlerts(rows, margins, states)];
  const port = account.twsPort;
  if (deps.fresh && port !== undefined) {
    const tickers = [...new Set(alerts.map((a) => a.ticker))].sort();
    if (tickers.length > 0) await deps.quote(port, tickers);
  }
  const priceOf = deps.fresh ? alertPriceOf(snapshot, deps.quotes()) : noPrice;
  const triggered = await runPass({ db, accountId, rows, margins, priceOf });
  if (deps.fresh) {
    await anchorPending(db, accountId, alerts, {
      snapshot, priceOf, port, agentPresent: true, syncedAt: account.lastAgentSyncAt,
      observedAt: deps.now().toISOString(), fetchBars: deps.fetchBars,
    });
  }
  return triggered;
}
