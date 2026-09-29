# Sous-projet 41 — La page d'accueil, la démonstration et ses captures

Statut : implémenté (2026-09-29).

Un navigateur sans compte IB atterrit aujourd'hui sur `/accounts` : une page de gestion, sans
menu, dont la seule présentation de l'application est une carte `WelcomeCard` en bas de page.
Le bouton « Premiers pas » y mène à l'Aide, qui a un menu — mais, sans compte, ce menu n'offre
plus aucun chemin vers l'ajout d'un compte : `AccountSwitcher` n'a rien à lister, et c'est lui
seul qui mène à `/accounts`. Le visiteur est coincé.

Ce sous-projet ajoute une page de présentation, `/welcome`, où atterrit tout navigateur sans
compte et que l'on peut partager par lien ; un **mode démonstration** qui ouvre la vraie
application sur un compte fictif, dans une base séparée, avec un agent simulé ; et une commande
qui régénère les captures de la page depuis cette même démonstration.

---

## 1. Périmètre

**Critère de réussite :**

- Un navigateur neuf qui ouvre `/` arrive sur `/welcome`, comprend ce que fait l'application,
  et en un clic ajoute un compte IB ou explore la démo.
- La démo montre la vraie application — tableau de bord, positions, journaux, condors, graphes
  de cours, variation du jour, badge « En direct » — sur des données fictives cohérentes que la
  page Consistance déclare sans écart.
- Quitter la démo ne laisse rien : ni base, ni clé de stockage, ni ticker dans la table
  sectorielle, ni compte dans le sélecteur. La vraie base n'est jamais ouverte pendant la démo.
- `pnpm screenshots` régénère toutes les captures de `/welcome`, à l'identique d'une exécution à
  l'autre tant que l'application n'a pas changé.
- Depuis n'importe quelle page, sans aucun compte, un lien mène à l'ajout d'un compte.

Dans le périmètre : le parcours d'entrée et le menu sans compte (§2), la page `/welcome` (§3),
le mode démonstration (§4), la graine scénarisée (§5), l'agent simulé (§6), les captures (§7),
les tests (§8), la documentation (§9).

Hors périmètre : le référencement par les moteurs (la page vit dans le SPA ; elle se partage
par lien) ; toute page servie par Django ou nginx ; une démo qui accepterait un import de
fichier ; des données de marché réelles ; une régression visuelle automatique des captures ;
tout changement de l'API, de l'agent ou du déploiement.

## 2. Parcours d'entrée

**Routes** (`routes/router.tsx`) :

- `/welcome` — nouvelle route autonome, hors `AppLayout`, comme `/accounts`. Toujours
  accessible, avec ou sans compte : c'est le lien que l'on partage.
- `RootRedirect` : sans aucun compte → `/welcome` (au lieu de `/accounts`). Avec des comptes,
  inchangé.
- `/accounts` reste la page de gestion (ouvrir, ajouter). `WelcomeCard` et les clés
  `accounts.welcome.*` disparaissent, remplacées par une ligne « Découvrir IB Analyzer » →
  `/welcome`.
- `AppLayout` rebondit toujours vers `/accounts` pour une route scopée sans compte : un lien
  profond vers un compte absent reste une affaire de gestion, pas de présentation.

**Le menu sans compte** (`AppSidebar`) : quand `accounts` est vide — Aide ou Paramètres d'un
navigateur neuf —, le sélecteur de compte vide laisse place à deux entrées : « Ajouter un compte
IB » (→ `/accounts`) et « Découvrir IB Analyzer » (→ `/welcome`). Avec des comptes, une entrée
discrète « Découvrir IB Analyzer » reste en pied de menu, près d'Aide.

**Les appels de `/welcome`** : bouton principal « Ajouter un compte IB » (→ `/accounts`),
bouton secondaire « Explorer la démo » (§4.1), liens texte « Aide » (→ `/help`) et « Restaurer
une sauvegarde » (→ `/settings`, pour qui revient sur un navigateur neuf). En haut à droite, les
commandes d'`/accounts` : langue, thème, compte serveur facultatif (`SessionCorner`, extrait
dans son propre fichier pour être partagé).

## 3. La page `/welcome`

Mise en page « qui se déroule » (maquette A de la séance de conception) : chaque fonction a sa
phrase d'explication et sa capture.

