# Sous-projet 8 — Le journal Wheel prend les actions qu'il couvre

Statut : implémenté (2026-09-09).

Vendre un call sur des actions qu'on détient déjà, c'est faire de la wheel. Le moteur ne le
voit pas : il ne reconnaît comme couverture que des actions **assignées**, si bien qu'un call
vendu sur des actions achetées au marché tombe en « others » comme un call nu, et que la
revente de ces actions n'apparaît nulle part dans la stratégie. Ce sous-projet fait entrer
ces actions dans la wheel au moment où un call est vendu sur elles, et les y fait entrer **au
strike de ce call**, pour que la plus-value d'avant-wheel ne vienne pas gonfler la stratégie.

---

## 1. Périmètre

Dans le périmètre :

- la capacité de couverture Wheel compte tous les lots d'actions longs, plus seulement les
  lots assignés ;
- les actions que le call couvre entrent dans la wheel, reprises au strike, et l'écart avec
  leur prix d'achat réel est réalisé dans la stratégie qui détenait les actions — « others »
  dans le cas courant des actions achetées au marché ;
- une colonne « commentaire » dans les journaux, alimentée par un champ structuré et traduite
  côté application ;
- `DEFAULT_MULTIPLIER` descend dans `@ib/ledger`, ré-exporté par `@ib/coverage`.

Hors périmètre, déclaré tel :

- **le journal reste un journal de lots**, une ligne par lot et par sortie (§3.6 du spec du
  sous-projet 5). Une sortie ne crée pas de ligne datée du jour de la sortie ;
- **le reclassement rétroactif** : un call vendu à nu reste nu même si des actions sont
  achetées le lendemain. La classification se fait une fois, à la vente ;
- **les actions courtes** ne couvrent rien et ne sont pas concernées ;
- **`packages/coverage`**, le serveur, l'agent, le déploiement : rien n'y touche.

---

## 2. Ce que disent les données

Sur l'historique complet d'un compte réel (quatre relevés annuels, 1 357 lignes de journal),
**90 lignes `short_call` tombent en « others »** : ZXAV, ZXAU, ZXAF, ZXAM, ZXAW, ZXAX, ZQ,
ZXAY, ZXAZ, MQZA, ZXAT… Presque toutes sont des calls vendus sur des actions achetées au
marché, souvent des années plus tôt. Ce ne sont pas des calls nus, c'est de la wheel que le
moteur ne sait pas nommer.

Le même relevé dit pourquoi la reprise au strike n'est pas une coquetterie : ZXAU acheté à
1,615 en décembre 2023, appelé par des calls de strike 17 et 18 deux ans plus tard. Reprendre
ces actions à leur coût réel ferait entrer une dizaine de milliers de dollars de plus-value
d'avant-wheel dans la stratégie, et la statistique mensuelle du journal Wheel cesserait de
mesurer ce qu'elle prétend mesurer.

Le cas symétrique existe aussi : ZQ acheté à 2,96, calls de strike 2,50. Le strike est alors
*sous* le prix d'achat, et c'est une moins-value que la wheel n'a pas à porter.

---

## 3. Ce qui rend un call couvert

`StrategyState.wheelCapacity` (`journals/classify.ts`) ne compte aujourd'hui que les lots
`kind === "shares"` dont `assigned` est vrai. Elle comptera **tous les lots d'actions longs**
du sous-jacent, en contrats entiers, moins les calls déjà couverts encore ouverts :

```
capacité = max(0, floor(Σ remaining / ratio) − Σ |remaining| des short_call de cover "shares")
```

où `ratio` reste celui observé sur la livraison quand le lot vient d'une assignation, et vaut
`DEFAULT_MULTIPLIER` quand le lot vient d'un achat, qui n'a pas de ratio à observer.

`splitShortCall` et la règle 5 du §3.4 ne bougent pas. `averageAssignmentPrice`, qui arbitre
« wheel d'abord » contre « LEAPS d'abord » quand un même call pourrait couvrir les deux,
devient `averageSharePrice` sur ces mêmes lots, à leur base courante — le strike pour un lot
déjà repris, le prix d'achat pour un lot qui ne l'est pas encore.

