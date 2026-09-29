# Sous-projet 40 — L'application s'ouvre serveur coupé, et s'installe

Statut : conçu (2026-09-29).

Tout le métier tourne dans le navigateur et toutes les données vivent en IndexedDB : une fois
chargée, l'application n'a besoin du serveur que pour le proxy Flex et la sauvegarde chiffrée.
Pourtant, serveur en maintenance, elle ne s'ouvre plus : `index.html` est servi en `no-cache`
(`apps/web/nginx.conf`), le navigateur le redemande à chaque visite, et Traefik répond 502/503 ou
rien du tout. Les fichiers `assets/*`, eux, sont déjà dans le cache HTTP, pour rien.

Ce sous-projet ajoute un Service Worker qui sert l'enveloppe de l'application depuis le cache,
vérifie en arrière-plan qu'aucune version plus récente n'est publiée, et propose de recharger
quand il y en a une. Il rend aussi l'application installable (manifeste, icônes).

---

## 1. Périmètre

**Critère de réussite :** un navigateur qui a déjà ouvert le site l'ouvre à nouveau, sur
n'importe quelle route du SPA, serveur arrêté ou répondant 502, avec toutes ses données ; la
synchro Flex et la sauvegarde y sont grisées comme aujourd'hui quand le serveur est injoignable.
Après un déploiement, un bandeau propose de recharger, et un clic fait passer tous les onglets
ouverts à la nouvelle version. Chrome et Edge proposent « Installer l'application ».

Dans le périmètre : le Service Worker et ce qu'il met en cache (§2), la mise à jour et son
bandeau (§3), le filet `versionchange` de Dexie (§4), le manifeste et les icônes (§5), la page
Aide (§6), nginx et le développement (§7), les tests (§8).

Hors périmètre : un bouton « Installer » dans l'application (celui du navigateur suffit) ; tout
cache de réponse du serveur ou de l'agent ; un mode hors ligne pour un navigateur qui n'a jamais
ouvert le site (impossible) ; les notifications push ; tout changement de Django, de Traefik ou
de l'agent.

## 2. Le Service Worker : `vite-plugin-pwa`, mode `generateSW`

`vite-plugin-pwa` (Workbox) produit au build `sw.js`, la liste exacte des fichiers de ce build
avec leur empreinte, et `manifest.webmanifest`. Écarté : un Service Worker écrit à la main (le
code où un bug fige les utilisateurs sur une vieille version, à ne pas réinventer) ; des en-têtes
`stale-while-revalidate` seuls (sans effet quand Traefik répond 502, le navigateur ayant reçu une
réponse).

- **Pré-cache** : tout ce que le build écrit dans `dist/` — `index.html`, `assets/*` (chunk
  `PriceChart` compris : un graphe dont les barres viennent de l'agent doit s'afficher serveur
  coupé), `favicon.svg`, icônes, manifeste. **Jamais `agent/**`** : `public/agent/` peut exister
  localement après `pnpm build:agent`, et la roue n'a rien à faire dans le cache.
- **Navigation** : toute navigation reçoit `index.html` depuis le pré-cache, sans attendre le
  réseau (`navigateFallback`). Sont exclus de ce repli, par `navigateFallbackDenylist`, les
  préfixes qui n'appartiennent pas au SPA : `/api`, `/_allauth`, `/static`, `/admin`, `/agent`.
  Une seule liste, dans `vite.config.ts`, commentée : elle double les règles Traefik
  (`docker-compose.yml`) et nginx (`location /agent/`).
- **Aucun cache à l'exécution** (`runtimeCaching` absent) : les appels au serveur, à l'agent
  (`127.0.0.1:8100`, autre origine, que le Service Worker ne voit de toute façon pas) et à
  `/agent/index.json` partent au réseau comme aujourd'hui. Aucune donnée de portefeuille, aucun
  jeton, aucune réponse d'API ne passe par le cache du Service Worker.
- **`clientsClaim: true`** : à la toute première installation, l'onglet qui l'a installée passe
  sous son contrôle sans rechargement, si bien qu'un chunk chargé plus tard dans cet onglet vient
  aussi du cache. Une mise à jour, elle, n'est activée que par le clic du bandeau (§3).
- **`cleanupOutdatedCaches: true`** : les pré-caches d'une version remplacée sont effacés.

Tout ce que le code de l'application sait du Service Worker vit dans `apps/web/src/pwa/` ; aucun
autre module n'importe `virtual:pwa-register`.

## 3. Mise à jour : le bandeau « Recharger »

`registerType: "prompt"` : une nouvelle version est téléchargée et mise en attente, jamais
activée d'office.

- **Détection** : au chargement de la page, puis toutes les heures (`UPDATE_CHECK_INTERVAL_MS`,
  une seule définition dans `apps/web/src/pwa/`) par `registration.update()`, sauf quand
  `navigator.onLine` est faux. Un échec (serveur coupé) est silencieux : rien ne s'affiche, on
  réessaiera à l'heure suivante.
- **Bandeau** : quand une version attend, chaque onglet ouvert affiche un bandeau non modal,
  « Nouvelle version disponible » et un bouton « Recharger ». Pas de bouton « Plus tard » : le
  bandeau peut rester, rien n'est bloqué. Il est posé dans la coquille commune, donc visible sur
  toutes les routes, Paramètres et Aide comprises, avec ou sans compte.