1. **En-tête** — promesse : « Vos options Interactive Brokers, lues stratégie par stratégie. »
   Sous-phrase : Wheel, LEAPS, Condors ; couverture, rachats, rendement, calculés dans votre
   navigateur. Les appels du §2 ; à droite la capture du tableau de bord.
2. **Quatre sections de fonctions**, texte et capture en alternance (gauche/droite) :
   couverture et décision de rachat (Positions), la Wheel et son graphe, journaux, capital et
   rendement (Journal Wheel), Condors (un condor déplié). Chacune : un titre court, deux ou trois
   phrases, une capture. Puis une ligne « Et aussi » : Historique (sa capture, plus petite),
   Consistance, Secteur et Score, Suggestion de position.
3. **Confidentialité** — la seule section mise en avant, par une bordure teal : le serveur ne voit
   jamais transactions ni positions ; la sauvegarde, facultative, est chiffrée dans le
   navigateur. Renvoie à l'Aide (`/help#security`) pour le détail, sans le dupliquer.
4. **Comment ça marche** — trois étapes : relevé HTML, Flex Query, agent local facultatif, chacune
   vers sa section de l'Aide (`#statement`, `#flex`, et `#agent`, ancre à ajouter à la section de l'agent).
5. **FAQ** repliable, cinq questions : *Est-ce gratuit ?* — « Aucun frais d'utilisation. » ;
   *Faut-il un compte serveur ?* ; *Mes identifiants IB sont-ils demandés ?* ; *Fonctionne-t-elle
   hors ligne ?* ; *Quelles stratégies ?*
6. **Pied de page** — Aide, Paramètres, et « Les captures montrent des données fictives. »

**Ton** : factuel, aucun superlatif, aucun chiffre de performance, aucun témoignage. Aucun nom de
domaine : tous les liens sont relatifs. Tout le texte vit sous `welcome.*` dans
`i18n/{fr,en}.json`.

**Rendu** : tokens `finance-desktop` existants et composants `@ib/ui`, aucune nouvelle couleur.
Largeur maximale ~1100 px ; sous `md`, une colonne, le texte puis sa capture. Une capture
s'affiche dans un cadre de fenêtre discret (`ShotFrame`), en `<img loading="lazy">` avec
`width`/`height` explicites, et s'ouvre à sa taille réelle dans un nouvel onglet au clic (lien sur l'image : `packages/ui` n'a pas de `Dialog`). Elle
choisit son fichier selon le thème et la langue courants (§7). Une image introuvable — hors
ligne, par exemple — laisse le cadre et son texte alternatif, jamais une icône cassée.

## 4. Le mode démonstration

### 4.1 Entrer, sortir

- **Un seul lecteur** : `isDemo()` (`src/demo/mode.ts`) lit `sessionStorage` `ib2:demo` ; aucun
  autre fichier ne lit ni n'écrit ce drapeau (`enterDemo`, `leaveDemo` vivent à côté).
- **Entrer** (« Explorer la démo ») : pose le drapeau, puis `location.assign("/accounts/demo/dashboard")`.
  Le drapeau vit par onglet : fermer l'onglet quitte la démo, et un autre onglet reste sur la
  vraie base.
- **Bandeau** : en démo, `AppLayout` porte en haut de la coquille un bandeau fixe « Mode
  démonstration — données fictives », avec « Quitter la démo ». `/welcome` le porte aussi ; son
  bouton secondaire y devient « Continuer la démo », et « Ajouter un compte IB » quitte d'abord la
  démo.
- **Quitter** (`leaveDemo`) : ferme la base, `Dexie.delete("ib-analyzer-demo")`, efface les clés
  `ib2:demo:*` (§4.3) et le drapeau, puis `location.assign` vers `/welcome` — la destination
  d'un navigateur qui vient de voir la démo, qu'il ait des comptes ou non : il y trouve « Ajouter
  un compte IB ». Un second onglet encore en démo reçoit le `versionchange` de la suppression et
  recharge (`db/reloadOnVersionChange.ts`) ; son drapeau étant toujours posé, il réamorce la
  démo. Accepté.

### 4.2 La base

