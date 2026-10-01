/** Part du chemin S₀ → strike parcourue avant l'alerte d'un call Wheel sous assignation (spec §3.1). */
export const DEFAULT_WHEEL_ALERT_FRACTION = 0.7;
/** Part de l'écart entre strikes vendus d'un condor gardée avant chaque aile (spec §3.1). */
export const DEFAULT_CONDOR_ALERT_MARGIN = 0.15;
/** Au-delà, S₀ ne se lit plus sur le prix du moment de la découverte (spec §3.4). */
export const ANCHOR_LIVE_WINDOW_MS = 15 * 60 * 1000;
