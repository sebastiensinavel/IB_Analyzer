# Sous-projet 33 — L'ordre de sortie des lots d'actions

Statut : conçu (2026-09-28).

Aujourd'hui, quand des actions sortent du carnet, le moteur de journaux prend les lots dans
l'ordre du carnet, FIFO, avec une seule préférence : un call couvert de la Wheel fait sortir
d'abord des actions de la Wheel (`LotBook.closePreferring`, sous-projet 17 §4). Le prix d'un
lot ne compte jamais.

Le besoin, exprimé au brainstorming : quand des puts ont été assignés à plusieurs prix et que le
cours est bas, un call vendu au-dessus du prix moyen d'assignation ne rapporte presque rien. On
vend alors quelques calls au niveau du lot le plus bas, pour encaisser un peu de prime en
laissant le cours remonter. Le journal doit lire ce call comme portant sur ce lot-là : à
l'assignation, c'est lui qui sort, au prix de son put.

---

## 1. Périmètre

Dans le périmètre, le choix des lots d'actions **longues** qui sortent, dans le moteur de journaux
(`packages/ledger/src/journals/`) :

1. l'assignation d'un call couvert de la Wheel (§3, R1) ;
2. une vente d'actions jointe au rachat d'un call couvert de la Wheel, à 60 secondes près (§3,
   R2) ;
3. toute autre sortie d'actions longues — vente au marché, assignation d'un call qui n'est pas
   dans la Wheel, exercice d'un put acheté (§3, R3).

Hors périmètre :

- le rachat d'actions vendues à découvert, qui reste FIFO ;
- la reprise d'actions par un call (`takeOverShares`, sous-projet 17 §3), qui prend toujours les
  lots hors Wheel dans l'ordre du carnet et au strike ;
