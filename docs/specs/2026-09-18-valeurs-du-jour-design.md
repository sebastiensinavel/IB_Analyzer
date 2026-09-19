# Sous-projet 23 — Valeurs du jour : P&L du jour et variation par position

Statut : implémenté (2026-09-18).

TWS affiche pour chaque position, sans aucun abonnement de données de marché, un *Daily P&L*
et un *Change %*. L'agent local rend aujourd'hui `ib.portfolio()` : dernier prix, valeur de
marché, P&L latent — rien du jour. Ce sous-projet fait relayer par l'agent le P&L du jour de
chaque position, en déduit dans le navigateur la variation du jour, et pose les deux valeurs
dans tous les tableaux de positions.

Rien ne quitte la machine de l'utilisateur. `apps/api` ne change pas : ces valeurs sont des
données de portefeuille, elles vont de TWS à l'agent, de l'agent au navigateur, et
s'arrêtent là.

---

## 1. Ce que la sonde a établi

Une sonde jetable, hors dépôt, a interrogé un vrai TWS en séance le 2026-09-18, en lecture
seule, sur un portefeuille de plusieurs dizaines de positions — actions, options sur actions,
options sur indice :

- `reqPnLSingle(account, modelCode, conId)` répond **sans abonnement** et sous
  `readonly=True`, pour **toutes** les positions, options comprises ;
- le premier message porte déjà un `dailyPnL` exploitable ; la première valeur arrive entre
  0,65 s et 2,32 s après l'envoi des requêtes, médiane 1,22 s ;
- `dailyPnL / (value − dailyPnL)` donne une variation au signe juste pour une position longue
  comme pour une position vendue : pour une position tenue depuis la veille,
  `value − dailyPnL` est sa valeur à la clôture précédente, et le rapport vaut
  `(prix − clôture) / clôture` quel que soit le signe de la quantité ;
- cette variation suit le **prix de marque** dont IB tire son P&L du jour. La colonne
  *Change %* de TWS suit le dernier échange : sur une option peu traitée les deux diffèrent.
  La valeur déduite est celle qui explique le P&L du jour affiché à côté ; elle n'est pas, et
  ne prétend pas être, la colonne de TWS ;
- la sonde n'a vu que des positions en USD sur un compte en USD : la devise du `dailyPnL`
  d'une position dans une autre devise n'est **pas vérifiée**. Le rapport `dayChange` n'en
  dépend pas — `dailyPnL` et `value` viennent du même message — mais le montant, si ;
- les données différées 15 min (`reqMarketDataType(3)`) couvrent aussi les options par l'API,
  au prix d'une erreur 10091 par contrat et de lignes de données de marché. Cette voie
  existe ; ce sous-projet ne l'emprunte pas (§8).

---

## 2. Périmètre

Dans le périmètre :

- l'agent : `/snapshot` souscrit le P&L de chaque position et le rend dans sa réponse ;
- le parseur de l'agent (`packages/ib-parsers/src/agent.ts`) : deux champs de plus sur
  `Position` ;
- `Position` (`packages/ledger/src/types.ts`), et les parseurs Flex et relevé qui écrivent
  `null` ;
- une montée de version Dexie qui pose `null` sur les snapshots déjà stockés ;
- `packages/coverage` : les lignes de stratégie et les actions de la Wheel portent la part de
  la stratégie ;
- l'affichage : deux colonnes de plus dans `POSITION_COLUMNS` — donc la page Positions et
  les quatre pages Positions de stratégie — et dans `WHEEL_SHARE_COLUMNS`.

Hors périmètre, déclaré tel :

- le **total du jour du compte** (`reqPnL`), sur le Dashboard ou la barre de titre ;
- tout **total par encadré** : aucun encadré ne totalise aujourd'hui ;
- le **Dashboard**, les **Journaux**, l'**Historique**, la **Suggestion de Position** ;
- les **données de marché**, différées ou non ;
- un **flux continu** : l'agent ne tient jamais de connexion (spec fondateur §3.4). Les
  valeurs ont l'âge du snapshot, rafraîchi toutes les `AGENT_POLL_MS` ou par « Actualiser ».