### Le multiplicateur

Convertir des contrats en actions demande un multiplicateur, et `Transaction` n'en porte pas :
un lot acheté n'a pas de livraison où le lire. `DEFAULT_MULTIPLIER` vit dans
`packages/coverage`, qui dépend de `packages/ledger` ; l'importer depuis `ledger` ferait un
cycle. La constante **descend donc dans `@ib/ledger`**, et `packages/coverage/src/constants.ts`
la ré-exporte. Elle reste définie une seule fois, le garde-fou `businessConstants.test.ts`
d'`apps/web` reste vrai tel quel, et la règle correspondante de `CLAUDE.md` est à réécrire.

---

## 4. Quelles actions entrent, et combien

À la vente d'un call attribué à la wheel avec `cover: "shares"`, on parcourt les lots
d'actions longs du sous-jacent **dans l'ordre du carnet**, en équivalents-contrats :

1. on **saute** ce qui est déjà engagé derrière les autres calls couverts encore ouverts —
   exactement le terme retranché par `wheelCapacity`, lu avant que le lot du call ne soit
   ouvert ;
2. on **prend** ensuite le nombre de contrats attribués à la wheel ;
3. toute portion prise qui est déjà dans la wheel est consommée sans rien changer ; toute
   portion prise qui ne l'est pas y entre.

Ce saut est ce qui rend l'opération stable dans le temps :

- deux calls vendus l'un après l'autre n'intègrent pas deux fois le même lot ;
- un call racheté libère ses actions sans les faire ressortir de la wheel — elles y sont
  entrées, elles y restent — et le call suivant retombe dessus sans rien reprendre une
  seconde fois ;
- quatre calls vendus quand deux lots de 100 sont déjà repris n'intègrent que les 200 actions
  suivantes, au strike du nouveau call.

Une portion prise se mesure en actions, pas en contrats : un lot de 226,49 actions n'est pas
un nombre entier de contrats, et la capacité, elle, est arrondie à l'entier inférieur.

---

## 5. La reprise au strike

Le lot atteint est **coupé sur place**. La coupe garde le rang du lot dans le carnet, et ce
rang est le point dur : si la part reprise se retrouvait en fin de liste, une assignation du
call vendrait FIFO les actions restées dans la stratégie d'origine du lot, le cycle wheel ne
se refermerait jamais et la plus-value tomberait dans la mauvaise stratégie.

Le lot d'origine `S` (quantité ouverte `q0`, restant `r`, montant `A`, commission `C`), dont
on reprend `n ≤ r` actions au strike `k`, devient trois choses :

| | quoi | où |
|---|---|---|
| `S` | clôturé pour `n` actions : ligne dans la stratégie d'origine du lot — « others » dans le cas courant des actions achetées au marché —, événement `integrated`, datée de la vente du call, `closePrice` = `k`, `closeTotal` = `+k × n`, sans commission, `closeIds` = les identifiants du call, `remaining` mis à 0 | reste à sa place, comme tout lot clos |
| `W` | nouveau lot wheel : `openWhen` = l'instant de la vente du call, `openPrice` = `k`, `openAmount` = `−k × n`, commission nulle, `assigned` faux, `ratio` = le multiplicateur retenu | inséré juste après `S` |
| `T` | le reste non repris, si `n < r` : même `openWhen`, même `openPrice`, même stratégie que `S`, `openAmount` = `A × (r−n) / q0`, commission au prorata | inséré juste après `W` |

`S` n'est pas réécrit : sa quantité et son montant restent ceux du lot d'origine, si bien que
le prorata des lignes déjà émises et de celle-ci reste juste, et que la somme des parts —
celles déjà closes, `n`, et `r − n` — fait exactement `A`.

Les deux lignes se compensent au centime : `−k × n` d'un côté, `+k × n` de l'autre. Aucune
monnaie n'est inventée, et la somme des P/L des quatre journaux reste égale au P/L réel du
compte. La ligne clôturée dans sa stratégie d'origine — « others » dans le cas courant —
réalise la plus- ou moins-value d'avant-wheel, à la date où les actions ont changé de
stratégie ; la wheel part de zéro au strike.

