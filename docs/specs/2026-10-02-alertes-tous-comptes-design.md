# Sous-projet 43 — Les alertes de tous les comptes

Statut : implémenté (2026-10-02).

Depuis le sous-projet 42, une alerte n'est évaluée que pour le compte à l'écran : `useAlertEngine`
est monté par `AccountDataProvider`, et l'agent n'est sondé que pour ce compte (`useAgentPolling`,
monté par `AppLayout`), et seulement onglet visible. Une alerte de `beta` ne peut donc se
déclencher que pendant qu'on regarde `beta`, et aucune ne se déclenche onglet masqué, là où une
notification sert justement.

Ce sous-projet fait vérifier les alertes de **tous les comptes** qui ont un port TWS, **onglet
visible ou non**, sur **toutes les pages** de l'application, par un veilleur unique par navigateur.

---

## 1. Périmètre

**Critère de réussite :** un onglet ouvert sur `alpha`, sur Paramètres, sur l'Aide, `/accounts` ou
`/welcome`, visible ou masqué, l'agent présent et le TWS de `beta` joignable : une alerte de
`beta` dont le seuil est franchi se déclenche à la passe suivante, notifie « beta · ZXAB ↑ 38,20 »,
et le sélecteur de compte porte une pastille sur `beta`. Un clic sur la notification ouvre
`/accounts/beta/alerts`.

Dans le périmètre : le veilleur et son élection entre onglets (§3), l'évaluation hors React (§4),
`exclusiveTws` entre onglets (§5), la pastille du sélecteur et la notification (§6), la
démonstration (§7), les erreurs (§8), l'Aide et CLAUDE.md (§9), les tests (§10).

Hors périmètre : toute vérification sans onglet ouvert ; un rattrapage entre deux passes ; une page
Alertes « tous comptes » (les comptes ne se combinent jamais) ; un Web Worker (§2) ; tout
changement du moteur `packages/alerts`, du schéma Dexie (aucune version 13) ou du serveur.

**Le serveur ne voit rien de tout cela**, comme au sous-projet 42.

## 2. Pourquoi sur le fil principal

`buildJournals` mesuré sur les deux réponses Flex réelles de `private/` (médiane de 7 passes,
Node) : **14 ms** pour 322 transactions, **69 ms** (max 96) pour 1 796. Le veilleur le paie une
fois par compte toutes les 5 minutes, comptes séparés par un `await` : au pire un bloc de moins de
100 ms par compte. Le compte affiché le paie déjà à chaque passe aujourd'hui (`useJournals` après
l'écriture du snapshot). Un Web Worker éviterait ces blocs au prix d'un second Dexie, d'i18n et
des notifications relayés par `postMessage`, et d'un verrou TWS à faire traverser : écarté.

Le cœur du veilleur, `evaluateAccountAlerts` (§4), ne dépend ni de React ni du DOM : c'est
exactement ce qu'un Worker exécuterait si un compte dépassait un jour quelques centaines de
millisecondes.

## 3. Le veilleur : `src/alerts/watcher.ts`

### 3.1 Démarrage et élection

`startAlertWatcher(db)` est appelé une fois par `main.tsx`, à côté de `reloadOnVersionChange`,
donc quelle que soit la route. Il demande `navigator.locks.request(\`ib2:watcher:${db.name}\`, …)`
et ne fait de passes que tant qu'il tient le verrou, qu'il garde jusqu'à la fermeture de l'onglet :
un seul onglet par base fait les passes, un autre reprend la main quand celui-ci se ferme ou
recharge. Le nom de la base (`ib-analyzer`, `ib-analyzer-demo`) entre dans le nom du verrou :
un onglet de démonstration veille sur sa base, un onglet normal sur la sienne.

Sans `navigator.locks`, l'onglet veille seul, sans élection.

**La présence de l'agent reste sondée dans chaque onglet.** `useAgentPresence` est un état de
module, propre à l'onglet : un onglet non élu qui ne sonderait jamais resterait « inconnu » —
plus de cotations (`useUnderlyingQuotes`), plus de bouton Actualiser, plus de relais Flex par
l'agent. Chaque onglet, élu ou non, appelle donc `refreshPresence()` au démarrage, toutes les
`AGENT_POLL_MS` et au retour au premier plan d'un onglet dont la dernière sonde date de plus de
`AGENT_POLL_MS`, tant qu'au moins un compte a un `twsPort` : `/health` n'ouvre aucune connexion
TWS. Seules les passes (§3.3) sont réservées à l'onglet élu.

### 3.2 Cadence

Une passe au démarrage (verrou obtenu), puis une `AGENT_POLL_MS` (5 min) après la **fin** de la
précédente — jamais deux passes qui se chevauchent —, **onglet visible ou non**. La passe commence
par `refreshPresence()` : agent absent, la passe s'arrête là, sans erreur ni écriture.

