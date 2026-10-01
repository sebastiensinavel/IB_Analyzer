/**
 * La géométrie des gestes d'alerte sur un graphe (spec du sous-projet 42, §8.2), sans rien du
 * graphe lui-même : quelle ligne le pointeur touche, quel prix une hauteur désigne.
 */
import { roundToCent } from "@ib/alerts";

/** La distance verticale, en pixels CSS, à laquelle le pointeur saisit une ligne d'alerte. */
export const ALERT_HIT_TOLERANCE_PX = 4;

/** La distance, en pixels CSS, du centre de la pastille d'une alerte à laquelle un clic la touche. */
export const ALERT_BELL_HIT_RADIUS_PX = 8;

/** La ligne la plus proche de `y`, à `tolerance` pixels au plus ; `null` sinon. */
export function hitAlert(
  y: number,
  alerts: readonly { id: string; y: number | null }[],
  tolerance: number = ALERT_HIT_TOLERANCE_PX,
): string | null {
  let best: { id: string; distance: number } | null = null;
  for (const alert of alerts) {
    if (alert.y === null) continue;
    const distance = Math.abs(alert.y - y);
    if (distance <= tolerance && (best === null || distance < best.distance)) best = { id: alert.id, distance };
  }
  return best?.id ?? null;
}

/** La pastille la plus proche du point, à `radius` pixels au plus de son centre ; `null` sinon. */
export function hitBell(
  point: { x: number; y: number },
  bells: readonly { id: string; x: number; y: number | null }[],
  radius: number = ALERT_BELL_HIT_RADIUS_PX,
): string | null {
  let best: { id: string; distance: number } | null = null;
  for (const bell of bells) {
    if (bell.y === null) continue;
    const distance = Math.hypot(bell.x - point.x, bell.y - point.y);
    if (distance <= radius && (best === null || distance < best.distance)) best = { id: bell.id, distance };
  }
  return best?.id ?? null;
}

/** Le prix que désigne la hauteur `y`, arrondi au cent ; `null` hors de l'échelle. */
export function priceAtY(y: number, coordinateToPrice: (y: number) => number | null): number | null {
  const price = coordinateToPrice(y);
  return price === null ? null : roundToCent(price);
}

/** L'identifiant de l'alerte d'une ligne dessinée : `chartAlerts` suffixe chaque seuil de `#<indice>`. */
export function baseAlertId(drawnId: string): string {
  return drawnId.replace(/#\d+$/, "");
}
