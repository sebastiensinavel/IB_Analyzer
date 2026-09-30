import { dayOf } from "@ib/ledger";
import type { PriceBar } from "@/agent/client";
import type { SnapshotRecord } from "@/db/schema";

/** La séance régulière de New York, la seule que `/bars` rend (`useRTH`), bornes comprises. */
const SESSION_OPEN = "09:30:00";
const SESSION_CLOSE = "16:00:00";

/**
 * Les barres d'un graphe, la bougie du jour clôturée sur le prix temps réel du snapshot.
 *
 * Sans abonnement temps réel, IB sert la bougie en cours avec une quinzaine de minutes de
 * retard, alors que le prix de marque du portefeuille, lui, est à l'heure : pour une action que
 * le compte détient, la dernière bougie finit donc sur le « Dernier prix » de sa ligne, son haut
 * et son bas élargis pour le contenir. Tout le reste garde les barres d'IB, rendues telles
 * quelles (même référence) : un snapshot qui ne vient pas de l'agent, une action non détenue,
 * une dernière bougie qui n'est pas celle du jour du snapshot — aucune bougie n'est inventée —,
 * un snapshot pris hors séance, dont le prix n'a rien à faire sur un graphe de séance régulière.
 *
 * `symbol` est le titre réellement tracé, substitut compris (SPY pour XSP). L'`asOf` d'un
 * snapshot de l'agent est l'heure murale de New York stampée UTC : jour et heure s'y lisent
 * sans calcul de fuseau.
 */
export function withLiveClose(
  bars: readonly PriceBar[],
  snapshot: SnapshotRecord | null | undefined,
  symbol: string,
  currency: string,
): readonly PriceBar[] {
  const last = bars.at(-1);
  if (!last || !snapshot || snapshot.source !== "agent") return bars;
  if (dayOf(snapshot.asOf) !== last.date) return bars;
  const time = snapshot.asOf.slice(11, 19);
  if (time < SESSION_OPEN || time > SESSION_CLOSE) return bars;
  const wanted = symbol.toUpperCase();
  const money = currency.toUpperCase();
  const held = snapshot.positions.find(
    (position) =>
      position.secType === "STK" &&
      position.currency === money &&
      position.symbol.toUpperCase() === wanted &&
      position.marketPrice !== null,
  );
  const price = held?.marketPrice;
  if (price === null || price === undefined) return bars;
  return [
    ...bars.slice(0, -1),
    { ...last, close: price, high: Math.max(last.high, price), low: Math.min(last.low, price) },
  ];
}