`schema.ts` exporte aujourd'hui `db = new AppDatabase()`. Le nom de la base devient un paramètre
du constructeur, choisi une fois au chargement du module : `ib-analyzer-demo` si `isDemo()`,
`ib-analyzer` sinon. Entrer ou sortir recharge toujours la page, donc le choix est figé pour la
vie de l'onglet : aucun `DbProvider` ne bascule à chaud, et rien ne dépend de la session serveur
— le bug du 2026-09-21 ne peut pas revenir. Les imports directs de `db` (`main.tsx`,
`StrategiesCard`) suivent d'eux-mêmes. **Exception documentée** à la règle « une seule base
`ib-analyzer` par origine » : la base de démo n'appartient à aucun compte non plus, elle
n'existe que pendant la démo.

**Remplissage** : en démo, `main.tsx` attend `ensureDemoSeeded(db)` avant de monter l'application.
Base vide → la graine (§5) s'écrit en une transaction ; base remplie → rien. Tout `src/demo/`
sauf `mode.ts` se charge par `import()` dynamique : le bundle principal ne grossit que de
`mode.ts`. Le Service Worker pré-cache ce morceau comme le reste du build : une démo déjà vue
s'ouvre hors ligne.

### 4.3 Stockage local

En démo, les clés d'affichage du `localStorage` — `ib2:lastAccountId`, `ib2:tableView:*`,
`ib2:pageSearch:*` et les vues d'encadrés — passent par un seul point d'accès (`storageKey(key)`,
`src/demo/mode.ts`) qui les préfixe en `ib2:demo:…`. Sans cela, `AppLayout` écrirait `demo`
comme dernier compte visité de la vraie application, et un vrai compte nommé « demo » (le slug
est libre) partagerait ses vues de tableau avec la démo. Le thème et la langue restent communs :
ce sont des préférences du visiteur, pas des données.

### 4.4 Ce que la démo désactive

- **Sources de données** : la page reste visible, mais chaque action qui écrit — import de
  fichier, Flex, port TWS, relecture et suppression des relevés, suppression des transactions —
  est grisée avec « Indisponible en démonstration ». La carte « Stratégies actives » reste
  active : cocher une stratégie écrit dans la base de démo, sans risque, et montre le réglage.
- **Paramètres** : sauvegarde chiffrée, export et import `.json.gz` grisés — ils liraient ou
  écraseraient la base de démo, jamais ce que le visiteur croit.
- **`/accounts`** en démo : ne crée rien ; affiche « Vous êtes en démonstration » et « Quitter la
  démo pour ajouter votre compte ». Dans `AccountSwitcher`, « Ajouter un compte » devient
  « Quitter la démo ».
- **Relais Flex** : `pickFlexRelay` rend `{ relay: null, reason: "demo" }` en démo ; le compte démo n'a de toute
  façon aucun jeton, donc aucune synchro automatique ne part.
- Tout le reste — tri, filtres, table sectorielle éditable, journaux, graphes — fonctionne et
  écrit, le cas échéant, dans la base de démo.

## 5. La graine scénarisée

**Un compte** : `id` `demo`, libellé « Démo », `ibAccountId` `U0000000`, les trois stratégies
actives, `twsPort` 7496 (fictif : l'agent simulé l'ignore, mais sans port ni polling ni graphes
ne démarrent).

**L'histoire** (~18 mois) :

- **Wheel** : quatre ou cinq tickers (AAPL, MSFT, KO, JPM…) ; un cycle complet put → assignation
  → call couvert → rappel ; une position assignée encore détenue, un call vendu dessus ; des puts
  ouverts, dont au moins un que `evaluateBuyback` décide de racheter.
- **LEAPS** : deux LEAPS, l'un portant un call vendu contre lui.
- **Condors** : sur XSP, un expiré, un ouvert et complet.
- **Autres** : quelques actions achetées au marché, dont une part reprise par la Wheel au strike
  d'un call couvert ; une vente nue, pour que la barre de titre ait une position non couverte à
  signaler.
- Dépôt initial, dividendes, intérêts, commissions.

