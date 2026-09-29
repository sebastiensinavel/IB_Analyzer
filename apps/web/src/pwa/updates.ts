/** Une nouvelle version publiée est cherchée au chargement, puis à cet intervalle. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Recharge l'onglet quand une nouvelle version du Service Worker en prend le contrôle — dans
 * chaque onglet, pas seulement celui du clic sur « Recharger » : un vieil onglet chercherait
 * des fichiers `assets/*` qui n'existent plus et parlerait à une base au schéma plus récent.
 * Jamais plus d'un rechargement par onglet.
 *
 * Un onglet recharge dès le premier `controllerchange` s'il avait un contrôleur au chargement,
 * ou si l'origine avait déjà un Service Worker actif (un onglet ouvert par Maj+Recharger n'a
 * pas de contrôleur, mais son prochain changement est une vraie mise à jour). Sinon c'est
 * l'onglet de la première installation : son premier changement est la prise de contrôle de
 * `clientsClaim`, qu'il laisse passer, et il recharge au suivant — la bibliothèque ne le fait
 * pas pour lui, son `isUpdate` restant faux dans cet onglet.
 */
export function reloadOnControllerChange(
  container:
    | Pick<ServiceWorkerContainer, "controller" | "getRegistration" | "addEventListener" | "removeEventListener">
    | undefined,
  reload: () => void,
): () => void {
  if (!container) return () => {};
  // Vrai quand le prochain changement est une mise à jour, faux tant qu'on attend la prise de
  // contrôle de la première installation.
  let armed = container.controller !== null;
  let reloading = false;
  if (!armed) {
    // Un changement arrivé avant cette réponse compte pour la première installation : la
    // réponse n'est qu'un aller-retour au navigateur, alors qu'une mise à jour demande qu'un
    // nouveau Service Worker s'installe et soit activé par un clic du bandeau d'ici là.
    container
      .getRegistration()
      .then((registration) => {
        if (registration?.active) armed = true;
      })
      .catch(() => {
        // Sans réponse, la règle de la première installation s'applique.
      });
  }
  const onChange = () => {
    if (!armed) {
      armed = true;
      return;
    }
    if (reloading) return;
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
