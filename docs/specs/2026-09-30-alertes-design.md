# Sous-projet 42 — Les alertes de prix

Statut : implémenté (2026-09-30).

Un système d'alertes à la manière de TradingView : des alertes **manuelles**, posées d'un clic sur
un graphe de cours, et des alertes **automatiques**, que l'application déduit des journaux pour
deux situations où une position demande une vérification à la main :

- **Wheel** — un call couvert vendu **sous** le prix d'assignation : quand le cours remonte vers
  le strike plus vite que prévu, il faut sans doute rouler la position ;
- **Condors** — le cours s'approche d'une aile vendue, avant la zone de perte.

Une alerte déclenchée allume une pastille jaune dans le menu, en face des pages Positions, et une
notification système du navigateur. Une page Alertes les liste toutes.

---

## 1. Périmètre

**Critère de réussite :** avec l'application ouverte et l'agent présent, un cours qui franchit un
seuil — posé à la main sur un graphe, ou déduit d'un call Wheel sous assignation ou d'un condor —
fait apparaître, à la passe suivante, la pastille du menu, la ligne dans la page Alertes, la ligne
pleine sur le graphe et une notification système ; « Vu » l'éteint.

Dans le périmètre : le moteur pur (§3), le stockage (§4), les prix d'évaluation et l'agent (§5),
l'évaluation dans la coquille (§6), le menu et la page (§7), les graphes (§8), la démonstration
(§9), l'Aide et CLAUDE.md (§10), les tests (§11).

Hors périmètre : toute alerte quand aucun onglet n'est ouvert (l'agent qui notifie navigateur fermé
est un sous-projet possible) ; toute notification passée par le serveur, qui verrait tickers et
seuils ; les alertes sur le prix d'une option ; un rattrapage d'un franchissement survenu puis
annulé entre deux passes ; tri et filtres de colonne dans la page Alertes (CLAUDE.md réserve ces
fonctions à une liste fermée de tableaux).

**Le serveur ne voit rien de tout cela.** Alertes, seuils et états vivent en IndexedDB ; une
alerte manuelle nomme un ticker, donc une donnée de portefeuille.

## 2. Vocabulaire

- **Alerte** : un ou deux seuils sur le cours d'un ticker, avec une direction par seuil
  (`above` : alerte si cours ≥ seuil ; `below` : alerte si cours ≤ seuil).
- **Genre** : `manual`, `wheel` ou `condor`.
- **Active** : armée, seuil non franchi. **Déclenchée** : franchie et non acquittée — seule cette
  catégorie compte dans les pastilles. **Désactivée** : manuelle, acquittée (usage unique).
- **S₀** : le cours du sous-jacent au moment de la vente d'un call Wheel sous assignation.

## 3. Le moteur : `packages/alerts`, pur

Nouveau paquet `@ib/alerts` (dépend de `@ib/ledger` seul), sans texte ni couleur,
comme `levels.ts`. Tests Vitest écrits à la main.

### 3.1 Constantes (`constants.ts`, une seule définition chacune)

- `DEFAULT_WHEEL_ALERT_FRACTION = 0.7` — part du chemin S₀ → K parcourue avant l'alerte.
- `DEFAULT_CONDOR_ALERT_MARGIN = 0.15` — part de l'écart entre strikes vendus.
- `ANCHOR_LIVE_WINDOW_MS = 15 * 60 * 1000` — au-delà, S₀ ne se lit plus sur le prix du moment.

### 3.2 Alertes automatiques : `autoAlerts(rows, margins, anchors)`

Vue calculée des lignes de journal ouvertes (`endWhen === null`), **jamais stockée**. Une alerte
automatique disparaît quand sa ligne se ferme (call racheté, roulé, expiré, assigné ; condor fermé).

**Wheel.** Une alerte **par contrat** (`contractId(row.contract)`) de call couvert ouvert de la
Wheel (`strategy "wheel"`, `kind "short_call"`) dont le strike K est **strictement inférieur** à
l'`averageAssignmentPrice` du ticker (`wheelHoldings`, même `ticker` et `currency`). Pas d'alerte
au strike ou au-dessus (une assignation y réalise un gain), ni quand ce prix moyen est `null`.
- Identifiant : `wheel:<contractId>`.
- Seuil : `S₀ + (K − S₀) × fraction`, direction `above`. `fraction` = surcharge de l'alerte, sinon
  réglage du compte, sinon `DEFAULT_WHEEL_ALERT_FRACTION`.