---

## 3. Agent

`apps/tws-agent/ib_tws_agent/main.py`, dans `/snapshot`, sur la connexion déjà ouverte et
avant de la refermer :

1. lire `ib.portfolio()` une fois ;
2. pour chaque élément, `ib.reqPnLSingle(item.account, "", item.contract.conId)` ;
3. attendre que chaque souscription ait reçu un premier message, au plus `PNL_TIMEOUT_S = 5`
   secondes en tout — l'attente s'arrête dès que toutes ont répondu ;
4. `ib.cancelPnLSingle(...)` pour chacune, puis construire la réponse.

`CONNECT_TIMEOUT_S + PNL_TIMEOUT_S` reste sous `AGENT_FETCH_TIMEOUT_MS` (15 s) du navigateur.

Chaque position sérialisée gagne un champ `pnl` :

```json
"pnl": { "dailyPnL": -12.5, "value": 1840.0 }
```

- les deux noms sont ceux des attributs de `PnLSingle`, comme partout dans ce fichier ; les
  deux valeurs viennent du **même message**, ce qui rend leur rapport cohérent —
  `marketValue`, lui, vient de `updatePortfolio`, à un autre instant ;
- `pnl` vaut `null` quand aucun message n'est arrivé avant l'échéance ;
- dans `pnl`, une valeur que IB n'a pas — `nan`, ou sa sentinelle `DBL_MAX` — sort en
  `null`, jamais en `0.0`. C'est le précédent de `commission` : pas de rapport, pas de
  valeur. `nan` n'est de toute façon pas du JSON.

**Cette étape ne fait jamais échouer le snapshot.** Une exception pendant la souscription,
l'attente ou l'annulation laisse les positions sortir avec `pnl: null` ; seule la connexion
à TWS décide d'un 503.

Le compte passé à `reqPnLSingle` est celui de l'élément de portefeuille. Rien ne change pour
un TWS à plusieurs comptes : le navigateur refuse toujours (`account-mismatch`).

La version du paquet monte d'un cran mineur ; `/health` la rend déjà.

`FakeIB` (`apps/tws-agent/tests/conftest.py`) gagne `reqPnLSingle`, `cancelPnLSingle` et
`pnlSingleEvent`, avec de quoi scénariser : réponse immédiate, réponse absente, valeurs
`nan` ou `DBL_MAX`, exception.

---

## 4. Parseur de l'agent

`readPosition` (`packages/ib-parsers/src/agent.ts`) écrit deux champs :

- **`dailyPnl`** : `pnl.dailyPnL` tel quel ; `null` si `pnl` est absent, `null`, ou si la
  valeur l'est ;
- **`dayChange`** : `dailyPnL / (value − dailyPnL)`, en **fraction** (0,0215 pour +2,15 %).
  `null` si `dailyPnL` ou `value` manque, si le dénominateur est nul, ou si le contrat a été
  **mouvementé aujourd'hui** : son `conId` figure dans les `executions` de la même réponse.

Un contrat mouvementé garde donc son `dailyPnl` — IB le calcule juste, en partant du prix
d'exécution — et perd sa variation, que la formule ne sait plus déduire. Cela se répare seul
le lendemain.

**Un agent plus ancien n'envoie pas `pnl`** : le champ absent vaut `null`, jamais une erreur
de validation. L'agent est optionnel, une version en retard aussi : des fonctionnalités en
moins, pas un échec de synchro.

---

## 5. `Position` et stockage

`packages/ledger/src/types.ts` :

```ts
/** Today's P&L as IB computes it. Agent snapshots only. */
dailyPnl: number | null;
/** Today's move of the mark price, as a fraction. Derived, never TWS's "Change %". */
dayChange: number | null;
```

