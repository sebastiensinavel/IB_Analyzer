# Sous-projet 22 — La part nue quitte les pages de stratégie

Statut : spécifié (2026-09-18).

Le sous-projet 16 a donné une page Positions à chaque stratégie, le 21 les a équipées de
recherche, de tri et de filtres, et a reporté ceci :

> **La page Autres ne montre pas toute la part nue du portefeuille** : un call vendu
> partiellement couvert par des actions Wheel reste entier dans la Wheel, par classification à
> la vente.

Ce sous-projet referme ce point, et avec lui la dette du sous-projet 16 sur le badge « used »
trompeur de la carte des actions Wheel.

**La règle décidée** : une position nue n'appartient à aucune stratégie — c'est une erreur, et
peu importe d'où elle vient. Une page de stratégie ne montre donc que la part **couverte** de ses
ventes d'options ; tout le reste est nu et se lit sur la page Autres et sur la page Positions de
la vue d'ensemble.

Rien ne quitte le navigateur. `apps/api` ne change pas, IndexedDB non plus : aucune table, aucun
champ, aucune migration. Le resplit est une vue calculée de plus.

---

## 1. Périmètre

Dans le périmètre :

- `packages/coverage/src/strategy.ts` : `strategyPositions` resplite les ventes d'options sur la
  couverture réelle du snapshot ;
- la carte « Actions assignées » de la page Positions Wheel, dont les calls deviennent les calls
  couverts ;
- `apps/web/src/lib/riskReport.ts` si le plafonnement des badges y est plus à sa place.

Hors périmètre, déclaré tel :

- **le journal ne bouge pas.** La classification se fait une fois, à la vente (spec du
  sous-projet 5, §3.4 ; spec du sous-projet 9, §1), et `splitShortCall` sépare déjà la part nue
  d'une vente qui dépasse la couverture du jour. Les quatre Journaux, le capital, les
  statistiques, le tableau de bord et les graphiques sont inchangés ;
- **la page Positions de la vue d'ensemble** montre déjà la position IB entière avec son
  `UNCOVERED ×n` : elle ne change pas ;
- **la page Consistance et la barre de titre** lisent le moteur de couverture, pas ces vues :
  inchangées ;
- **la suggestion de position**, qui mesure des valeurs de risque sur le snapshot : inchangée ;
- `packages/ledger`, `packages/ib-parsers`, le serveur, l'agent, le déploiement.

---

## 2. Ce que fait le moteur aujourd'hui

À la vente, `splitShortCall` (`packages/ledger/src/journals/classify.ts`) répartit `n` calls
vendus entre la capacité en actions de la Wheel, la capacité en LEAPS et rien : 100 actions
assignées puis 2 calls vendus donnent déjà un lot Wheel et un lot Autres. Ce cas-là est traité.

Le trou est postérieur à la vente : un call **couvert à la vente** devient nu quand sa
couverture s'en va — actions vendues, actions reprises par un autre call, LEAPS long revendu,
aile de condor rachetée. Le lot reste alors dans sa stratégie d'origine, et :

- la page de la stratégie l'affiche entier, avec les badges de couverture de ses seules sources
  (`STRATEGY_COVER_SOURCES`), donc sans jamais dire `UNCOVERED` ;
- la carte « Actions assignées » de la Wheel calcule `coveredShares = min(actions, contrats ×
  100)` : deux calls ouverts sur 100 actions restantes affichent « used 100/100 » en vert ;
- la page Autres, qui prétend porter la part nue, ne le voit pas.

Seules la page Positions d'ensemble et la barre de titre disent la vérité.

---

## 3. `packages/coverage` — le resplit

`strategyPositions(rows, strategy, snapshot)` reçoit déjà **toutes** les lignes de journal, pas
seulement celles de la stratégie demandée. Elle peut donc calculer le partage complet, quelle
que soit la page qui l'appelle, sans nouvelle entrée ni nouveau paramètre.

### 3.1 Le partage, contrat par contrat

Pour chaque contrat `c` que le snapshot détient, avec `p` sa position analysée
(`AnalyzedPosition`), et en ne considérant que les lignes de journal **ouvertes** dont le
`kind` est `short_call` ou `short_put` — une position longue ne migre jamais :

- `n_s` = somme des `|quantity|` des lignes de la stratégie `s` sur `c` ;
- `propre_s` = somme des `p.allocations[].quantity` dont la source est dans
  `STRATEGY_COVER_SOURCES[s]` ;
- `couvert_s = min(n_s, propre_s)` et `nu_s = n_s − couvert_s`. Le `min` est nécessaire : les
  allocations portent sur la position IB entière, qui peut dépasser la part de la stratégie ;
- `n_autres` = quantité ouverte d'Autres sur `c`, nue par construction — c'est ce que
  `splitShortCall` y a mis à la vente ;
- **plafond** : `migrable = max(0, p.uncoveredQuantity − n_autres)` ;
- on sert dans l'ordre des pages — `wheel`, puis `leaps`, puis `condors` — :
  `pris_s = min(nu_s, migrable)`, puis `migrable −= pris_s`.