**Écrite comme un scénario, jamais à la main** : `demo/scenario.ts` liste des événements
(« vendre 1 put AAPL strike 180 échéance J+30 à J-540 », « assigner », « dividende KO »…) aux
dates relatives. `demo/generate.ts` les traduit en `Transaction[]`, puis **calcule** le snapshot
(positions reconstruites par le moteur du dépôt, `markPrice` tiré de §5.1) et les points de cash
(`start` à 0 au premier jour, `end` au dernier solde, comme `seed.ts` aujourd'hui). La cohérence
est donc construite, et vérifiée par l'oracle (§8).

**Dates relatives** : la référence est le dernier jour de marché à `Date.now()` ; toutes les
dates s'en déduisent. Les options ouvertes n'échoient ainsi jamais avant la visite, et « le
jour » a un sens. Sous `page.clock` figé (§7), la graine est identique d'une capture à l'autre.

### 5.1 Les prix

`demo/prices.ts` : une marche aléatoire à graine fixe par ticker (générateur déterministe,
jamais `Math.random`), calée sur un niveau plausible, qui produit deux ans de barres
journalières jusqu'à la date de référence. Une seule source pour tout : barres des graphes,
`markPrice` du snapshot, `last`/`close` des cotations, prix d'exécution cohérents avec le
cours du jour. Tickers connus, prix fictifs : aucune donnée de marché d'IB n'est redistribuée,
et la page comme le bandeau disent « données fictives ».

## 6. L'agent simulé

En démo, `agent/client.ts` ne contacte **jamais** `127.0.0.1:8100` : ses fonctions de transport
délèguent à `demo/agent.ts` (chargé à la demande), derrière `exclusiveTws` comme aujourd'hui.

- `probeAgent` → `{ version: "demo" }` : l'agent est présent.
- `fetchSnapshot` → un payload **au format de l'agent**, produit par le générateur (positions
  du snapshot calculé, `dailyPnL` tiré des prix du jour, aucune exécution). Le vrai pipeline
  tourne ensuite tel quel : `parseAgentSnapshot`, `syncAgent`, snapshot `agent`,
  `lastAgentSyncAt` — donc « En direct », P/L du jour et `dayChange` s'allument par le chemin
  réel. La graine n'écrit elle-même aucun snapshot `agent` : elle pose un snapshot `flex` au jour
  de référence, que la première passe de l'agent simulé remplace, pour que l'application ne
  s'ouvre jamais sans snapshot.
- `fetchBars` → les barres de §5.1 ; `fetchQuotes` → `last`/`close` du dernier jour.
- Le relais Flex par l'agent rend « indisponible » (§4.4).

## 7. Les captures

**La commande** : `pnpm screenshots` (script racine) lance `apps/web/scripts/screenshots.mjs`,
qui reprend de `run-frontend/driver.mjs` les ports du checkout et le démarrage ou la réutilisation
de Vite, puis ouvre l'application **en mode démo** — jamais `--seed` ni `--agent`, pour que la
vitrine montre exactement ce que le visiteur explorera. `pnpm check` ne la lance pas.

**Reproductible** : `page.clock.setFixedTime` sur une date fixe déclarée dans le script ;
`prefers-reduced-motion: reduce` ; attente de 1 200 ms sur une page qui porte un graphique ECharts, la fin de son animation d'entrée, comme `run-frontend` ; attente de
`document.fonts.ready` et du réseau au repos ; viewport 1440×900, `deviceScaleFactor: 2`.

**Le manifeste** : `apps/web/src/welcome/shots.ts` déclare chaque capture — identifiant, route,
sélecteur de l'élément ou région, action préalable (déplier un condor, survoler un badge de
décision), dimensions affichées. Le script le lit pour capturer, `/welcome` le lit pour afficher.
Liste de départ : `dashboard`, `positions` (badges de couverture et décision de rachat),
`wheel` (graphe de cours et niveaux), `journal-wheel`, `condors` (un condor déplié), `history`.