Les parseurs Flex (`flex.ts`) et relevé (`statement.ts`) écrivent `null` pour les deux : un
fichier n'a pas de « jour ».

Les snapshots déjà en base n'ont pas ces champs. Une **version Dexie 9**, sans changement de
schéma, réécrit chaque document de `snapshots` en posant `null` sur les positions qui ne les
portent pas — le précédent est la version 7, première montée à réécrire des lignes. Les
types restent vrais, aucun lecteur n'a à se méfier d'un `undefined`.

Ces valeurs **appartiennent au snapshot**, comme le dernier prix : un snapshot `agent` d'hier
montre le P&L du jour d'hier, et `SnapshotStatus` en affiche déjà la date. Un snapshot Flex
ou relevé qui remplace un snapshot `agent` (`db/snapshot.ts`, règle inchangée) les ramène à
« — ».

---

## 6. Part de la stratégie

Une ligne de page de stratégie montre la part de la stratégie, pas la position entière
(`strategyPositions`, `packages/coverage/src/strategy.ts`). Pour la position du snapshot
qu'elle apparie :

- `dayChange` est repris tel quel : il ne dépend pas de la quantité ;
- `dailyPnl` est proratisé : `dailyPnl × quantité de la ligne / quantité de la position` ;
- **si `dayChange` de la position est `null`, les deux valent `null` sur la ligne.** Un
  contrat mouvementé aujourd'hui ne se proratise pas — les titres entrés ce matin n'ont pas
  le P&L du jour par unité de ceux tenus depuis hier — et c'est `dayChange` qui le dit ;
- pas de position appariée, quantité de position nulle : `null`.

La même règle vaut pour les jambes d'un condor, pour les lignes migrées vers Autres
(`migratedContracts`) et pour les actions de la Wheel (`WheelShareLine`, prorata sur
`holding.quantity`).

La page Positions de la vue d'ensemble montre la position entière : `dailyPnl` d'IB tel
quel, même mouvementé, et `dayChange` à « — » dans ce cas.

---

## 7. Affichage

Arbitrages tranchés avant l'implémentation.

**Colonnes.** `POSITION_COLUMNS` passe de dix à douze, `WHEEL_SHARE_COLUMNS` de neuf à onze.
Dans les deux, `dayChange` vient juste après `lastPrice` et `dailyPnl` juste avant
`unrealizedPnl` :

| Position | Type | Secteur | Valeur de marché | Qté | Prix init. | Dernier prix | **Var. jour** | **P&L jour** | P&L latent | Décision | Couverture |
|---|---|---|---|---|---|---|---|---|---|---|---|

**Libellés.** `dayChange` : « Var. jour » / « Day chg ». `dailyPnl` : « P&L jour » /
« Daily P&L ». « Var. jour » et non « Change % » : ce n'est pas la colonne de TWS (§1).

**Format.** `dayChange` en pourcentage signé à une décimale (« +2,2 % », « −10,0 % »),
`dailyPnl` comme `unrealizedPnl` ; les deux prennent la couleur du P&L latent selon leur
signe. `null` s'affiche « — ».

**Tri et filtre.** Deux `ColumnSpec` de type `number`, triables et filtrables, ajoutées à
`positionColumnSpecs` et aux specs des pages de stratégie ; `null` trie en dernier dans les
deux sens, règle du moteur. Le filtre de `dayChange` compare la fraction stockée à une saisie
en pourcentage : la spec de colonne déclare la valeur en pourcentage (`fraction × 100`) pour
que « > 5 » veuille dire +5 %.

**Cash.** La table du cash laisse les deux colonnes vides, comme les autres.