Le plafond est ce qui empêche de déclarer nu ce que le moteur dit couvert : la page Autres ne
peut donc pas contredire la barre de titre. Il mord quand le journal dépasse le snapshot
(historique plus long que la position IB) ou quand la couverture d'une ligne vient d'une source
qui n'est pas la sienne — voir §7.

Un contrat que le snapshot ne détient pas, ou l'absence de snapshot, ne produit aucun partage :
`pris_s = 0` partout, et les pages restent ce qu'elles sont aujourd'hui.

**En pratique, seuls des calls migrent.** `secureShortPuts` (`packages/coverage/src/coverage.ts`)
alloue `cash` à tout put vendu, sans jamais regarder le cash disponible : un manque de cash est
un problème global du rapport (`report.ts`, `cashRequired > cashAvailable`), pas un
`uncoveredQuantity` de contrat. La règle reste écrite sur les ventes d'options en général — elle
ne coûte rien de plus et suivra le moteur s'il change un jour —, mais un put ne peut pas migrer
tant que le moteur sécurise ainsi, et un test le cloue (§5).

### 3.2 Les lignes des stratégies couvertes

La ligne de `s` sur `c` porte la quantité **couverte** : `−(n_s − pris_s)`, le signe des ventes
étant négatif. Une ligne dont tout a migré (`pris_s = n_s`) ne se rend pas du tout.

- `avgPrice` ne change pas : c'est la moyenne pondérée des `openPrice` des lignes de journal du
  groupe, et réduire la quantité affichée ne déplace pas cette moyenne ;
- `marketValue` et `unrealizedPnl` se calculent sur la quantité réduite ;
- `decision` ne change pas : elle ne dépend que des prix ;
- `position` reste la position IB entière, comme aujourd'hui : la colonne Position dit ce qu'IB
  détient, pas ce que la stratégie en tient ;
- `coverage` se **plafonne** à la quantité affichée : on parcourt les allocations des sources de
  `s` dans leur ordre et on retient `min(capacité restante, allocation.quantity)`, la capacité
  partant de `|quantity|`. Sans ce plafond, une ligne affichée `−1` pourrait imprimer `stock ×2`.

### 3.3 La page Autres

Les contrats nus venus d'ailleurs rejoignent l'encadré « Ventes d'options » existant, **fondus
par contrat** avec ce qu'Autres en détient déjà : une seule ligne, jamais deux, et aucun badge
d'origine. La page dit « voici ce qui est nu », pas « voici ce que la Wheel a raté ».

La ligne se construit sur des contributions pondérées, `{ quantity, openPrice }` :

- les lignes de journal d'Autres sur `c`, telles quelles ;
- pour chaque `s` avec `pris_s > 0`, une contribution `{ quantity: −pris_s, openPrice: avgPrice_s }`,
  où `avgPrice_s` est la moyenne de la ligne de `s` définie au §3.2.

Un contrat dont Autres ne détient rien en propre produit quand même sa ligne : contrat, `kind`
et libellé se lisent alors sur les lignes de journal migrées, qui nomment le même contrat. Le
`kind` étant `short_call` ou `short_put`, `DETAIL_GROUPS` la classe d'elle-même dans « Ventes
d'options ».

`quantity` est la somme des contributions, `avgPrice` leur moyenne pondérée par les `|quantity|`,
`null` dès qu'une contribution n'a pas de prix — la règle d'aujourd'hui, appliquée à une liste
plus longue. `marketValue`, `unrealizedPnl` et `decision` suivent les formules existantes.

Le badge reste `UNCOVERED ×|quantité|`, lu sur la ligne elle-même
(`strategyCoverageBadges`, branche `others`) : aucune clé i18n nouvelle, et l'affirmation que
`apps/web/src/lib/riskReport.ts` porte déjà — « ce qui est filé là est précisément ce que rien ne
couvre » — devient vraie de bout en bout.

### 3.4 La carte « Actions assignées » de la Wheel

Ses calls deviennent les calls **couverts**. `wheelHoldings` reste pur journal dans
`@ib/ledger` — il n'a qu'un appelant — et `strategyPositions` recalcule trois de ses champs à
partir des lignes Wheel `short_call` d'après resplit, groupées par ticker et devise :

- `openCallContracts` = somme des `|quantity|` de ces lignes ;
- `averageCallStrike` = `Σ strike × |quantity| ÷ Σ |quantity|`, `null` si la somme est nulle ou
  si un strike manque ;
- `coveredShares = min(quantity, openCallContracts × DEFAULT_MULTIPLIER)` ;
- `callStrikeBelowAssignment` se recalcule sur le nouveau `averageCallStrike`.

« used 100/100 » redevient vrai, et le strike moyen ne moyenne plus un contrat que la page
n'affiche pas.

### 3.5 Ce qui ne change pas

`strategyPositions` garde sa signature et son type de retour. `linesByGroup`, `compareLines`,
`flatten` — un condor se lit toujours sur ses jambes — et la règle « les actions de la Wheel
restent dans leur table propre, `groups.long` vide » sont inchangés.

---

## 4. `apps/web`

