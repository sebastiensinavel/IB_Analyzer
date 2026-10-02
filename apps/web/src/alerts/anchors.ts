import { ANCHOR_LIVE_WINDOW_MS, chooseAnchor, type Alert, type PriceQuote, type WheelAlert } from "@ib/alerts";
import { toReportTime } from "@ib/ib-parsers";
import type { BarsResult } from "@/agent/client";
import { setAlertAnchor } from "@/db/alerts";
import type { AppDatabase, SnapshotRecord } from "@/db/schema";

export interface AnchorInputs {
  snapshot: SnapshotRecord | null;
  priceOf: (ticker: string) => PriceQuote | null;
  port: number | undefined;
  agentPresent: boolean;
  /** `lastAgentSyncAt` of the account: the bars are asked again only after a new agent pass. */
  syncedAt: string | undefined;
  /** True UTC instant of the observation. */
  observedAt: string;
  fetchBars: (port: number, symbol: string, currency?: string) => Promise<BarsResult>;
}

// Shared by the shell's engine and the watcher (sub-project 43): one request per account,
// ticker and agent pass, whoever asks.
const barsAsked = new Set<string>();

/** Test seam. */
export function resetAnchorGuards(): void {
  barsAsked.clear();
}

/**
 * S₀ of the Wheel alerts still without one (spec of sub-project 42, §6.2): the price of the moment
 * if the sale is fresh, else the sale day's bar. Never throws: a failed write or request leaves
 * S₀ to the next pass.
 */
export async function anchorPending(db: AppDatabase, accountId: string, alerts: readonly Alert[], inputs: AnchorInputs): Promise<void> {
  const pending = alerts.filter((a): a is WheelAlert => a.kind === "wheel" && a.anchor === null);
  if (pending.length === 0) return;
  const { snapshot, priceOf, observedAt } = inputs;
  const live = (ticker: string) => {
    if (snapshot?.source !== "agent") return null;
    const quote = priceOf(ticker);
    return quote?.realtime ? { price: quote.price, at: snapshot.asOf } : null;
  };
  const writes: Promise<unknown>[] = [];
  const needBars = new Map<string, WheelAlert[]>();
  // `saleWhen` est une heure IB : l'instant présent s'y compare une fois passé par `toReportTime`.
  const nowReport = Date.parse(toReportTime(observedAt));
  for (const alert of pending) {
    const anchor = chooseAnchor({ saleWhen: alert.saleWhen, observedAt, live: live(alert.ticker), dayBar: null });
    if (anchor !== null) writes.push(setAlertAnchor(db, accountId, alert.id, anchor));
    // Tant que la fenêtre est ouverte, seul le prix du moment vaut S₀ : un VWAP de journée
    // entamée serait figé à sa place. On attend un snapshot `agent` pris dans la fenêtre.
    else if (nowReport - Date.parse(alert.saleWhen) > ANCHOR_LIVE_WINDOW_MS) {
      const key = `${alert.ticker}|${alert.currency}`;
      needBars.set(key, [...(needBars.get(key) ?? []), alert]);
    }
  }
  const { port } = inputs;
  if (inputs.agentPresent && port !== undefined) {
    for (const [key, group] of needBars) {
      const guard = `${accountId}|${key}|${inputs.syncedAt ?? ""}`;
      if (barsAsked.has(guard)) continue;
      barsAsked.add(guard);
      const { ticker, currency } = group[0];
      writes.push(
        inputs.fetchBars(port, ticker, currency).then(async (result) => {
          if (!result.ok) return;
          for (const alert of group) {
            const bar = result.payload.bars.find((b) => b.date === alert.saleWhen.slice(0, 10));
            const anchor = chooseAnchor({ saleWhen: alert.saleWhen, observedAt, live: null, dayBar: bar ? { average: bar.average, close: bar.close } : null });
            if (anchor !== null) await setAlertAnchor(db, accountId, alert.id, anchor);
          }
        }),
      );
    }
  }
  await Promise.all(writes.map((write) => write.catch(() => {})));
}