- S₀ absent (§6.2) : seuil `null` — l'alerte existe, ne s'évalue pas, s'affiche « — ».
- S₀ ≥ K ne demande aucun cas particulier : le seuil tombe entre K et S₀ et le cours du moment
  le franchit d'ordinaire dès la première évaluation.
- Porte aussi, pour l'affichage : K, l'échéance, la quantité, l'`averageAssignmentPrice`, S₀ et sa
  source, `saleWhen` (le `startWhen` le plus ancien des lignes ouvertes du contrat).

**Condors.** Une alerte **par ligne composite** ouverte (`strategy "condors"`, `kind "condor"`,
`legs` présents) — un condor fermé en partie en deux temps fait deux lignes, donc deux alertes.
- Identifiant : `condor:<row.id>`.
- Jambes dans l'ordre garanti `[longPut, shortPut, shortCall, longCall]`.
  `X = (shortCall.strike − shortPut.strike) × margin`.
- Seuil bas `shortPut.strike + X`, direction `below`, **si la jambe put vendue est ouverte** ;
  seuil haut `shortCall.strike − X`, direction `above`, **si la jambe call vendue est ouverte**.
  Aucun des deux : pas d'alerte. `margin` = surcharge, sinon compte, sinon défaut.
- Exemple de référence : 750/790 à 15 % → X = 6 → sous 756, au-dessus de 784.
- Porte aussi les quatre strikes, l'échéance, la quantité, X.

### 3.3 Alertes manuelles

Définies par l'utilisateur (§4) : `ticker`, `price`, `direction`, `note`. La direction est déduite
à la création du cours connu du titre (seuil au-dessus du cours → `above`) ; sans cours connu, du
dernier cours de clôture du graphe où elle est posée.

### 3.4 S₀ : `chooseAnchor(saleWhen, observedAt, livePrice, dayBar)`

