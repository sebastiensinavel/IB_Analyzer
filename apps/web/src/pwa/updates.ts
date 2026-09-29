/** Une nouvelle version publiée est cherchée au chargement, puis à cet intervalle. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Recharge l'onglet quand une nouvelle version du Service Worker en prend le contrôle — dans
 * chaque onglet, pas seulement celui du clic sur « Recharger » : un vieil onglet chercherait
 * des fichiers `assets/*` qui n'existent plus et parlerait à une base au schéma plus récent.
 * Un onglet sans contrôleur au démarrage est celui de la première installation
 * (`clientsClaim`) : il ne recharge pas.
 */
export function reloadOnControllerChange(
  container: Pick<ServiceWorkerContainer, "controller" | "addEventListener" | "removeEventListener"> | undefined,
  reload: () => void,
): () => void {
  if (!container) return () => {};
  const hadController = container.controller !== null;
  let reloading = false;
  const onChange = () => {
    if (!hadController || reloading) return;
    reloading = true;
    reload();
  };
  container.addEventListener("controllerchange", onChange);
  return () => container.removeEventListener("controllerchange", onChange);
}

/** Cherche une nouvelle version toutes les heures, sauf hors ligne ; un échec est silencieux. */
export function scheduleUpdateChecks(
  registration: Pick<ServiceWorkerRegistration, "update">,
  isOnline: () => boolean,
  intervalMs = UPDATE_CHECK_INTERVAL_MS,
): () => void {
  const id = setInterval(() => {
    if (!isOnline()) return;
    registration.update().catch(() => {
      // Serveur en maintenance : on réessaiera à l'heure suivante.
    });
  }, intervalMs);
  return () => clearInterval(id);
}
