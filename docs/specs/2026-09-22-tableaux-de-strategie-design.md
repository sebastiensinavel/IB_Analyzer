# Sous-projet 29 — Les tableaux de la Wheel et des LEAPS rangés par point de contrôle

Statut : livré (2026-09-22).

Les pages Positions de la Wheel et des LEAPS montrent chacune deux tableaux : « Actions
assignées » et « Ventes d'options » pour la Wheel, « Achats d'options » et « Ventes d'options »
pour les LEAPS. Ce qu'on veut y vérifier d'un coup d'œil reste noyé dans les lignes : des
actions assignées pour lesquelles on a oublié de vendre un call, un call vendu sous le prix
d'assignation, un LEAPS qui ne porte aucun call.

Ce sous-projet range les mêmes lignes dans davantage de tableaux, un par point de contrôle.
Il ne change aucune donnée, aucun calcul de journal, aucune couverture. C'est une vue
calculée, jamais stockée, comme `strategyPositions` (sous-projet 16).

---

## 1. Périmètre

**Critère de réussite :** avec 200 actions XYZ assignées dans la Wheel et un seul call vendu
dessus, la page Wheel montre 100 actions dans « Actions assignées sans call » et 100 dans l'un
des deux tableaux « call ≥ / < assignation ». Avec 2 LEAPS XYZ achetés et un seul call vendu
dessus, la page LEAPS montre 1 LEAPS dans « LEAPS sans call vendu » et 1 dans « LEAPS avec
call vendu ».

Dans le périmètre : les encadrés des pages Wheel et LEAPS (§2, §3), le découpage d'une ligne
en deux parts (§4), les vues de tri et de filtre des nouveaux encadrés (§5), les titres en
français et en anglais (§6), les tests (§7).

Hors périmètre : les pages Condors et Autres, la page Positions, les journaux, le moteur de
couverture et les graphes. Un graphe ouvert depuis n'importe quel tableau montre ce qu'il
montre aujourd'hui : le sous-jacent et les niveaux de la seule stratégie de la page, même
quand les actions d'un ticker se répartissent sur deux tableaux.

## 2. Page Wheel : cinq encadrés

Dans cet ordre :

| # | Identifiant | Titre | Contenu |
|---|---|---|---|
| 1 | `sharesUncovered` | Actions assignées sans call | part libre de chaque ticker |
| 2 | `sharesCallAbove` | Actions assignées, call ≥ assignation | part couverte, `averageCallStrike ≥ averageAssignmentPrice` |
| 3 | `sharesCallBelow` | Actions assignées, call < assignation | part couverte, sinon |
| 4 | `callSells` | Ventes de calls | lignes `short_call` de `groups.optionSells` |
| 5 | `putSells` | Ventes de puts | lignes `short_put` de `groups.optionSells` |

Les trois premiers encadrés gardent les onze colonnes de `WHEEL_SHARE_COLUMNS` et la ligne
`WheelShareRow`. Les deux derniers gardent `POSITION_COLUMNS` et `PositionRow`.

**Comparaison au prix moyen (arbitré le 2026-09-22).** Les deux parts d'un ticker portent le
même `averageAssignmentPrice`, celui de toutes les actions Wheel du ticker, jamais celui des
lots que le journal ferait sortir à l'assignation. Cette dernière règle est une convention de
l'application (FIFO parmi les actions Wheel, `closePreferring`), et non celle d'IB, qui suit la
méthode d'appariement réglée sur le compte. Économiquement, la position ne dépend d'aucune de
ces deux conventions. L'objet du découpage est de repérer les actions oubliées, pas de prédire
un P/L réalisé.

**Comparaison impossible.** Une part couverte dont `averageCallStrike` ou
`averageAssignmentPrice` est `null` va dans le tableau 3, sans surlignage d'alerte : dans le
doute, elle apparaît dans le tableau à surveiller. Le surlignage de la cellule du prix du call
(`callStrikeBelowAssignment`) reste tel qu'aujourd'hui, donc vrai seulement quand les deux prix
existent et que le call est en dessous.

**Badge Couverture.** La part libre porte `unused`, la part couverte `used N/N`, où N est sa
propre quantité. La colonne « Prix moyen call » de la part libre affiche « — »
(`averageCallStrike: null`, `openCallContracts: 0`).

## 3. Page LEAPS : trois encadrés, plus les actions

Dans cet ordre :

| # | Identifiant | Titre | Contenu |
|---|---|---|---|
| 1 | `leapsUncovered` | LEAPS sans call vendu | part libre de chaque ligne de `groups.optionBuys` |
| 2 | `leapsCovered` | LEAPS avec call vendu | part utilisée de ces mêmes lignes |
| 3 | `callSells` | Ventes de calls | lignes `short_call` de `groups.optionSells` |
| 4 | `long` | Actions | inchangé : les actions livrées par un LEAPS, quand il y en a |

**Part utilisée d'un LEAPS.** `min(|quantity|, position.usedQuantity)`, où `position` est la
position IB analysée par le moteur de couverture : la même source que le badge `used x/y`
d'aujourd'hui. Sans position dans le snapshot, la part utilisée vaut 0 et toute la ligne est
libre. Dans ce cas la ligne reste entière dans l'encadré libre, sans être découpée, et garde
`used: null` — donc aucun badge, comme avant ce sous-projet. La part libre porte `unused`, la
part utilisée `used k/k`.

