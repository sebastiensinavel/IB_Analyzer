# Sous-projet 17 — La Wheel ne prend que ce qu'il faut

Statut : implémenté (2026-09-16).

Le sous-projet 8 fait entrer dans la Wheel les actions qu'un call couvert couvre. Sur le compte
réel `alpha`, la page Positions → Wheel montre 505 ZXAP là où l'utilisateur en attend 500, et
75 ZXAF là où il n'en attend aucune. Dans les deux cas, un reliquat d'actions achetées au marché
entre dans la Wheel ou y reste, alors qu'aucun call n'en avait besoin.

---

## 1. Périmètre

**Critère de réussite, choisi au brainstorming :** relevés seuls, alpha montre 500 ZXAP et
aucune ZXAF dans la Wheel, et 5 ZXAP et 75 ZXAF dans Autres. L'oracle beta ne bouge pas.

Dans le périmètre, trois changements du moteur de journaux (`packages/ledger/src/journals/`) :

1. un call couvert couvre d'abord les actions déjà dans la Wheel et ne reprend d'une autre
   stratégie que ce qui manque (§3) ;
2. quand un call couvert de la Wheel fait sortir des actions — vente au même instant que son
   rachat, ou livraison à son assignation —, ce sont d'abord des actions de la Wheel qui
   sortent (§4) ;
3. une opération sur titres ne réordonne plus les lots nés d'une reprise (§5).

Hors périmètre : les calls couverts par des LEAPS, le classement d'un call entre Wheel, LEAPS et
Autres (`splitShortCall` ne change pas), l'affichage.

---

## 2. Ce que disent les données

Mesuré le 2026-09-16 en rejouant les relevés annuels de alpha dans une sonde jetable, puis en
rejouant de même avec la seule règle du §3 appliquée en code. Les résultats des §4 et §5 sont
calculés à la main et restent à vérifier.

### 2.1 ZXAP : 505 au lieu de 500

| Date | Opération | Carnet après, dans l'ordre |
|---|---|---|
| 2023-12-14 | achat de 140 au marché, 35 revendues en 2024 | 105 Autres |
| 2025-02-11 | achat de 100 au marché | 105 Autres, 100 Autres |
| 2025-03-21 | assignation de 200 | … , 200 Wheel |
| 2025-06-25 | vente isolée de 200, dans l'ordre du carnet | 5 Autres, 200 Wheel |
| 2025-08 | trois assignations : 300, 200, 100 | 5 Autres, 800 Wheel |
| 2025-09-18 | vente de 6 calls couverts | **les 5 Autres sont reprises** (0,05 contrat) |
| 2025-10-01 | rachat des 6 calls et vente de 600 au même instant | 205 Wheel |
| 2025-11-21 | assignation de 300 | **505 Wheel** |

Aujourd'hui, `takeOverShares` parcourt le carnet dans l'ordre et tombe d'abord sur le reliquat
de 5 actions, alors que la Wheel en détient 800 pour couvrir 6 calls.

Avec la seule règle du §3, mesurée en code : les 5 actions ne sont plus reprises, mais la vente
du 2025-10-01 les vend en premier, parce qu'elles sont les plus anciennes. La Wheel garde
encore 505 actions. D'où la règle du §4.

### 2.2 ZXAF : 75 au lieu de 0

| Date | Opération | Carnet après, dans l'ordre |
|---|---|---|
| 2023 | achats de ZXAG : 475, puis 500 | 475 Autres, 500 Autres |
| 2026-03-04 | vente de 9 calls couverts | 475 Wheel, 425 Wheel, 75 Autres |
| 2026-04-03 | fusion ZXAG → ZXAF, 1 pour 1 | **75 Autres, 475 Wheel, 425 Wheel** |
| 2026-04-14 | vente de 9 calls couverts | **les 75 Autres sont reprises** |
| 2026-05-06 | rachat des calls et vente de 900 au même instant | **75 Wheel** |

La fusion passe par `LotBook.move`, qui range les lots par `openWhen`. La part reprise porte
la date de la vente du call, le reliquat celle de l'achat : le reliquat repasse devant. Cette
dette est notée depuis le sous-projet 8 (§5 ici). Ensuite, la vente de 9 calls le 2026-04-14
reprend ce reliquat, alors que la Wheel détient 900 actions (§3). Enfin, la vente du
2026-05-06 part des plus anciennes (§4).

---

## 3. Un call couvre d'abord la Wheel

Remplace le §4 du spec du sous-projet 8.

À la vente d'un call attribué à la Wheel avec `cover: "shares"`, pour `n` contrats :

