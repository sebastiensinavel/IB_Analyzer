# Sous-projet 27 — Les graphes de cours dans les tableaux de positions

Statut : spécifié (2026-09-21). Prototype validé le même jour sur la branche
`prototype-graphes`.

Une position ne se juge pas sur une ligne de tableau. Un put vendu à 17,5 sur un titre qui
cote 13 ne dit pas la même chose selon qu'il revient de 25 ou qu'il descend depuis six mois,
et rien dans l'application ne montre ce chemin. Ce sous-projet pose un **graphe de cours du
sous-jacent** sous la ligne cliquée, dans tous les tableaux de positions, avec les niveaux de
la stratégie dessinés dessus : prix d'assignation, strikes en cours, échéances, ailes de
condors.

Deux règles fondatrices encadrent le travail. Les cours viennent de **TWS par l'agent local**,
jamais d'un fournisseur tiers ni du serveur (§3). Et l'agent restant optionnel (spec
d'architecture §2), son absence ne produit jamais une erreur : elle produit un message qui dit
quoi installer (§7).

---

## 1. Périmètre

**Critère de réussite :** depuis n'importe quel tableau de positions, un clic sur une ligne
ouvre sous elle le graphe du sous-jacent sur deux ans, portant les niveaux de la stratégie de
la page ; un second clic le referme ; un clic ailleurs déplace le graphe. Sans agent, la ligne
s'ouvre quand même et dit comment en installer un.

Dans le périmètre :

1. `/bars` dans l'agent, déjà livré par le prototype (§2) ;
2. le moteur des niveaux, pur, dans `packages/ledger` (§4) ;
3. le dessin : couleurs, étiquettes, verticales, rectangles, axe prolongé (§5) ;
4. l'injection dans les quatre tableaux et la carte Suggestion de position (§6) ;
5. les états sans données (§7) ;
6. les tests qui fixent tout cela (§8).

Hors périmètre, délibérément (arbitré le 2026-09-21, §9) : l'ajustement des splits, le graphe
du prix d'une option elle-même, tout cache de barres, et tout relais de cours par le serveur
Django.

---

## 2. Ce que le prototype a prouvé

La branche `prototype-graphes` a validé la chaîne entière le 2026-09-21, contre un vrai TWS :

- **`/bars` dans l'agent** (`apps/tws-agent/ib_tws_agent/main.py`) rend l'historique de
  `reqHistoricalData` tel quel : `TRADES`, `2 Y`, `1 day`, `useRTH`, contrat `SMART`/`USD`,
  `date` en ISO. Le chemin est dans `ACTING_PATHS` (`cors.py`) : il ouvre une connexion TWS,
  donc il refuse une origine inconnue, et une requête sans en-tête `Origin` du tout.
  Mesuré sur BTDR : 501 barres, du 2024-09-23 au 2026-09-21.
- **L'injection d'une ligne dans un tableau** : `FilteredTableBox` enveloppe déjà chaque ligne
  dans un `Fragment`, donc `renderRow` peut rendre deux `<TableRow>` sans que le composant
  partagé change.
- **Lightweight Charts v5** dessine les chandeliers, une ligne de prix horizontale
  (`createPriceLine`) et — par une primitive de série, la bibliothèque n'ayant rien pour une
  date — une verticale, en clair comme en sombre.

Ce qui était en dur dans le prototype disparaît : `apps/web/src/lib/chartPrototype.ts`, sa
série inventée et le badge « Données de démonstration ». `/bars` et la mécanique d'injection
restent.

---

## 3. La source des cours

**TWS par l'agent local.** Décidé le 2026-09-21 après avoir comparé les quatre voies
possibles :

| Voie | Pourquoi elle est écartée |
|---|---|
| Widget TradingView intégré | Ne sait pas dessiner nos niveaux : il se configure, il ne se pilote pas |
| TradingView Advanced Charts | Licence gratuite réservée à un usage **public** d'entreprise, jamais privé |
| Fournisseur tiers (Tiingo, Massive) relayé par le serveur | Licences « individual use only » incompatibles avec les invitations, clé d'API à protéger, abonnement à payer |
| **TWS par l'agent** | Retenue : rien ne sort de la machine, aucun compte tiers, aucun coût au-delà des abonnements IB déjà payés |

La confidentialité n'a pas pesé dans ce choix : l'utilisateur juge qu'un ticker consulté ne
révèle rien de gênant. Ce sont la licence, la clé et le coût qui tranchent.

**Deux limites acceptées**, documentées chez Interactive Brokers :

- les barres `TRADES` sont **ajustées des splits** (`ADJUSTED_LAST` y ajoute les dividendes) ;
  un strike d'avant un split ne tombe donc pas au bon niveau. Le cas est jugé trop rare pour
  être traité ;
- IB ne garde **aucune donnée de fin de journée pour les options**, et plus rien du tout une
  fois qu'elles ont expiré. Les graphes ne montrent donc que des **sous-jacents** ; une ligne
  d'option ouvre le graphe de son sous-jacent.

Le bridage de cadence ne concerne pas ce travail : les règles des 15 secondes, des 6 requêtes
en 2 secondes et des 60 par 10 minutes sont celles des *barres de 30 secondes ou moins*. Pour
du journalier, la limite applicable est la limite générale, lignes de données ÷ 2 par seconde,
soit 50 requêtes par seconde par défaut — hors d'atteinte pour un graphe à la fois.

---

## 4. Le moteur des niveaux

`packages/ledger/src/journals/levels.ts`, fonction pure :

```ts
strategyLevels(rows: JournalRow[], ticker: string, strategies: readonly Strategy[]): ChartLevel[]
```

Elle ne rend **ni couleur ni texte** — la règle qui vaut déjà pour `JournalRow.note` : le
paquet `ledger` n'écrit rien de visible. Cinq formes :

| `kind` | Champs | Source |
|---|---|---|
| `shares` | `price`, `quantity` | `wheelHoldings` : `averageAssignmentPrice` et `quantity` |
| `shortPut` | `price` (strike), `quantity`, `expiries: string[]` | lignes `short_put` ouvertes |
| `shortCall` | `price` (strike), `quantity`, `expiries: string[]` | lignes `short_call` ouvertes |
| `leapsBuy` | `when`, `quantity` — **pas de prix** | lignes `long_call` de stratégie `leaps`, ouvertes |
| `condor` | `from`, `to`, `putStrikes: [number, number]`, `callStrikes: [number, number]`, `quantity` | lignes `condor` ouvertes et leurs `legs` |

Règles :

- **Une ligne est ouverte selon `endWhen === null`, jamais selon `ongoing`** — la règle du
  capital, pour la même raison : un put assigné reste `ongoing` tant que ses actions ne sont
  pas vendues, alors qu'il n'est plus une vente en cours. C'est aussi ce que fait déjà
  `wheelHoldings` (`packages/ledger/src/journals/holdings.ts`).
- **Un strike, une ligne.** Deux échéances au même strike donnent une seule entrée, quantité
  cumulée, deux dates dans `expiries`. Sans quoi deux horizontales se confondraient au pixel
  près, avec deux étiquettes superposées.
- **`leapsBuy` n'a pas de prix** parce qu'il n'en existe pas : le journal connaît le prix payé
  pour l'option, pas le cours du sous-jacent ce jour-là. Le milieu haut-bas
  (`(high + low) / 2`) de la barre du jour d'achat est résolu au dessin, seul endroit où les
  barres existent. Un jour d'achat sans barre — titre non coté ce jour-là, historique plus
  court que l'achat — ne dessine rien.
- **Les condors sont ceux en cours**, du `startWhen` du composite à l'échéance
  (`contract.expiry`), pas à aujourd'hui : c'est la fenêtre de risque. Les quatre strikes se
  lisent sur `row.legs`, dans l'ordre garanti par `condor.ts` — long put, short put, short
  call, long call.
- **`strategies` porte la portée** : une page de stratégie passe la sienne, la page Positions
  et la carte Suggestion passent les quatre.

---

## 5. Le dessin

`apps/web/src/lib/chartLevels.ts` donne à chaque forme sa couleur et son étiquette ;
`apps/web/src/components/PriceChart.tsx` dessine.

**Couleurs.** Celles de `lib/chartColors.ts`, dont les tons du journal empruntent déjà les
teintes (`lib/journalTone.ts`) : index 0 le bleu des actions assignées, 1 l'orange des calls
vendus, 2 le vert des puts vendus, 3 l'ambre, libre, pour les achats LEAPS. Une variante
claire et une sombre, comme partout ailleurs. Les condors prennent le bleu de la palette en
fond translucide.

**Étiquettes.** À gauche, dans un petit cadre, à la manière de l'étiquette de dernier cours :
le niveau puis la nature et la quantité signée.

```
14,8 Long: 700     17,5 Put: -6     22 Call: -4     12,3 LEAPS: 2
```

Les nombres sont écrits court, sans zéros inutiles : `22`, `17,5`. L'échelle de droite garde
sa seule étiquette de dernier cours. Les condors n'en portent aucune : leurs quatre strikes
sont les bords de leurs rectangles.

**Verticales.** Une par échéance, en pointillés, dans la couleur de son horizontale, sa date
sous l'axe du temps. Les achats LEAPS en ont une au jour d'achat.

**L'axe du temps est prolongé** de jours vides après la dernière barre, jusqu'à l'échéance la
plus lointaine dessinée : sans cela une échéance future n'a aucune coordonnée et ne peut pas
être tracée. La zone sans chandelier à droite est le temps qui reste avant expiration.

**Taille et type restent ceux du prototype** : chandeliers, `CHART_HEIGHT` (650 px), deux ans
de journalier, logo TradingView visible — la licence Apache 2.0 de Lightweight Charts l'exige.

---

## 6. L'intégration dans les tableaux

Quatre points d'accroche, tous scopés au compte affiché :

| Où | Composant | Ligne | Ticker | Portée |
|---|---|---|---|---|
| Page Positions, 4 encarts | `PositionGroupCard` | `AnalyzedPosition` | `symbol` (déjà le sous-jacent) | les quatre stratégies |
| Pages de stratégie, encarts d'options et d'actions | `LinesBox` (`StrategyPositionsPage.tsx`) | `StrategyLine` | `contract.ticker` | celle de la page |
| Page Positions Wheel, « Actions assignées » | `SharesBox` | `WheelShareLine` | `ticker` | `wheel` |
| Tableau de bord, « Suggestion de position » | `PositionSuggestionsCard` | `PositionSuggestion` | `ticker` | les quatre stratégies |

Les trois premiers passent par `FilteredTableBox` : `renderRow` rend la ligne puis, si elle
est ouverte, la ligne du graphe. Le quatrième a sa table à lui, sans tri ni filtre :
l'injection y est écrite à la main, à l'identique.

`useOpenChart()` porte l'état — **une seule ligne ouverte par page**, quel que soit l'encart :
ouvrir ailleurs ferme la précédente. La clé d'ouverture est celle de la ligne, préfixée de
l'identifiant de l'encart, deux encarts pouvant porter le même contrat.

`PositionChartRow` reçoit le ticker, la portée et le nombre de colonnes de sa table (douze
pour les tableaux partagés, onze pour les actions assignées, six pour les suggestions), et
occupe toute la largeur. Les journaux ne sont pas recalculés : ils sont déjà en mémoire dans
`AccountDataProvider`, lus par `useAccountJournals`.

**Aucun cache de barres.** Chaque ouverture interroge TWS, y compris pour un ticker déjà vu :
le graphe est alors toujours à jour, barre du jour comprise. Pas de table Dexie, pas de
migration, rien à périmer.

---

## 7. Sans données

L'agent est optionnel : son absence ne produit jamais une erreur, seulement un graphe en
moins. La ligne s'ouvre **toujours**, immédiatement, et porte un bandeau d'attente pendant
l'appel. Trois issues, trois messages, jamais un graphe à moitié dessiné :

| Cause | Ce qui s'affiche |
|---|---|
| Pas de port TWS sur le compte, ou agent injoignable | « Ce graphe demande l'agent local », avec le lien vers la page Aide, qui est le mode d'emploi d'installation |
| L'agent répond, TWS non (503) | « TWS ne répond pas sur le port 7501 » |
| L'agent répond, zéro barre | « Interactive Brokers ne rend aucun historique pour BTDR » — le cas d'un abonnement de données manquant ou d'un ticker inconnu |

Les textes vivent dans `apps/web/src/i18n/{fr,en}.json`, comme tout texte visible.

---

## 8. Tests

**`packages/ledger`, Vitest pur** sur `levels.ts` : deux échéances au même strike fondues en
une entrée aux quantités cumulées ; un put assigné qui ne compte plus comme vente en cours
alors qu'il reste `ongoing` ; un condor partiellement racheté qui rend un jeu de rectangles
par ligne composite ; un `leapsBuy` sans prix ; une portée qui ne retient que sa stratégie.

**`apps/web`, Vitest sur `fake-indexeddb`** avec un ledger semé en base, jamais en moquant les
hooks : l'injection sous la ligne cliquée dans chacun des quatre tableaux ; l'unicité du
graphe ouvert d'un encart à l'autre ; la largeur de la ligne injectée ; les étiquettes
produites pour chaque forme ; les trois messages d'absence de données. Lightweight Charts est
bouchonné — `vitest.setup.ts` rend `getContext` nul exprès, jsdom n'ayant pas de canevas.

**`apps/tws-agent`, pytest sur `FakeIB`** : les tests de `/bars` livrés par le prototype
suffisent, l'endpoint ne bouge pas.

**Vérification visuelle** par le driver de `run-frontend`, en clair et en sombre, sur la page
Positions et sur une page de stratégie.

---

## 9. Décisions écartées

| Écarté | Pourquoi |
|---|---|
| Un fournisseur de cours tiers, relayé par le serveur Django | Licence, clé d'API et abonnement, là où TWS ne coûte rien de plus (§3) |
| Ajuster les niveaux pour les splits | Trop rare dans ce portefeuille pour payer la complexité, alors qu'IB n'offre aucune barre non ajustée |
| Le graphe du prix d'une option | IB n'a pas de données de fin de journée pour les options, et plus rien après l'expiration |
| Cacher les barres en IndexedDB | Une table et une migration de plus, des barres à périmer, pour une attente d'une à trois secondes |
| Dessiner les condors clos, ou les arrêter à aujourd'hui | Le rectangle qui compte est la fenêtre de risque encore ouverte, de l'ouverture à l'échéance |
| Une horizontale par échéance et par strike | Deux traits confondus et deux étiquettes superposées dès que deux échéances partagent un strike |
| Le prix de droite sur chaque niveau | Doublon avec l'étiquette de gauche, qui porte déjà le niveau |