Le journal LEAPS ne vend que des calls. Si une vente de put devait un jour y apparaître, elle
irait dans un encadré `other` (« Autres »), déclaré en dernier pour ce seul cas : jamais perdue sans bruit.

## 4. Découpage d'une ligne en deux parts

Une fonction pure dans `packages/coverage/src/strategyBoxes.ts`, testée seule :

- `splitWheelShares(line: WheelShareLine)` rend `{ uncovered, covered }`, chaque part étant
  une `WheelShareLine` ou `null` quand sa quantité vaut 0. Pour `covered`, la quantité est
  `coveredShares`. Pour `uncovered`, elle vaut `quantity − coveredShares`.
- `splitLeaps(line: StrategyLine)` rend `{ uncovered, covered }` sur le même modèle, avec des
  parts de type `StrategyLine`.

Dans chaque part :

- **au prorata de la quantité** : `quantity`, `assignedTotal`, `marketValue`,
  `unrealizedPnl` et `dailyPnl` (comme `dayShare`), ainsi que `coveredShares` pour la Wheel ;
- **inchangés** : `averageAssignmentPrice` et `avgPrice`, `lastPrice`, `dayChange`,
  `averageCallStrike` (sauf la part libre de la Wheel, à `null`), `decision` et `position` ;
- **une valeur absente reste `null`**, jamais `0`.

La répartition entre les cinq (ou quatre) encadrés se fait dans `packages/coverage`, par une
fonction qui prend `StrategyPositions` et la stratégie et qui rend les lignes de chaque
identifiant d'encadré. La page ne décide rien, elle affiche.

## 5. Vues de tri et de filtre

`STRATEGY_BOXES` (`apps/web/src/lib/strategyBoxes.ts`) déclare les nouveaux identifiants.
Condors et Autres ne changent pas. `StrategyBoxId` s'étend en conséquence.

`useStrategyBoxViews` appelle un `useTableView` par identifiant, pris dans une liste fixe
indépendante de la stratégie, pour que le nombre de hooks ne varie jamais. Chaque encadré a
donc sa clé `ib2:tableView:<compte>:positions:<stratégie>:<encadré>`, effacée par
`deleteAccount` comme les autres. Les anciennes clés `…:wheel:shares`, `…:wheel:optionSells`,
`…:leaps:optionBuys` et `…:leaps:optionSells` deviennent orphelines, sans effet : aucune
migration.

Le filtre d'échéance, la recherche par ticker et l'ouverture d'un graphe (clé
`<encadré>|<ligne>`) fonctionnent comme aujourd'hui, encadré par encadré.

## 6. Textes

Nouveaux titres dans `apps/web/src/i18n/fr.json` et `en.json`, sous
`strategyPositions.groups` :

| Clé | fr | en |
|---|---|---|
| `sharesUncovered` | Actions assignées sans call | Assigned shares without a call |
| `sharesCallAbove` | Actions assignées, call ≥ assignation | Assigned shares, call ≥ assignment |
| `sharesCallBelow` | Actions assignées, call < assignation | Assigned shares, call < assignment |
| `callSells` | Ventes de calls | Call sales |
| `putSells` | Ventes de puts | Put sales |
| `leapsUncovered` | LEAPS sans call vendu | LEAPS without a sold call |
| `leapsCovered` | LEAPS avec call vendu | LEAPS with a sold call |

`strategyPositions.groups.assignedShares` disparaît s'il n'a plus d'usage.

## 7. Tests

Vitest dans `packages/coverage`, écrits à la main :

- 200 actions assignées et 1 call : 100 dans la part libre, 100 dans la part couverte, avec
  `assignedTotal`, `unrealizedPnl` et `dailyPnl` divisés par deux ;
- call au-dessus du prix d'assignation, dans le tableau 2 ; call en dessous, dans le
  tableau 3 ; égalité, dans le tableau 2 ;
- strike ou prix d'assignation absent : tableau 3, `callStrikeBelowAssignment` faux ;
- tout couvert : pas de part libre ; aucun call : pas de part couverte ;
- 2 LEAPS et 1 call utilisé : 1 + 1 ; LEAPS sans position dans le snapshot : tout libre ;
- ventes de calls et de puts séparées ; Condors et Autres inchangés.

Un test de page dans `apps/web`, sur `fake-indexeddb` avec un ledger semé : la page Wheel
montre ses cinq titres avec les bonnes quantités, la page LEAPS ses trois.

## 8. Décisions arbitrées

- Prix moyen d'assignation du ticker pour les deux parts, et non les lots FIFO que le journal
  ferait sortir (§2), arbitré le 2026-09-22.
- Une part couverte dont la comparaison est impossible va dans le tableau 3 (§2).
- La part utilisée d'un LEAPS vient du `usedQuantity` du moteur de couverture, comme le badge
  (§3).
- L'encadré « Actions » des LEAPS reste, en dernier, rendu seulement s'il a des lignes (§3).