Une passe immédiate est aussi demandée quand un compte gagne un `twsPort` (comportement de
`useAgentPolling` aujourd'hui) : une requête live sur les ports des comptes, comparée à la
précédente. Une passe demandée pendant qu'une autre tourne est jouée juste après, une fois.

### 3.3 Une passe

Les comptes sont relus au début de la passe ; pour chaque compte qui a un `twsPort`, dans l'ordre
de la table, en série :

1. `runAgentSync(db, accountId)` — extrait de `useAgentSync().run` vers `agent/useAgentSync.ts`,
   que le bouton Actualiser appelle aussi, et qui garde le `runningAccounts` partagé : un compte déjà
   en cours de synchro est sauté pour cette passe (`null`), sinon l'`AgentSyncOutcome` de
   `syncAgent` ;
2. issue autre que `ok` : purge seule (§4 avec `priceOf` nul), compte suivant ;
3. sinon `fetchQuotes` sur les tickers de ses alertes — manuelles, et sous-jacents des
   automatiques —, passés par `quotedTicker`, versés au magasin en mémoire (`mergeQuotes`) ;
4. `evaluateAccountAlerts` (§4), puis une notification par alerte déclenchée (§6.2) ;
5. `await` d'une tâche (`setTimeout(0)`) avant le compte suivant, qui rend la main à l'interface.

Une exception est attrapée **par compte** : les autres passent.

### 3.4 Ce qui disparaît

`useAgentPolling` et son appel dans `AppLayout`, et `lastRunAt`, qui ne servait qu'à son compte
à rebours. `useAgentSync(accountId).run` reste — le bouton Actualiser — et appelle
`runAgentSync` : une passe manuelle du compte affiché ne change pas la cadence du veilleur, qui
reste par passe et non par compte.

`useAlertEngine` reste monté pour le compte affiché : il sert la page Alertes, les pastilles du
menu, les cloches, et réagit tout de suite à « Vu », à une alerte posée ou à une cotation. Le
compte affiché est donc évalué deux fois, sans effet : `runPass` relit les états dans sa
transaction, si bien qu'une transition n'est écrite et notifiée qu'une fois, onglets compris
(IndexedDB sérialise les transactions `rw` sur les mêmes tables).

`useUnderlyingQuotes` ne change pas : chaque onglet cote son compte affiché à chaque mouvement de
`lastAgentSyncAt`, qu'il voit dans Dexie quel que soit l'onglet qui a fait la passe.

## 4. L'évaluation hors React : `evaluateAccountAlerts`

`src/alerts/evaluateAccount.ts`, sans React ni DOM :

```ts
evaluateAccountAlerts(db, accountId, { quotes: QuoteMap, now: () => Date, fetchBars })
  : Promise<{ alert: Alert; price: number | undefined }[]>
```

1. lit en parallèle le compte, le ledger, le snapshot, les entrées d'identité — les mêmes
   lectures que `useLedger`, `useSnapshot`, `useContractIdentities`, factorisées dans des
   fonctions `load…(db, accountId)` que ces hooks appellent aussi, pour ne jamais diverger ;
2. `activeStrategies(account)`, `pairCorporateActions`, `buildIdentities`, `buildJournals` —
   la séquence de `useJournals`, factorisée de même (`journalsOf(...)`) ;
3. `runPass` — extrait tel quel de `useAlertEngine.ts` vers ce module, que le hook importe —, avec
   `alertPriceOf(snapshot, quotes)` ;
4. S₀ : la logique de l'effet d'ancrage de `useAlertEngine` est extraite en
   `anchorPending(db, accountId, alerts, { snapshot, priceOf, now, fetchBars, port })`, appelée
   ici et par le hook. Le garde `barsAsked` devient un `Set` de module (clé
   `compte|ticker|devise|lastAgentSyncAt`), partagé par les deux appelants.

Rend les alertes déclenchées par la passe et le cours qui les a déclenchées.

## 5. `exclusiveTws` entre onglets

`exclusiveTws(call)` passe par `navigator.locks.request("ib2:tws", call)` : TWS refuse deux
connexions `clientId 0` simultanées, et deux onglets le peuvent déjà aujourd'hui ; des passes
onglet masqué rendraient le cas courant. Sans `navigator.locks`, la file en mémoire d'aujourd'hui.
Le délai d'un appel ne court toujours qu'à son tour.

## 6. Ce qui se voit

### 6.1 La pastille du sélecteur de compte

`useTriggeredAlertCounts()` (`db/hooks.ts` ; `db/alerts.ts` reste le seul écrivain) : une requête live sur toute la table `alertStates`,
`triggeredAt !== null && acknowledgedAt === null`, comptée par `accountId`. Aucun journal : le
statut « déclenchée » se lit sur l'état seul (`alertStatus`), et le veilleur purge à chaque passe
les états des alertes disparues.

`AccountSwitcher` pose `AlertBadge` (même composant, même teinte `warning` que le menu) :

- à droite de chaque compte de la liste qui en a au moins une ;
- sur le bouton fermé, la somme des **autres** comptes — celles du compte affiché ont déjà leurs
  pastilles dans le menu.

### 6.2 La notification

`notifyTriggered` gagne le compte et le nombre de comptes du navigateur :

- au moins deux comptes : titre préfixé du compte, « beta · ZXAB ↑ 38,20 »
  (`alerts.notify.title_account`) ; un seul compte : inchangé ;
- un clic ramène sur l'onglet et ouvre `/accounts/<compte de l'alerte>/alerts`. Le veilleur vit
  hors de React : `main.tsx` lui passe `open: (path) => router.navigate(path)`, le routeur de
  `routes/router.tsx` — aucune route commune n'enveloppe `/welcome`, `/accounts` et les pages de
  compte, où un composant aurait pu lui confier `navigate`.

`useAlertEngine` passe par la même fonction, son compte en paramètre.

## 7. La démonstration

Un seul compte : pas de nom dans le titre, et les notifications restent coupées (`isDemo()`). Le
veilleur y tourne sur `ib-analyzer-demo`, contre l'agent simulé (`getAgentJson` délègue déjà),
et la pastille du sélecteur y vit. `relayThroughAgent` reste refusé : le veilleur n'appelle jamais
le relais Flex.

## 8. Erreurs et cas limites

- **Agent absent :** passe arrêtée après la sonde ; rien d'écrit.
- **TWS d'un compte injoignable :** `syncAgent` écrit son statut ; purge seule pour ce compte ;
  le suivant passe.
- **Exception d'un compte** (base fermée, moteur qui lève) : attrapée, compte suivant ; la passe
  suivante réessaie.
- **Onglet dépassé par un schéma :** il recharge (`reloadOnVersionChange`), le verrou passe à un
  autre onglet.
- **Compte supprimé pendant la passe :** sa fiche manque, il est sauté.
- **Passe longue** (15 s par appel TWS au pire, trois appels par compte) : le minuteur suivant
  n'est armé qu'à la fin.
- **S₀ d'un compte non affiché :** pris à la première passe qui voit la vente — en direct si
  elle tombe dans `ANCHOR_LIVE_WINDOW_MS`, sinon sur la barre du jour.

## 9. Aide et CLAUDE.md

L'Aide (`help.alerts`, fr et en) : « Une alerte se vérifie à chaque passe de l'agent (toutes les
5 minutes), pour tous vos comptes qui ont un port TWS, quelle que soit la page ouverte et même
onglet en arrière-plan. Sans agent ou sans onglet ouvert, rien n'est évalué, et aucun rattrapage
n'a lieu entre deux passes. » La suite sur le cours différé ne change pas.

CLAUDE.md : la règle des alertes (« L'évaluation n'a lieu que sur une page de compte ouverte… »)
devient celle du veilleur ; la règle de `exclusiveTws` dit « entre onglets » ; le registre gagne la
ligne 43.

## 10. Tests

Sur `fake-indexeddb`, ledger semé, faux agent ; aucun hook moqué.

- `evaluateAccountAlerts` : déclenche, purge et pose S₀ sur un compte semé ; une seconde passe
  n'écrit rien et ne rend rien ; ses journaux valent ceux de `useJournals` sur la même base.
- Le veilleur, deux comptes : `beta` se déclenche sans aucun composant de compte monté ; un compte
  sans port n'est jamais appelé ; agent absent, rien n'est écrit ; TWS de `alpha` injoignable,
  `beta` se déclenche quand même ; `document.visibilityState === "hidden"` n'empêche pas la passe ;
  deux passes ne se chevauchent jamais ; un port ajouté déclenche une passe.
- L'élection : deux veilleurs sur un `navigator.locks` simulé (jsdom n'en a pas), un seul passe ;
  le verrou rendu, l'autre prend le relais ; noms de verrou distincts pour la base de démo.
- `exclusiveTws` : deux appels, depuis deux files distinctes sur le même verrou simulé, ne tournent
  jamais ensemble.
- `AccountSwitcher` : pastille par compte, total des seuls autres comptes sur le bouton.
- `notifyTriggered` : compte dans le titre à partir de deux comptes, clic vers les alertes du
  compte de l'alerte.
- `AppLayout` ne monte plus `useAgentPolling` ; le bouton Actualiser synchronise toujours.
- Un snapshot écrit pour `beta` ne relance pas les journaux de `alpha` (compteur d'appels de
  `buildJournals` dans `AccountDataProvider`).