- le classement d'un call vendu entre Wheel, LEAPS et Autres (`splitShortCall`) ;
- les opérations sur titres, qui gardent leur ordre de rang (`rankWhen`, `insertByRank`) ;
- le découpage fiscal d'IB, que le journal ne cherche pas à reproduire : le moteur calcule son
  propre P/L (`Transaction.realizedPnl` n'est lu que sur les opérations sur titres) ;
- l'affichage : aucune page ne change, seules les lignes qu'elle lit changent.

**Critères de réussite :**

- les exemples du §4 sont des tests Vitest et passent ;
- l'oracle `flex_journals_corpus.xml` reste à zéro écart, et la reconstitution de `alpha` et de
  `beta` ne bouge pas : la règle change *quels* lots sortent, jamais *combien* ;
- une stratégie active ne se retrouve jamais avec un call couvert sans les actions qui le
  couvrent, sauf quand les actions libres de tout le compte ne suffisent pas (§3, R3).

---

## 2. Actions couvertes, actions libres

Seul un call de la Wheel est couvert par des actions (`cover === "shares"`) : une Wheel inactive
envoie les calls vendus nus dans Autres (sous-projet 30), et un call couvert par un LEAPS ne
mobilise aucune action. Les actions couvertes sont donc toujours des actions de la Wheel.

Le moteur ne relie aucun call à un lot : il sait combien de contrats la Wheel couvre, pas
lesquels. Ce sous-projet ajoute une **attribution**, calculée à chaque sortie et jamais stockée :

1. les calls couverts de la Wheel encore ouverts sur le ticker sont pris par strike croissant,
   à strike égal dans l'ordre du carnet ;
2. chacun reçoit, parmi les actions Wheel non encore attribuées, `|contrats| ×
   sharesPerContract` actions choisies par la règle R1 avec son strike ;
3. ce qui reste attribué est **couvert** ; tout le reste — le reste des lots Wheel, tous les lots
   d'Autres et de LEAPS — est **libre**.

L'attribution se compte en actions, pas en lots : un lot de 200 actions peut être à moitié
couvert. L'ordre par strike croissant sert le call le plus contraint d'abord ; il ne change le
résultat que dans des cas où les deux ordres sont également défendables.

---

## 3. Les trois règles

Le prix d'un lot est son `openPrice` : le strike du put qui l'a livré ou du call qui l'a repris
pour une action Wheel, le prix d'achat pour une action d'Autres ou de LEAPS. Un lot sans prix
(`null`) se range après tous les lots qui en ont un. À prix égal, l'ordre du carnet décide
(FIFO, donc `rankWhen`).

### R1 — L'assignation d'un call couvert de la Wheel

Le call livre des actions Wheel : **le lot le plus cher dont le prix ne dépasse pas le strike,
sinon le lot le plus bas**. S'il faut plus d'actions que ce lot n'en porte, le suivant est choisi
par la même règle parmi ce qui reste.

Ce qui manque dans la Wheel, si jamais il en manque, sort par R3.

### R2 — La vente jointe au rachat d'un call couvert de la Wheel

Une vente d'actions longues à **60 secondes ou moins** du rachat d'un call couvert de la Wheel,
avant ou après, reste entièrement dans la Wheel : elle sort des actions Wheel par R1 avec **le
strike du call racheté**, comme une assignation faite à la main, dans la limite des contrats
rachetés. Ce qu'elle vend au-delà sort par R3.

`WHEEL_BUYBACK_WINDOW_MS = 60_000` vit une seule fois, à côté de `FILL_MERGE_WINDOW_MS`.

Un rachat est un trade `OPT` de right `C`, acheté (`quantity > 0`), avec commission (pas une
jambe d'expiration ni d'assignation), sur le même ticker et la même devise que la vente. Il ne
sert qu'une fois : plusieurs ventes dans sa fenêtre se partagent ses contrats dans l'ordre
chronologique, la première rejouée d'abord — la servir par proximité obligerait le replay à lire
l'avenir. Une vente appariée à plusieurs rachats les consomme du plus proche au plus lointain,
chacun avec son strike.

### R3 — Toute autre sortie d'actions longues

1. D'abord les actions **libres**, stratégie par stratégie : **Autres, puis LEAPS, puis Wheel** ;
   dans chaque stratégie, le prix le plus faible d'abord.
2. Puis, en dernier recours seulement, les actions **couvertes**, au prix le plus faible
   d'abord.

Le second cas arrive quand on vend plus que les actions libres de tout le compte : chez IB, le
call devient réellement nu. Le call reste alors dans sa stratégie au Journal — la classification
se fait une fois, à la vente —, et la page Positions de la stratégie n'en montre pas la part nue :
`migratedContracts` (sous-projet 22) la passe dans Autres, et la barre de titre signale la
position non couverte.

---

## 4. Exemples

Chacun devient un test. Les actions vont par 100, un contrat en couvre 100.

### 4.1 R1, un seul call

La Wheel détient AISP à 6 (put assigné le 1er) puis AISP à 5 (put assigné le 2). Un call à 5 est
assigné.

- Avant : le lot à 6, le premier du carnet, sortait à 5 — ligne à −100 $ ; le lot à 5 restait.
- Après : le lot à 5 sort à 5 — ligne à 0 $ ; le lot à 6 reste, et le capital de la Wheel
  compte 600 $ au lieu de 500 $.

### 4.2 R1, aucun lot sous le strike

La Wheel détient AISP à 6 et à 7. Un call à 5 est assigné : aucun lot ne vaut 5 ou moins, le plus
bas sort, celui à 6.

### 4.3 R1, deux calls

La Wheel détient AISP à 5 et à 6. Calls ouverts à 5 et à 7. Attribution : le call à 5 reçoit le
lot à 5, le call à 7 le lot à 6 ; rien n'est libre. Le call à 7 est assigné en premier : il livre
le lot le plus cher sous 7, celui à 6 (+100 $). Le call à 5 livrera ensuite le lot à 5 (0 $).

### 4.4 R2, vente avant le rachat

La Wheel détient AISP à 5 et à 6, un call à 5 est ouvert. À 10:00:00 on vend 100 AISP au marché,
à 10:00:40 on rachète le call. La vente sort le lot à 5, celui que le call aurait livré.

### 4.5 R2, au-delà de la fenêtre

Même carnet ; la vente est à 10:00:00, le rachat à 10:02:00. La vente n'est pas jointe : R3
s'applique. Le call à 5 encore ouvert couvre le lot à 5 ; le lot à 6 est libre, c'est lui qui
sort.

### 4.6 R3, Autres avant la Wheel

On achète 200 AISP à 4 (Autres). Un call à 7 en reprend 100, rouvertes dans la Wheel à 7. On vend
100 AISP au marché à 6 : la Wheel n'a rien de libre, Autres sort son lot à 4 (+200 $), le call
reste couvert.

### 4.7 R3, jamais une action couverte tant qu'il y a du libre

La Wheel détient 100 AISP assignées à 3, couvertes par un call à 4 ; Autres détient 100 AISP
achetées à 8. On vend 100 AISP au marché à 5 : Autres sort son lot à 8 (−300 $ dans Autres), la
Wheel garde son lot à 3.

### 4.8 R3, ordre des stratégies

Autres détient 100 AISP à 9, LEAPS 100 AISP livrées à 2, la Wheel 100 AISP libres à 5. Trois
ventes de 100 successives sortent Autres à 9, puis LEAPS à 2, puis la Wheel à 5 — l'ordre des
stratégies prime sur le prix.

### 4.9 R3, vente plus grande que le libre

La Wheel détient 200 AISP à 5, un call à 6 couvre 100. On vend 200 au marché : les 100 libres
sortent d'abord, puis les 100 couvertes. Le call reste Wheel au Journal ; `migratedContracts` le
montre dans Autres sur la page Positions.

---

## 5. Architecture

### 5.1 Le carnet

`LotBook` perd `closePreferring` et gagne une primitive qui ferme des quantités sur des lots
donnés, dans l'ordre donné :

```ts
closeOrdered(plan: readonly { lot: Lot; quantity: number }[]): ClosedPortion[]
```

La liste interne du carnet ne change pas : elle reste l'ordre de rang, que `close` (rachat de
positions courtes, options), `move` et `insertAfter` continuent d'utiliser.

