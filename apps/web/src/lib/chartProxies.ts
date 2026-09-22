/**
 * Les sous-jacents dont Interactive Brokers ne rend aucun historique, et le titre voisin que le
 * graphe montre à leur place.
 *
 * XSP, le Mini-SPX de CBOE, est un *indice* : aucune action ne porte ce nom chez IB en USD, et
 * l'indice lui-même n'est servi qu'avec l'abonnement « CBOE Streaming Market Indexes ». Sans lui,
 * la seule façon de dessiner quelque chose sous un condor XSP est un titre qui suit le même
 * panier — SPY, à la dérive des dividendes près, un ou deux pour cent. Le graphe le dit donc en
 * toutes lettres, et les niveaux de la stratégie restent aux prix du vrai sous-jacent.
 */
const CHART_PROXIES: Readonly<Record<string, string>> = { XSP: "SPY" };

/** Le titre à demander à la place de `ticker`, ou `null` quand IB le sert lui-même. */
export function chartProxyOf(ticker: string): string | null {
  return CHART_PROXIES[ticker.toUpperCase()] ?? null;
}