`assigned` reste faux sur `W` : ces actions n'ont pas été livrées par une option, et la
colonne le dit.

`CloseEvent` gagne la valeur `integrated`, la première qui ne vient d'aucune transaction :
elle nomme le moment où une stratégie passe la main à une autre.

---

## 6. La colonne commentaire

`JournalRow` gagne un champ `note`, structuré, jamais du texte :

```ts
export type RowNoteCode = "takenOverAtStrike" | "handedToWheel" | "nakedCall" | "truncatedHistory";
export interface RowNote {
  code: RowNoteCode;
  /** Libellé du contrat en cause, déjà neutre : `formatContractLabel` écrit en anglais dans les deux langues. */
  contract?: string;
}
```

`packages/ledger` n'émet **aucun texte visible**. La partie fixe de la phrase vit dans
`apps/web/src/i18n/{fr,en}.json` sous `journal.notes.*`, la partie variable s'y interpole, et
la page rend `t(\`journal.notes.${row.note.code}\`, { contract: row.note.contract })`, cellule
vide quand `note` vaut `null`.

| Ligne | Code | Français |
|---|---|---|
| actions reprises, côté wheel | `takenOverAtStrike` | Actions déjà détenues, reprises au strike du call {{contract}} |
| actions cédées, côté stratégie d'origine | `handedToWheel` | Reprises par la stratégie Wheel au strike du call {{contract}} |
| `short_call` en others | `nakedCall` | Call nu : ni actions ni LEAPS pour le couvrir |
| ligne orpheline | `truncatedHistory` | Historique tronqué : aucun lot à clôturer |

Les deux premiers codes viennent du moteur, seul à connaître le call déclencheur : `Lot` et
`Exit` gagnent chacun un `note`, `W` porte le sien sur le lot et la ligne clôturée dans la
stratégie d'origine porte le sien sur la sortie. `buildRow` prend celui de la sortie, sinon
celui du lot, sinon déduit les deux autres codes de la ligne elle-même — un `short_call` sans
couverture, un lot orphelin —, sans état supplémentaire.

La colonne se place en fin de tableau, après « En cours » : c'est la seule cellule de texte
long, et le tableau défile déjà horizontalement.

Cette colonne nomme la reprise et le caractère nu d'un call par un champ dédié (`JournalRow.note`),
sans pour autant afficher les `CloseEvent` : `row.event` reste sans consommateur dans
`apps/web`, et le point reporté du sous-projet 7 — « `CloseEvent` n'est affiché nulle part
dans l'application » — reste ouvert.

---

## 7. Ce que ça déplace ailleurs

- **Statistiques** (`journals/stats.ts`). `contributions` exige aujourd'hui `row.assigned`
  pour compter une ligne d'actions ; la garde saute. Seules les stratégies wheel, LEAPS et
  condors sont sommées, et elles ne détiennent d'actions que par livraison ou par reprise :
  la garde ne protégeait rien et empêcherait les actions reprises de compter. Une ligne
  d'actions contribue à sa sortie, pour son P/L entier, dans le mois de la sortie.
- **Teinte du libellé** (`apps/web/src/lib/journalTone.ts`). Une ligne d'actions en cours
  prend la teinte « actions » si elle est assignée **ou** si sa stratégie est la wheel : une
  reprise est une position wheel ouverte comme une autre.
- **Oracle des journaux** (`packages/ib-parsers/src/journals.oracle.test.ts`). Le corpus
  beta n'a aujourd'hui **aucune** ligne en « others » : il ne contient donc aucun lot
  d'actions non assigné, et la distribution `{ wheel: 78, leaps: 55, condors: 4 }` doit
  rester intacte. **C'est la première chose à vérifier**, avant d'écrire quoi que ce soit
  d'autre : si elle bouge, c'est que le corpus contient un cas que cette analyse a manqué,
  et il faut comprendre lequel avant de toucher à la constante. L'oracle ne vieillit pas
  tout seul.
