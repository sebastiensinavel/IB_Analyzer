import type Dexie from "dexie";

/**
 * Un autre onglet ouvre la base à un schéma plus récent (sous-projet 40) : c'est ce code-ci qui
 * est dépassé. Normalement tous les onglets changent de version ensemble (bandeau
 * « Recharger »), mais Maj+Recharger contourne le Service Worker. On ferme la connexion — sans
 * quoi la mise à niveau de l'autre onglet resterait bloquée — et on recharge.
 */
export function reloadOnVersionChange(database: Dexie, reload: () => void): void {
  database.on("versionchange", () => {
    database.close();
    reload();
    return false;
  });
}