- **Clic** : la version en attente reçoit `SKIP_WAITING`, devient active et prend le contrôle
  des onglets. **Chaque onglet** écoute `controllerchange` et recharge — pas seulement celui du
  clic : un vieil onglet chercherait sinon des fichiers `assets/*` qui n'existent plus sur le
  serveur, et parlerait à une base dont le nouveau code a pu changer le schéma.
- **Première installation** : un onglet qui n'avait aucun contrôleur au chargement ne recharge
  pas sur `controllerchange` (c'est le `clientsClaim` de la première installation, §2).
  L'écouteur relève `navigator.serviceWorker.controller` au démarrage pour le savoir.
- Un rechargement pendant un import est la décision de l'utilisateur, qui a cliqué ; aucune
  logique d'attente de `withImportLock` n'est ajoutée.

## 4. Le filet `versionchange` de Dexie

Avec la mise à jour du §3, tous les onglets changent de version ensemble. Un onglet peut pourtant
échapper au Service Worker (Maj+Recharger contourne le contrôleur) et ouvrir la base à un schéma
plus récent qu'un autre onglet. `db.on("versionchange")` (dans `apps/web/src/db/`) recharge alors
l'onglet ancien : l'événement n'arrive qu'à un onglet dont le code est dépassé, qui ne peut rien
faire d'utile avec une base fermée.

## 5. Installable : manifeste et icônes

Manifeste produit par `vite-plugin-pwa` :

| Champ | Valeur |
|---|---|
| `name` | IB Options Analyzer |
| `short_name` | IB Analyzer |
| `start_url` | `/` |
| `scope` | `/` |
| `display` | `standalone` |
| `theme_color` | `#0e9f90` (`--primary` clair, `index.css`) |
| `background_color` | `#f3f5f8` (`--background` clair) |

Icônes PNG tirées de `apps/web/public/favicon.svg` (thème clair) par un script de
`apps/web/scripts/`, **versionnées** dans `apps/web/public/` : 192 et 512 (`purpose: any`), 512
`maskable` (le logo réduit dans la zone sûre, fond `#0e9f90` plein cadre), `apple-touch-icon`
180 déclaré dans `index.html` avec `<meta name="theme-color">`. Le script se relance à la main
quand le logo change ; ni `pnpm build` ni `pnpm check` ne l'exécutent.

## 6. La page Aide

Une courte section, en français et en anglais (`i18n/{fr,en}.json`) :

- l'application s'installe par le menu du navigateur (Chrome, Edge ; Safari sur iPhone :
  Partager → Sur l'écran d'accueil) et partage alors les données de l'onglet ;
- un navigateur qui a déjà ouvert le site l'ouvre encore quand le serveur est en maintenance ;
  seules la synchro Flex relayée par le serveur et la sauvegarde attendent son retour ;
- une nouvelle version s'annonce par un bandeau.

## 7. nginx, déploiement, développement

- `nginx.conf` : `sw.js`, `registerSW.js` éventuel et `manifest.webmanifest` sont servis en
  `no-cache` par la règle `location /` existante — sans quoi un Service Worker périmé resterait en
  place. `manifest.webmanifest` doit partir en `application/manifest+json` : à vérifier sur
  l'image `nginx:alpine`, et à déclarer dans `nginx.conf` si son `mime.types` l'ignore.
- Rien ne change dans Django, Traefik, l'agent, `deploy/iba`.
- **Service Worker désactivé en `pnpm dev`** (`devOptions.enabled: false`) : les worktrees, le
  skill `run-frontend` et les tests e2e existants tournent sur Vite sans Service Worker, comme
  avant.
- **Retrait d'urgence** : si un Service Worker publié se révèle cassé, la procédure est de
  déployer une version corrigée — `sw.js` étant en `no-cache`, le navigateur la trouve à la
  visite suivante tant que le serveur répond. La procédure (et, en dernier recours, le
  `selfDestroying: true` du plugin) est notée dans `docs/deploiement-vps.md`.
- CLAUDE.md gagne une règle : ce que le Service Worker met en cache, la liste des préfixes
  exclus et le fait qu'aucune réponse de serveur n'y passe.

## 8. Tests

- **Vitest** (`apps/web/src/pwa/`) : `virtual:pwa-register` est remplacé par une doublure dans
  la configuration de test — la seule doublure du sous-projet, le Service Worker n'existant pas
  dans jsdom. Le bandeau n'apparaît que quand une version attend ; le clic envoie la mise à jour ;
  `controllerchange` recharge un onglet qui avait un contrôleur au chargement et pas un onglet
  qui n'en avait pas ; la vérification horaire ne part pas hors ligne.
- **Vitest** (`apps/web/src/db/`) : un `versionchange` sur la base `fake-indexeddb` (ouverture
  d'une version supérieure par une seconde connexion) recharge l'onglet.
- **Playwright** (`apps/web/e2e/offline.spec.ts`), contre un **build de production** servi par
  `vite preview`, dans une configuration Playwright à part — les tests existants restent sur
  `pnpm dev` et sur Django :
  1. première visite, attendre que le Service Worker contrôle la page ;
  2. le navigateur hors ligne, recharger une route profonde (`/accounts/<id>/positions`) :
     l'application s'affiche avec ses données ;
  3. une navigation à laquelle le réseau répondrait 502 est tout de même servie par le cache ;
  4. une requête `/api/...` n'est jamais servie depuis le cache ;
  5. un second build publié fait apparaître le bandeau, et un clic fait passer deux onglets
     ouverts à la nouvelle version.
  Comme les autres e2e, il n'entre pas dans `pnpm check`.