- **`LotBook`** (`journals/book.ts`) gagne une insertion à un rang donné (« juste après ce
  lot »), voisine de `insertByOpenWhen` que les opérations sur titres utilisent déjà.

---

## 8. Tests

`packages/ledger` — chaque cas doit échouer si le comportement change :

- call vendu sur des actions achetées : le call passe en wheel, les actions couvertes sont
  reprises au strike, l'écart est réalisé en « others », les deux montants se compensent ;
- revente de ces actions : le P/L wheel vaut `(prix de vente − strike) × quantité`, jamais
  davantage ;
- assignation du call : ce sont bien les actions reprises qui sont livrées, pas le reste du
  lot ;
- call vendu sur des actions déjà assignées : rien n'est repris, rien ne change ;
- deux calls successifs sur le même lot : la seconde vente n'intègre que les actions
  suivantes, au strike du second call ;
- call racheté puis revendu : aucune seconde reprise ;
- couverture partielle d'un lot : la coupe laisse le reste en « others », au prorata exact ;
- strike sous le prix d'achat : la moins-value part en « others », la wheel démarre au strike ;
- lot fractionnaire : la capacité arrondit, la coupe ne perd pas d'action.

`apps/web` : la colonne commentaire rend la phrase traduite avec le libellé du contrat
interpolé, et une cellule vide quand la ligne n'a pas de note.

`packages/ib-parsers` : l'oracle beta reste à zéro écart.

---

## 9. Points reportés

`docs/points-reportes.md` porte la liste vivante et fait foi ; ce qui suit est ce qui était
prévu au moment de la conception, pas nécessairement ce que l'implémentation a fini par
trouver.

- **Une livraison ne choisit pas explicitement les actions qui couvrent le call** : elle
  reste FIFO et tombe juste parce que la coupe place la part reprise au bon rang. Deux calls
  couverts par deux lots repris à des strikes différents peuvent voir leurs actions
  interverties ; le P/L reste dans la wheel, sa répartition entre les deux lignes non. Et le
  saut qui évite de reprendre deux fois le même lot est positionnel, pas nominatif : si un
  lot repris est vendu pendant que son call est encore ouvert, ce saut mange un lot sans
  rapport.
- **`insertByOpenWhen` compare des `openWhen` qui ne suivent plus l'ordre de la liste** après
  une coupe, le lot converti par une opération sur titres portant l'`openWhen` ancien du lot
  d'origine. Sur une liste que la coupe a désordonnée, le premier lot ouvert postérieur est la
  part reprise elle-même, en tête : le lot converti s'insère donc devant elle, et
  l'assignation qui suit livre le mauvais lot — le cycle wheel ne se referme pas.
- **Un call vendu à nu ne se reclasse pas** si des actions sont achetées ensuite.
- **La colonne commentaire ne couvre pas tous les événements** : `corporate_action`,
  `expired`, `exercised` n'ont toujours pas de libellé.

---

## 10. Décisions écartées

- **Faire du journal un journal d'événements**, une ligne par sortie à sa date. Écarté : la
  revente était déjà comptée et déjà présente, sous la date d'ouverture de son lot ; le grief
  était de lecture, et la refonte toucherait les quatre journaux, les statistiques et le
  §3.6 du spec du sous-projet 5 pour un gain de mise en page.
- **Laisser disparaître l'écart** entre prix d'achat et strike, en rebasant simplement le lot.
  Écarté : les journaux cesseraient d'être une partition du P/L réel du compte, et l'écart ne
  serait nulle part.
- **Faire basculer tout le lot d'actions** au premier call vendu. Écarté : « un call vendu sur
  elles » ne parle que des actions couvertes, et 600 actions détenues sous 2 calls n'en font
  pas 600 dans la wheel.
- **Redéfinir `DEFAULT_MULTIPLIER` dans `packages/ledger`** à côté de celle de
  `packages/coverage`. Écarté : deux définitions de la même constante métier, ce que
  `CLAUDE.md` interdit précisément.
- **Marquer `assigned` sur les actions reprises** pour que les statistiques les comptent sans
  toucher à `contributions`. Écarté : ce serait un mensonge dans une colonne dont c'est le
  seul rôle.
