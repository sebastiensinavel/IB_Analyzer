/**
 * Les sous-jacents que TWS cote comme un indice, jamais comme une action : ticker -> place de
 * cotation. Le Mini-SPX (XSP) est un indice CBOE ; le graphe, lui, le dessine encore par SPY
 * (`chartProxies.ts`), faute d'historique d'indice souscrit. La table vit ici, l'agent ne connaît
 * aucun de ces tickers.
 */
export const INDEX_EXCHANGES: Readonly<Record<string, string>> = { XSP: "CBOE" };

/** La place de cotation de `ticker` s'il est un indice, `null` sinon. */
export function indexExchangeOf(ticker: string): string | null {
  return INDEX_EXCHANGES[ticker.toUpperCase()] ?? null;
}