### 5.2 Le module d'ordre

`packages/ledger/src/journals/exitOrder.ts`, pur, sans carnet :

- `strikePlan(lots, strike, contracts, reserved?, maxShares?)` — R1 en quantités, utilisé aussi
  par R2 ;
- `coverAttribution(wheelLots, openCalls)` — §2 : actions couvertes par lot ;
- `salePlan(lots, covered, shares)` — R3 : libres par Autres, LEAPS, Wheel, puis couvertes.

Chaque fonction se teste seule sur des lots écrits à la main.

### 5.3 Le replay

- `deliverShares` (`replay.ts`) : un call couvert de la Wheel passe par `strikePlan`, puis
  `salePlan` pour ce qui manque ; toute autre livraison d'actions longues par `salePlan`.
- La boucle des actions de `replayGroup` : une vente passe d'abord par ses rachats appariés
  (R2), puis par `salePlan`. `wheelBuybacks`, limité au même instant, disparaît.
- Un pré-passage, après `mergeFills`, apparie chaque vente d'actions longues avec commission aux
  rachats de calls de la fenêtre (§3, R2). Le budget d'un rachat, en contrats, s'établit à sa
  première consommation :
  - rachat pas encore rejoué (vente avant) : le minimum de sa quantité et des contrats couverts
    Wheel encore ouverts sur ce contrat ;
  - rachat déjà rejoué (vente après) : les contrats couverts Wheel qu'il a fermés, notés dans le
    contexte au moment de son rejeu.

  Le budget restant vit dans le `ReplayContext`, par transaction de rachat.

---

## 6. Effets sur le reste de l'application

Aucun code hors du moteur de journaux ne change ; ce qui lit les lignes suit :

- les lignes d'actions Wheel se découpent autrement, donc le P/L réalisé change de mois sans
  changer de total une fois tout vendu ;
- `computeCapital`, `wheelHoldings` (prix moyen d'assignation), `strategyBoxContents` (encadrés
  au-dessus / en dessous) et `strategyLevels` lisent les lots restants, donc leurs valeurs
  bougent ;
- la ligne du put qui reste « en cours » est celle dont le lot reste ;
- `averageSharePrice` (`classify.ts`), qui oriente `splitShortCall`, lit les lots restants : le
  classement d'un call vendu plus tard peut changer.

CLAUDE.md est mis à jour : la phrase « **Un call Wheel fait sortir d'abord des actions Wheel**
(`LotBook.closePreferring`) … Toute autre vente reste FIFO » est remplacée par les règles R1, R2
et R3 et le nom du module ; la justification de `rankWhen` ne parle plus que des opérations sur
titres.

---

## 7. Tests

- `exitOrder.test.ts` : R1, R3 et l'attribution, un test par exemple du §4 et par cas limite
  (prix `null`, lot à moitié couvert, égalité de prix).
- Tests du replay pour R2 : vente avant, après, hors fenêtre, deux ventes pour un rachat.
- Les tests des sous-projets 8 et 17 qui figent des lignes Wheel sont revus un par un : chaque
  changement attendu s'explique par une des règles, jamais par un ajustement au résultat.
- L'oracle `flex_journals_corpus.xml` et les tests privés de reconstitution (`alpha`, `beta`)
  passent sans modification.