**Les sorties** : `apps/web/public/shots/<id>.<light|dark>.<fr|en>.webp`, WebP qualité 85,
1600 px de large, versionnés — ~24 fichiers, 2 à 3 Mo au total. **Exclus du pré-cache du Service
Worker** (`globIgnores: ["shots/**"]` à côté d'`agent/**`, `pwa.config.ts`) : ce sont des
images de vitrine pour un visiteur en ligne, qui n'ont pas à peser sur l'installation de chaque
utilisateur ; hors ligne, `/welcome` garde ses cadres et ses textes (§3). `/shots` rejoint
`SERVER_PREFIXES` : une capture ouverte dans un onglet n'est jamais remplacée par `index.html`.
Jamais sous `public/welcome/` : un dossier réel au nom de la route ferait répondre à nginx
(`try_files $uri $uri/`) 301 puis 403 sur `/welcome` (revue finale du sous-projet 41).

**Mettre à jour** : relancer `pnpm screenshots`, relire le diff d'images dans git, committer.

## 8. Tests

Vitest sur `fake-indexeddb`, jamais en moquant les hooks ; un test doit échouer si le
comportement change.

- **Parcours** : `RootRedirect` sans compte → `/welcome`, avec compte → tableau de bord ;
  `/welcome` rendu avec des comptes ; menu sans compte → « Ajouter un compte IB » et « Découvrir » ;
  `/accounts` sans `WelcomeCard`, avec le lien.
- **Mode démo** : `isDemo()` choisit le nom de base ; `ensureDemoSeeded` idempotent ; `leaveDemo`
  supprime `ib-analyzer-demo`, les clés `ib2:demo:*` et le drapeau, et ne touche ni `ib-analyzer`
  ni `ib2:lastAccountId` ; `storageKey` préfixe en démo seulement ; en démo aucun `fetch` vers
  `127.0.0.1:8100` (espion sur `fetch` autour d'une passe complète, graphes et cotations compris) ;
  Sources, sauvegarde, export/import et création de compte grisés ; `pickFlexRelay` sans relais.
- **Oracle de la graine** (`demo/generate.test.ts`) : reconstitution du portefeuille sans écart
  contre le snapshot calculé ; cash calé sans écart au *Starting Cash* ; chaque stratégie a au
  moins une ligne ouverte et une fermée ; au moins une décision « racheter », une position non
  couverte, un condor complet ouvert ; aucune option ouverte échue à la date de référence, pour
  plusieurs dates de référence (un lundi, un vendredi soir, un samedi) ; deux générations à la
  même date sont identiques.
- **Agent simulé** : le payload de `fetchSnapshot` passe `parseAgentSnapshot` ; les barres
  couvrent deux ans et finissent au jour de référence ; `markPrice` du snapshot = clôture du
  dernier jour des barres.
- **Captures** : chaque entrée de `shots.ts` a ses quatre fichiers dans `public/shots/`.
- **Playwright** (`e2e:offline`, contre le vrai build) : `/` sans compte → `/welcome` ;
  « Explorer la démo » → tableau de bord rempli et bandeau ; « Quitter la démo » → `/welcome`,
  base `ib-analyzer-demo` absente, `ib-analyzer` sans compte.

## 9. Documentation

- **CLAUDE.md**, trois règles : `/welcome` est la page d'un navigateur sans compte et reste
  accessible avec ; le mode démo se lit par `isDemo()` seul, choisit sa base au chargement du
  module, préfixe son stockage local par `storageKey`, et ne contacte jamais l'agent réel —
  l'exception à « une seule base par origine » ; les captures se régénèrent par
  `pnpm screenshots` depuis la démo, jamais à la main. Registre : sous-projet 41.
- **`run-frontend`** : renvoie à `pnpm screenshots` pour la vitrine ; `--seed` reste l'outil de
  vérification des développeurs.
- **Aide** : une ligne vers `/welcome` et vers la démo.

## 10. Découpage du plan

Un sous-projet, un plan en trois temps livrables chacun :

1. **Parcours et `/welcome`** : routes, menu sans compte, page complète avec des cadres de
   capture vides, `/accounts` allégée.
2. **Mode démo** : `isDemo`, base, stockage local, graine scénarisée et son oracle, agent simulé,
   désactivations, bandeau.
3. **Captures** : manifeste, `pnpm screenshots`, fichiers générés, exclusion du pré-cache, test
   d'existence, Playwright.

## 11. Décisions écartées

- **Captures seules, sans démo** : la démo est ce qui convainc sans rien importer, et la graine
  sert de toute façon aux captures.
- **Un compte `demo` dans la vraie base** : sa table sectorielle, sa colonne « En cours », la
  sauvegarde et le sélecteur de compte l'auraient vu ; chaque exclusion aurait été un oubli
  possible.
- **Démo sans agent** : les graphes, la variation du jour et « En direct » en auraient disparu.
- **Graine écrite à la main** : une histoire de 18 mois sans écart de reconstitution ni de cash
  ne se tient pas à la main ; le générateur calcule ce qui doit être cohérent.
- **Visite guidée compacte** (onglets sur une seule capture) : chaque fonction demande sa phrase
  d'explication.
- **Captures prises à la main** : elles vieillissent sans que rien ne le signale.
- **Pré-cacher les captures** : 2 à 3 Mo imposés à chaque installation pour une page de
  nouveau venu.