Aucun changement de page, d'encadré, de colonne ni de traduction : `STRATEGY_BOXES`,
`POSITION_COLUMNS`, `WHEEL_SHARE_COLUMNS`, `strategyColumnSpecs`, le tri, les filtres et la
recherche lisent les mêmes lignes, dont seules les quantités changent.

Le plafonnement des badges du §3.2 se fait dans `strategy.ts`, sur `line.coverage`, et non dans
`allocationBadges` : le filtre par couverture lit `strategyCoverageValues`, qui lit la même
liste, et les deux restent d'accord sans que `apps/web` ait à connaître la règle.

**Conséquence à assumer** : pour un contrat partiellement nu, la quantité d'une ligne de la page
Positions Wheel ne vaut plus celle du Journal Wheel (`−1` contre `−2`). Le Journal est le
registre des lots ; la page Positions dit ce que la stratégie couvre aujourd'hui.

---

## 5. Tests

`packages/coverage/src/strategy.test.ts`, écrits à la main comme tout ce paquet :

- 200 actions Wheel, 2 calls Wheel, puis 100 actions vendues : la page Wheel montre 1 call avec
  `stock ×1`, la page Autres 1 call avec `UNCOVERED ×1`, la carte des actions « used 100/100 » ;
- **un put Wheel ne migre jamais** : le moteur lui alloue toujours `cash`, donc son
  `uncoveredQuantity` est nul et la page Autres n'en voit rien — le test échoue si le moteur
  cesse de sécuriser ainsi ;
- **le plafond** : `uncoveredQuantity` à 0 alors que la stratégie ne reconnaît aucune de ses
  sources — rien ne migre ;
- **le plafond partiel** : journal plus long que la position IB, seule la part que le moteur dit
  nue migre, et elle part de la Wheel avant les LEAPS ;
- **fusion sur Autres** : Autres détient déjà une part du contrat, la ligne reste unique et son
  `avgPrice` est la moyenne pondérée des deux origines ; `null` si l'une n'a pas de prix ;
- **ligne entièrement migrée** : elle disparaît de la page de la stratégie ;
- **sans snapshot** et **contrat hors snapshot** : aucune migration, sortie identique à
  aujourd'hui ;
- **badges plafonnés** : `Σ quantités des badges ≤ |quantity|` de la ligne ;
- une position longue ne migre jamais.

`apps/web/src/pages/StrategyPositionsPage.test.tsx`, sur un ledger semé en `fake-indexeddb` :

- le scénario complet de bout en bout, vu sur les deux pages : Positions Wheel montre 1 call,
  Positions Autres en montre 1 ;
- la carte « Actions assignées » affiche « used 100/100 » et le strike moyen du seul call
  couvert.

`pnpm check` une seule fois à la fin.

---

## 6. Documentation

- `CLAUDE.md` : la puce sur `strategyPositions` gagne la règle du resplit et la conséquence du
  §4 ; la ligne 22 s'ajoute au tableau des sous-projets ;
- `docs/points-reportes.md` : la dernière puce du sous-projet 21 et la puce « badge used » du
  sous-projet 16 se ferment, et la dette du §7 s'ouvre.

---

## 7. Dette assumée

**Un call Wheel réellement couvert par un LEAPS long** garde une cellule de couverture vide sur
la page Wheel : sa couverture vient de `leaps`, qui n'est pas une source de la Wheel. Le plafond
l'empêche de migrer à tort vers Autres — rien n'est faux, seulement muet. C'est déjà le
comportement d'aujourd'hui ; l'élargir demanderait de décider ce qu'une page de stratégie dit
d'une couverture qui ne lui appartient pas, ce qui dépasse ce sous-projet.

---

## 8. Décisions écartées

| Écarté | Raison |
|---|---|
| Reclasser le lot dans le journal quand sa couverture s'en va | Le reclassement rétroactif, écarté aux sous-projets 5 et 9. La couverture va et vient — actions revendues puis rachetées — et chaque aller-retour créerait une ligne de journal de plus ; la prime devrait de surcroît choisir un camp, faisant baisser rétroactivement le P/L réalisé de la stratégie d'origine |
| Attribuer la part nue à une stratégie | Une position nue n'appartient à aucune stratégie : c'est une erreur, et peu importe d'où elle vient. C'est ce qui supprime toute règle d'attribution arbitraire |
| Un encadré « Part nue d'autres stratégies » sur la page Autres | Même raison : nommer l'origine, c'est attribuer le nu |
| Un badge d'origine sur la ligne fondue | Même raison |
| Calculer le nu depuis le seul journal | Le journal ne connaît que la couverture qu'il a lui-même classée : il ignore ce que le moteur apparie réellement sur le snapshot, et ne saurait pas qu'un call Wheel sans actions est en fait couvert par un LEAPS long. Le moteur de couverture est la seule source qui sait ce qui est nu, et la seule que la barre de titre lise |
| Montrer `UNCOVERED` sur les pages de stratégie | La page de la stratégie ne montre que ce qu'elle couvre ; ce qui est nu se lit sur Autres et sur la vue d'ensemble |