1. **part libre de la Wheel** = actions ouvertes des lots Wheel du sous-jacent, en contrats
   (`sharesPerContract` par lot), moins les contrats de calls couverts encore ouverts
   (`alreadyCovered`, lu avant l'ouverture du lot du call), jamais sous zéro ;
2. **manque** = `n` moins la part libre ; s'il est nul ou négatif, rien n'est repris ;
3. le manque est pris en parcourant **les seuls lots hors Wheel**, dans l'ordre du carnet. Une
   portion prise est coupée au strike exactement comme au §5 du spec du sous-projet 8 : ligne
   `integrated` dans la stratégie d'origine, lot W au rang du lot coupé, reliquat T juste
   après.

Une portion se mesure toujours en actions : avec 134 actions achetées au marché et un call
vendu, 100 actions entrent dans la Wheel et 34 restent dans Autres.

Le saut positionnel du sous-projet 8 disparaît : la Wheel ne se parcourt plus, elle se compte.
Un call suivant qui retombe sur des actions déjà reprises ne reprend rien, comme avant.

`SHARE_EPSILON` garde son rôle : un manque ou un reliquat inférieur est du bruit flottant.

---

## 4. Les actions sortent d'abord de la Wheel quand un call Wheel les fait sortir

`LotBook` gagne une clôture qui sert d'abord les lots d'une stratégie donnée, dans l'ordre du
carnet et dans la limite d'un nombre de contrats (converti par lot avec `sharesPerContract`),
puis clôt le reste dans l'ordre habituel du carnet. `close` ne change pas.

`sharesPerContract` quitte `takeover.ts` pour `book.ts`, que `takeover.ts` importe déjà :
l'inverse ferait un cycle.

### 4.1 Vente d'actions au même instant que le rachat

Dans `replayGroup`, les options d'un instant sont traitées avant ses actions. Pendant la
boucle des options, on compte, par contrat actions du sous-jacent, les contrats de lots de
calls `strategy: "wheel"`, `cover: "shares"` fermés par un rachat (`buyback`) à cet instant.

Dans la boucle des actions, une vente (quantité négative, qui ferme des lots longs) de ce
sous-jacent puise d'abord dans les lots Wheel, dans la limite de ce compte, qui s'épuise d'une
vente à l'autre du même instant. Ce qui dépasse suit l'ordre du carnet. Une vente sans rachat
de call Wheel au même instant ne change pas.

« Même instant » est celui du rejeu : `groupByWhen`, après la fusion des tranches d'un même
ordre (`mergeFills`).

Exemple : racheter 6 calls Wheel et vendre 800 actions au même instant fait sortir 600 actions
de la Wheel en priorité, puis 200 dans l'ordre du carnet.

### 4.2 Livraison à l'assignation

Dans `deliverShares`, quand le lot assigné est un call `strategy: "wheel"`, `cover: "shares"`,
la livraison puise d'abord dans les lots Wheel, dans la limite des contrats assignés. Toute
autre livraison ne change pas.

Ce cas découle du §3 : la part reprise n'est plus forcément en tête du carnet, puisque les
actions déjà dans la Wheel couvrent le call sans être déplacées. Sans cette règle, ZXAP aurait
livré les 5 actions d'Autres à une assignation de ses 6 calls.

---

## 5. Une opération sur titres ne réordonne plus une coupe

`Lot` gagne `rankWhen: string`, la date qui fixe son rang dans l'ordre d'achat :

- un lot ordinaire prend `rankWhen = openWhen` (`newLot`, valeur par défaut) ;
- la part reprise W et le reliquat T d'une coupe héritent du `rankWhen` du lot coupé ;
- le lot neuf d'une fusion avec cash garde `rankWhen = openWhen` : il a une base neuve et
  une date neuve (commentaire existant de `applyMixedMerger`).

`LotBook.insertByOpenWhen` devient `insertByRank` et compare `rankWhen`. Les égalités vont
après leurs égales, dans l'ordre d'arrivée : `move` déplace les lots dans l'ordre de la liste,
donc W reste devant T.

`openWhen`, qui devient `startWhen` des lignes, ne change pas : le journal date toujours la
part reprise du jour de la reprise.

---

## 6. Ce que ça déplace ailleurs

- **Oracle des journaux** (`packages/ib-parsers/src/journals.oracle.test.ts`) : zéro écart et
  distribution par stratégie inchangée. Les règles ne changent que la stratégie des lots
  d'actions, et le corpus beta n'avait aucune ligne en Autres au sous-projet 8. Le §4 peut
  cependant changer quel lot sort entre un lot Wheel et un lot LEAPS livré par exercice.
  **À vérifier en premier** : si la distribution bouge, comprendre quel cas avant de toucher à
  la constante.
- **Statistiques et capital** : aucun code ne change. Ils lisent les lignes, dont la
  répartition entre Wheel et Autres change sur les comptes concernés.
- **`CLAUDE.md`** : la règle « Un call vendu sur des actions détenues est un call couvert »
  dit que seul le manque est repris, et qu'un call Wheel fait sortir d'abord des actions
  Wheel ; la table des sous-projets gagne la ligne 17.
- **`docs/points-reportes.md`** : sortent le saut positionnel et le retri par
  `insertByOpenWhen` (sous-projet 8) ; entrent les points du §8.

---

## 7. Tests

`packages/ledger`, en TDD. Chaque cas doit échouer si le comportement change.

`takeover.test.ts` et `replay.test.ts` :

- 800 actions Wheel et 5 actions Autres plus anciennes, 6 calls vendus : aucune ligne
  `integrated`, les 5 actions restent dans Autres ;
- 50 actions Wheel libres et 134 actions Autres, 1 call vendu : 50 actions reprises ;
- 134 actions Autres, 1 call vendu : 100 reprises, 34 restent ;
- un call couvert encore ouvert immobilise sa part : 100 actions Wheel sous un call ouvert,
  134 Autres, 1 nouveau call → 100 actions reprises ;
- rachat de 6 calls Wheel et vente de 600 au même instant, 5 actions Autres en tête du carnet :
  les 600 sortent de la Wheel, les 5 restent ;
- même cas avec une vente de 800 : 600 sortent de la Wheel, 200 dans l'ordre du carnet ;
- vente isolée, sans rachat au même instant : ordre du carnet inchangé ;
- rachat d'un call **LEAPS** et vente au même instant : ordre du carnet inchangé ;
- assignation d'un call Wheel avec un lot Autres en tête : la livraison sort de la Wheel ;
- rejeu de la chronologie ZXAP du §2.1, en transactions synthétiques : 500 Wheel, 5 Autres.

`book.test.ts` et `replay.test.ts` :

- une coupe W + T puis une conversion 1 pour 1 : W reste devant T dans le carnet converti ;
- rejeu de la chronologie ZXAF du §2.2, en transactions synthétiques : 0 Wheel, 75 Autres.

`apps/web/src/db/alpha.private.test.ts`, qui n'écrit ni ticker ni montant : aucune ligne
`integrated` n'est datée d'un instant où la Wheel détenait déjà, sur ce sous-jacent, assez
d'actions libres pour couvrir le call. Les chiffres ZXAP et ZXAF du §1 sont vérifiés par une
sonde jetable et rapportés à l'utilisateur, jamais committés.

`packages/ib-parsers` : l'oracle beta reste à zéro écart, distribution inchangée.

---

## 8. Points reportés prévus

- **« Même instant » est strict.** Un rachat de call et une vente d'actions passés en deux
  ordres séparés d'une seconde ne sont pas liés, et la vente reste dans l'ordre du carnet.
  Aucun cas réel observé : alpha les passe à la même seconde.
- **Une vente d'actions Wheel sans rachat de call** reste dans l'ordre du carnet et peut vendre
  un reliquat Autres plus ancien. Voulu : rien ne dit que la vente appartient à la Wheel.
- **Une livraison ne choisit toujours pas nominativement les lots Wheel qui couvrent le call** :
  entre deux lots Wheel repris à des strikes différents, l'ordre du carnet décide. Le P/L reste
  dans la Wheel, seule sa répartition entre lignes peut s'intervertir.

---

## 9. Décisions écartées

- **Toute vente d'actions puise d'abord dans la Wheel.** Écarté : sur ZXAP, la vente isolée de
  2025-06-25 viderait les 200 actions assignées au lieu des actions achetées au marché, et la
  Wheel finirait à 300 au lieu de 500.
- **Toute la vente puise dans la Wheel dès qu'un call Wheel est racheté au même instant.**
  Écarté par l'utilisateur au profit d'une limite égale aux contrats rachetés.
- **Ne corriger que la reprise (§3).** Écarté après mesure : ZXAP reste à 505 et ZXAF à 75.
- **Laisser le retri par `openWhen` en dette.** Écarté : avec les §3 et §4 ZXAF tombe juste,
  mais une vente ordinaire après une opération sur titres vendrait encore les mauvaises
  actions.
- **Dater la part reprise de l'achat d'origine** pour que `openWhen` suffise au tri. Écarté :
  le journal date la reprise du jour du call (spec du sous-projet 8, §5), et cette colonne se
  lit.
