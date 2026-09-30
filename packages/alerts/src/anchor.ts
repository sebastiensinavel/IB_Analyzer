import { ANCHOR_LIVE_WINDOW_MS } from "./constants.ts";
import type { AlertAnchor } from "./types.ts";

export interface AnchorInput {
  /** Heure IB de la vente (`startWhen`). */
  saleWhen: string;
  /** Instant vrai UTC de l'observation, écrit dans l'ancre. */
  observedAt: string;
  /**
   * Prix temps réel de l'action et heure IB du snapshot `agent` qui le porte : son `asOf`, que
   * `parseAgentSnapshot` a déjà passé par `toReportTime` — jamais converti une seconde fois ici.
   */
  live: { price: number; at: string } | null;
  /** La barre journalière du jour de la vente (`saleWhen.slice(0, 10)`), si l'agent l'a rendue. */
  dayBar: { average: number | null; close: number } | null;
}

/** S₀ : le prix du moment si la vente est fraîche, sinon le VWAP du jour, sinon sa clôture (spec §3.4). */
export function chooseAnchor(input: AnchorInput): AlertAnchor | null {
  const { saleWhen, observedAt, live, dayBar } = input;
  if (live !== null) {
    const elapsed = Date.parse(live.at) - Date.parse(saleWhen);
    if (elapsed >= 0 && elapsed <= ANCHOR_LIVE_WINDOW_MS) return { price: live.price, source: "live", observedAt };
  }
  if (dayBar?.average != null) return { price: dayBar.average, source: "vwap", observedAt };
  if (dayBar !== null) return { price: dayBar.close, source: "close", observedAt };
  return null;
}