Pure, appelée par la coquille (§6.2). Par ordre :
1. `observedAt − saleWhen ≤ ANCHOR_LIVE_WINDOW_MS` et un prix du moment connu → `{price: livePrice, source: "live"}` ;
2. sinon la barre journalière du jour de la vente porte `average` (VWAP d'IB) → `{source: "vwap"}` ;
3. sinon sa `close` → `{source: "close"}` ;
4. sinon `null` (on retentera).

`saleWhen` est une heure IB (heure murale New York stampée UTC, CLAUDE.md) ; `observedAt` est
l'`asOf` du snapshot de l'agent, déjà une heure IB : comparé tel quel, sans `toReportTime`.

### 3.5 Évaluation : `evaluateAlerts(alerts, states, priceOf, now)`

Rend la liste des **transitions** à écrire, sans rien écrire. `priceOf(ticker)` rend
`{price, realtime} | null`. Pas de prix ou seuil `null` : aucune transition, l'état reste.

- `crossed` = un seuil au moins est franchi dans sa direction.
- **Manuelle** : active et `crossed` → déclenchée (`triggeredAt = now`). Déclenchée : le reste
  jusqu'à « Vu », même si le cours revient. « Vu » → désactivée. « Réactiver » → active, direction
  recalculée du cours du moment s'il est connu.
- **Automatique** : armée et `crossed` → déclenchée. « Vu » → acquittée, désarmée ; elle se
  **réarme** d'elle-même quand plus aucun seuil n'est franchi, et peut resonner.
- **Purge** : l'état d'une alerte automatique qui n'existe plus (ligne fermée) est supprimé — mais
  seulement quand les journaux sont prêts, jamais pendant leur chargement.

Les transitions sont testées une à une ; la coquille les écrit en une transaction.

### 3.6 Pastilles : `alertBadgeCounts(alerts, states, rows)`

Rend, pour les seules alertes déclenchées, `{ all, wheel, leaps, condors, others }` :
- `all` : toutes ;
- `wheel` / `condors` : leurs alertes automatiques, plus les manuelles sur un ticker que la
  stratégie détient (une ligne ouverte de la stratégie sur ce ticker) ;
- `leaps`, `others` : les manuelles sur un ticker qu'elles détiennent.

## 4. Stockage : Dexie version 12

- **`alerts`** — les alertes manuelles, clé `id` (`manual:<uuid>`), index `accountId`.
  `{ id, accountId, ticker, price, direction, note: string | null, createdAt }`.
- **`alertStates`** — l'état de toute alerte, clé `[accountId+alertId]`, index `accountId`.
  `{ accountId, alertId, triggeredAt: string | null, acknowledgedAt: string | null,
  disabled: boolean, armed: boolean, anchor: { price, source, observedAt } | null,
  override: number | null }` — `anchor` pour une alerte Wheel seulement, `override` pour la
  fraction Wheel ou la marge Condor de cette alerte. Une alerte sans état est active et armée.
- **`AccountRecord.alertMargins?: { wheel?: number; condor?: number }`**, lu par
  `alertMargins(account)` seul (`apps/web/src/lib/alertMargins.ts`), écrit par `setAlertMargins`
  (`db/accounts.ts`). Absent vaut les défauts du paquet. Réglé dans l'en-tête de la page Alertes.
- Toutes les écritures passent par `apps/web/src/db/alerts.ts`.
- **Sauvegarde** : les deux tables entrent dans `BACKUP_TABLES`, donc dans `TRIGGER_TABLES` et
  l'export `.json.gz`. `deleteAccount` les efface. « Supprimer les transactions » et « Relire les
  relevés » ne les touchent pas : un S₀ survit à une relecture tant que la position est ouverte.

S₀ est **stocké** parce que c'est une observation, pas un calcul : le prix du moment de la
découverte ne se retrouve plus ensuite. Il n'est jamais recalculé une fois écrit.

## 5. Les prix d'évaluation et l'agent

**Source du prix d'un ticker** (`priceOf`, `apps/web/src/alerts/prices.ts`) :
1. action détenue (`STK`) dans le snapshot `agent` du compte → `marketPrice`, temps réel ;
2. sinon le `last` de `/quotes`, différé ;
3. sinon `null`.

**Le magasin de cotations garde `last`.** `parseAgentQuotes` rend `{ last, change }` par symbole ;
`agent/quotes.ts` garde les deux ; `underlyingDayChangeOf` lit `change` comme avant. Les tickers
des alertes manuelles du compte s'ajoutent à la liste que `useUnderlyingQuotes` demande.

**XSP se cote comme indice.** Vérifié contre le vrai TWS le 2026-09-30 à 15:08 New York :
`Index('XSP','CBOE','USD')` se qualifie et rend `last`/`close` en différé (type 3, erreur 10090
« Delayed market data is available »), sans abonnement indice. CLAUDE.md disait l'indice
inaccessible : c'est vrai du temps réel et de l'historique `TRADES`, pas de la cotation différée.
- Web : `apps/web/src/lib/marketIndices.ts`, `INDEX_EXCHANGES = { XSP: "CBOE" }`, seule table.
  `quotedTicker` ne substitue plus SPY à XSP ; `refreshQuotes` passe les indices à part.
- Agent : `/quotes` accepte `indices` (liste `SYMBOLE:BOURSE`, même plafond total que `symbols`),
  qualifie `Index(symbole, bourse, 'USD')` et l'abonne tel quel. Un vieil agent ignore le
  paramètre : XSP reste sans cours, jamais une erreur.
- Conséquence voulue : « Var. jour action » d'une ligne XSP devient la variation de l'indice.
- Les **graphes** gardent SPY (`chartProxyOf`, historique d'indice non vérifié).

**`/bars` rend `average`** (le VWAP de la barre, `BarData.average` d'ib_async, `null` s'il manque).
`PriceBar.average: number | null`. Un vieil agent ne le rend pas : S₀ retombe sur la clôture.

## 6. L'évaluation dans la coquille

### 6.1 Où

`AccountDataProvider` enveloppe désormais **la barre latérale et la page** : `AppLayout` le monte
au-dessus de `SidebarProvider` quand un compte est affiché. Il expose `useAccountAlerts()` →
`{ alerts: AlertView[], badges, status }`. La barre latérale lit `useOptionalAccountAlerts()`,
`null` hors compte. Aucune page ne recalcule les alertes.

### 6.2 S₀

Un effet du fournisseur, quand les journaux sont prêts : pour chaque alerte Wheel sans `anchor`,
`chooseAnchor` avec l'instant présent, le prix de §5 et, si la fenêtre des 15 min est passée, la
barre du jour de la vente lue par `fetchBars` (au plus une requête par ticker et par passe). Un
résultat non nul est écrit une fois. Pas d'agent : rien, on retentera à la passe suivante.

### 6.3 Quand

À chaque changement des prix (snapshot `agent`, magasin de cotations) et des alertes — jamais sur
une horloge. Les transitions de `evaluateAlerts` s'écrivent en une transaction.

### 6.4 Notification

Une transition vers « déclenchée » envoie une notification système
(`apps/web/src/alerts/notify.ts`, seul lecteur de l'API `Notification`) : titre « ZXAB ↑ 38,20 »,
corps « Wheel — call 40 » / « Condor 750/790 » / la note ; un clic focalise l'onglet et ouvre la
page Alertes. La permission est demandée à la création de la première alerte manuelle et par un
bouton de la page Alertes ; un refus ou une API absente ne gêne rien. **Aucune notification en
démonstration.** Pas de toast dans l'application : la pastille suffit.

## 7. Menu et page Alertes

### 7.1 Pastilles

`NavItem.alertScope?: "all" | Strategy` : Positions (vue d'ensemble) `all`, chaque Positions de
stratégie la sienne. `SidebarMenuBadge` rend, s'il y a des alertes déclenchées, une pilule
`bg-warning text-warning-foreground` (jaune sur texte presque noir en sombre, ambre sur blanc en
clair — tokens existants), cloche lucide `Bell` de 12 px et nombre en chiffres tabulaires. Rien à
zéro ; **jamais de clignotement** (réservé à la position non couverte de la barre de titre).

### 7.2 Pied du menu

Sur la ligne de « Découvrir IB Analyzer », à droite : lien « Alertes » avec la cloche, **toujours
présent dès qu'un compte est affiché**, même sans alerte déclenchée ; la pilule jaune s'y ajoute
s'il y en a. Sans compte, pas de lien (la page est scopée au compte).

### 7.3 Page `/accounts/:accountId/alerts`

- En-tête : titre, réglages du compte « Wheel [70 %] » et « Condors [15 %] » (champs numériques
  compacts, écriture par `setAlertMargins`), bouton « Activer les notifications » tant que la
  permission n'est ni accordée ni refusée.
- Une carte, un tableau, trois groupes : **Déclenchées**, **Actives**, **Désactivées** (grisées).
  Une ligne déclenchée porte un filet `warning` de 2 px à gauche, sans fond coloré.
- Colonnes : Type (badge aux teintes de `STRATEGY_BADGE`, « Manuelle » neutre) · Ticker · Seuil(s)
  avec flèche de direction · Cours (infobulle « temps réel » / « différé ») · Distance au seuil le
  plus proche (en %, et en points pour un condor) · Détail (S₀ et sa source, ou strikes et X, ou
  la note) · Actions (« Vu » ; « Réactiver » ; supprimer une manuelle ; fraction/marge éditable
  d'une automatique, vide = réglage du compte).
- Sans agent présent : Cours et Distance « — », et une ligne discrète sous l'en-tête dit que les
  alertes ne s'évaluent pas.
- Un ticker mène à la page Positions de sa stratégie (Positions pour une manuelle).

## 8. Les graphes

### 8.1 Dessin

Un second primitive, `AlertsPrimitive` (`apps/web/src/lib/alertsPrimitive.ts`), attaché à côté de
`LevelsPrimitive` ; sa couture testable, `drawnAlerts`, transforme alertes et états en lignes.
- Ligne : pointillé fin (1 px, points de 2 px espacés de 3 px), teinte `warning` à 55 %
  d'opacité, toute la largeur. **La forme la distingue** du trait des calls vendus, qui partagent
  la même teinte (`chart-2`).
- Étiquette sur l'axe des prix (`priceAxisViews`, qui n'accepte ni bord ni icône) : le seuil,
  sur fond `warning` à 18 % d'opacité.
- Déclenchée : ligne à 100 %, pilule pleine `warning`. Désactivée : non dessinée.
- Condor : ses deux seuils, même style. XSP : dessinés à leurs valeurs XSP sur le graphe SPY,
  comme les strikes aujourd'hui.
- Quelles alertes : les manuelles du ticker toujours ; les automatiques dont la stratégie est dans
  la portée du graphe (règle des niveaux : une page de stratégie la sienne, Positions et
  Suggestion de position toutes).

### 8.2 Poser, régler, supprimer (alertes manuelles seulement)

- **Cloche « + »** : au survol, un petit bouton suit le réticule sur l'axe des prix, à la hauteur
  du curseur. Un clic crée l'alerte au prix de cette hauteur, arrondi au cent. **Alt+clic** dans
  le graphe fait de même (`sourceEvent.altKey`). Sur écran tactile, un appui long.
- **Glisser** la ligne (tolérance de 4 px) déplace le seuil, défilement du graphe suspendu pendant
  le geste ; écrit au relâchement.
- **Clic sur l'étiquette** : popover (`@ib/ui/popover`) — prix exact, note, Supprimer, Réactiver
  sur une alerte déclenchée (une désactivée n'est pas dessinée).
- Une alerte posée sur le graphe d'une ligne XSP est une alerte **XSP**.
- Les automatiques ne se glissent pas : leur seuil se règle par la marge (§7.3).

## 9. La démonstration

`ensureDemoSeeded` écrit, dans sa transaction, deux alertes manuelles : une **déjà franchie** au
cours du jour (déclenchée à la première évaluation) et une **active**. S'y ajoutent les
automatiques de la graine : le condor XSP ouvert (560/615 à 15 % → sous 568,25, au-dessus de
606,75, XSP ≈ 590) est **actif** ; les calls Wheel ouverts d'AMD et KO donnent une alerte s'ils
sont sous le prix d'assignation. L'agent simulé rend `average` sur ses barres et cote XSP comme
indice. `generate.test.ts`/`seed.test.ts` fixent : au moins une alerte déclenchée et au moins une
active après la première évaluation. Captures de `/welcome` régénérées (`pnpm screenshots`) : les
pastilles apparaissent dans la barre latérale.

## 10. Aide et CLAUDE.md

- Aide : une section « Alertes » — les deux automatiques et leurs règles, la pose sur un graphe,
  l'évaluation seulement onglet ouvert et agent présent, à chaque passe (5 min), sur un cours
  différé pour un titre non détenu ; aucun rattrapage entre deux passes.
- CLAUDE.md : une règle « Les alertes » (calcul pur, états et S₀ stockés, pastilles, XSP coté
  comme indice), correction de « XSP se cote par SPY », ligne 42 du registre.

## 11. Tests

- **`packages/alerts`** : `autoAlerts` (call sous/au/au-dessus de l'assignation, prix moyen
  `null`, deux lignes d'un même contrat, condor complet, aile vendue fermée, deux lignes
  composites), seuils de référence (750/790 à 15 % → 756/784 ; S₀ 34, K 40, 70 % → 38,20),
  surcharge > compte > défaut, `chooseAnchor` (14 min et 16 min, `average` présent/absent,
  conversion `toReportTime`), `evaluateAlerts` (chaque transition de §3.5, pas de prix, seuil
  `null`, réarmement, purge), `alertBadgeCounts`.
- **`apps/web`** (fake-indexeddb, ledger semé) : migration 12, sauvegarde et restauration des deux
  tables, `deleteAccount`, `db/alerts.ts`, pastilles par entrée de menu et lien du pied
  (`AppLayout.test.tsx`), page Alertes (groupes, Vu, Réactiver, marges), écriture des transitions
  et de S₀ par le fournisseur, `drawnAlerts`, arrondi et direction à la création, magasin de
  cotations avec `last`, `quotedTicker` sans XSP → SPY, graine de démonstration.
- **Agent** (`FakeIB`) : `/quotes?indices=XSP:CBOE` qualifie un `Index` CBOE ; `/bars` rend
  `average`.
- **À la main, sur l'instance de dev** : la cloche « + », l'Alt+clic, le glisser, le popover, une
  notification réelle.