**Largeurs.** Les douze largeurs de `POSITION_COLUMNS`, les onze de `WHEEL_SHARE_COLUMNS` et
la largeur minimale du tableau (60rem aujourd'hui) sont re-mesurées **en une passe, par un
script** qui mesure chaque libellé français et la donnée la plus longue de chaque colonne ;
elles somment à 100. Aucune itération sur des captures. Deux captures finales, vérifiées
différentes des précédentes, accompagnent la revue : page Positions et page Wheel à 1280 px,
menu ouvert, graine `--agent` dont la fixture porte `pnl`.

La fixture `--agent` du skill `run-frontend` gagne `pnl` sur ses positions, dont une à
`null` et une mouvementée.

---

## 8. Décisions écartées

- **Un endpoint `/pnl` séparé**, fusionné dans le navigateur : deux connexions `clientId 0`
  successives, deux instants à fusionner par `conid`, deux états d'échec, pour gagner deux
  secondes sur une synchro qui a lieu toutes les cinq minutes.
- **Une connexion tenue ouverte** pour un flux continu : contraire au spec fondateur §3.4.
- **Les données différées** pour donner un vrai *Change %* aux contrats mouvementés :
  jusqu'à 11 s de plus, des lignes de données de marché, une erreur 10091 par option, et le
  prorata des pages de stratégie resterait faux.
- **Afficher la variation d'un contrat mouvementé avec un avertissement** : l'application
  n'affiche nulle part un nombre qu'elle sait faux. Une valeur absente reste `null`.
- **Calculer `dayChange` à l'affichage** plutôt qu'à l'écriture du snapshot : « mouvementé
  aujourd'hui » se sait au moment de la synchro, par les exécutions de la même réponse ; le
  relire plus tard dans le ledger mêlerait les jours.

---

## 9. Tests

Chaque test échoue si le comportement change.

- **pytest, `FakeIB`** (`test_snapshot.py`) : toutes les positions répondent → `pnl` rempli
  et souscriptions annulées ; une position muette → son `pnl` est `null`, les autres remplis,
  l'attente bornée par `PNL_TIMEOUT_S` (horloge injectée, pas cinq vraies secondes) ; `nan`
  et `DBL_MAX` → `null` ; exception pendant l'étape → snapshot 200, tous `pnl` à `null` ;
  portefeuille vide → aucune attente.
- **Vitest, `agent.test.ts`** : position longue, position vendue (signe), contrat mouvementé
  (`dailyPnl` gardé, `dayChange` `null`), `pnl` absent (agent ancien), `pnl: null`,
  `dailyPnL: null`, dénominateur nul.
- **Vitest, `flex` et `statement`** : les deux champs sont `null`.
- **Vitest, `strategy.test.ts`** : prorata d'une ligne partielle, `dayChange` repris,
  position mouvementée → deux `null`, ligne migrée vers Autres, actions de la Wheel.
- **Vitest web, `fake-indexeddb`** : montée Dexie 9 sur un snapshot sans les champs ; les
  deux colonnes rendues sur Positions, une page de stratégie et « Actions assignées » ; « — »
  sous un snapshot Flex ; tri avec `null` en dernier ; filtre « > 5 » sur la variation.
- `pnpm check` une fois à la fin ; `pnpm test:agent` à part, que `pnpm check` ne lance pas.

---

## 10. Documentation

- `CLAUDE.md` : une règle « valeurs du jour » — de l'agent seul, `null` pour tout fichier ;
  `dayChange` déduit du prix de marque, jamais la colonne de TWS, `null` pour un contrat
  mouvementé ; la part de stratégie proratise et suit `dayChange` ; l'étape PnL ne fait
  jamais échouer le snapshot. Les mentions « dix colonnes » et « neuf colonnes » passent à
  douze et onze. Ligne 23 du tableau des sous-projets.
- `docs/points-reportes.md` : relu au début du sous-projet ; y consigner que la devise du
  `dailyPnL` d'une position hors USD n'a pas été vérifiée, et qu'une position a
  montré un `dailyPnL` nul en séance pendant la sonde, à comparer à TWS — si TWS affiche
  aussi zéro, fermer le point.
- Page Aide : une phrase sur l'origine des deux colonnes et sur le « — » d'un contrat
  mouvementé ou d'un snapshot de fichier.
