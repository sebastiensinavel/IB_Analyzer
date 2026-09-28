# Sous-projet 38 — La décision de rachat tient compte du temps

Statut : conçu (2026-09-28).

La colonne « Décision » des tableaux de positions propose « buy back » ou « keep » pour une
option vendue. La règle actuelle, `evaluateBuyback` (`packages/coverage/src/classify.ts`), ne
regarde que le prix : « buy back » dès que le prix courant vaut au plus la moitié du prix de
vente (`BUYBACK_RATIO = 2`). Elle propose donc de racheter à 40 % de la prime un call de
30 jours à 3 jours de son échéance, alors que le reste de la prime s'encaisse en très peu de
temps : le rachat n'est pas rentable.

Ce sous-projet ajoute une condition de temps, et une infobulle qui dit le prix de rachat seuil.

---

## 1. La règle

Notations : **S** le prix de vente (prime par unité), **C** le prix de rachat courant, **T** la
durée totale (de la date moyenne de vente à l'échéance), **r** le temps restant (de l'instant
du prix à l'échéance).

> **Racheter si C ≤ S × min(½, r / T)** — sinon garder.

Deux lectures équivalentes de la condition de temps C ≤ S × r / T :

1. **Le gain capté est en avance sur le temps écoulé** : (S − C) / S ≥ (T − r) / T.
2. **Ce qui reste rapporte moins par jour que la vente d'origine** : C / r ≤ S / T. Garder
   encaisse encore C en r jours ; la vente d'origine rapportait S en T jours. Quand la fin du
   contrat rapporte moins par jour qu'une vente neuve, mieux vaut libérer la marge et revendre.

Exemple : un call de 30 jours vendu 30 $, à 10 jours de l'échéance, se rachète sous 10 $.

Le seuil de 50 % (`BUYBACK_RATIO`, seule définition du ½) ne pèse que pendant la première
moitié de la vie du contrat : au-delà, la condition de temps est la plus stricte.

Arbitrages (2026-09-28) :

- **Pas de plancher en fin de vie** : quand r tend vers 0 la règle exige C ≈ 0 et dit « keep »
  jusqu'au bout ; le rachat à quelques cents contre le risque d'assignation reste une décision
  de l'utilisateur.
- **Pas de commission** dans le calcul : elle ne pourrait que retarder un rachat, et en fin de
  vie la règle garde déjà.
- **Decay linéaire** : le seuil suppose une prime qui fond proportionnellement au temps. Une
  option à la monnaie fond plutôt comme √r ; le seuil est donc surtout atteint quand le
  sous-jacent s'éloigne du strike, le cas qu'il vise.
- Une position perdante (C > S) garde toujours ; rouler ou couper une perte est hors périmètre.

## 2. Le temps

- Toutes les dates sont l'heure murale de New York stampée UTC (`IB_REPORT_TIME_ZONE`) : les
  `startWhen` du journal, l'`asOf` d'un snapshot agent (`toReportTime`). Aucune conversion.
- **L'échéance** `YYYY-MM-DD` compte à 16:00 ce jour-là : `${expiry}T16:00:00.000Z`.
- **L'instant du prix** est l'`asOf` du snapshot, jamais l'horloge : c'est à cet instant que C a
  été lu. Un `asOf` réduit à un jour (Flex, relevé) vaut la clôture de ce jour, 16:00.
- Durées en **jours calendaires fractionnaires** (ms / 86 400 000) : le theta court aussi le
  week-end.
- **La date moyenne de vente** est la moyenne des instants de vente pondérée par la quantité
  vendue. Un roll est une vente neuve, avec sa propre ligne de journal, donc sa propre date.
- Cas limites :
  - r ≤ 0 (échue à l'instant du prix, p. ex. le snapshot de fin de journée du jour d'échéance) :
    « keep », seuil 0 — il n'y a plus rien à racheter, l'option expire ;
  - T ≤ 0 (vente datée à ou après l'échéance, incohérent) ou r > T (prix antérieur à la vente,
    incohérent) : on garde la seule règle des 50 % ;
  - date de vente inconnue, échéance inconnue ou `asOf` inconnu : seule règle des 50 %.

## 3. Le moteur (`packages/coverage`)

`evaluateBuyback` renvoie un avis au lieu d'une chaîne :

```ts
export interface BuybackAdvice {
  decision: "buy back" | "keep";
  /** Prix de rachat par unité sous lequel (inclus) on rachète : S × min(½, r/T), ou S / 2. */
  threshold: number;
  /** Jours restants et durée totale, arrondis par l'affichage seulement ; null sans le temps. */
  remainingDays: number | null;
  totalDays: number | null;
}

export interface BuybackTiming {
  soldAt: string;   // date moyenne de vente, heure de NY stampée UTC
  expiry: string;   // YYYY-MM-DD
  asOf: string;     // instant du prix, ISO ou YYYY-MM-DD
}

export function evaluateBuyback(salePrice: number, currentPrice: number, timing: BuybackTiming | null): BuybackAdvice;
```

- Les valeurs absolues de S et C, comme aujourd'hui. S ≤ 0 : `keep`, seuil 0, jours `null`.
- `remainingDays`/`totalDays` ne sont non nuls que si la condition de temps a été appliquée
  (§2) ; c'est ce qui choisit le texte de l'infobulle (§5).
- `averageSaleInstant(parts: readonly { when: string; quantity: number }[]): string | null`,
  pure, dans le même module : moyenne des instants pondérée par `|quantity|`, `null` pour une
  liste vide ou de quantité nulle.

Chaque sortie qui porte aujourd'hui `decision` garde ce champ tel quel (tri, filtre et badge
le lisent) et gagne à côté `buyback: BuybackAdvice | null`, non nul exactement quand
`decision` l'est :

- **`AnalyzedPosition`** (`analyze`, `report.ts`) : `buildRiskReport(positions, cash, timing?)`
  reçoit en option `{ asOf: string; soldAt: ReadonlyMap<string, string> }`, table
  `contractId → date moyenne de vente`. Une position s'y cherche par la même clé que la
  réconciliation. Sans table ou sans entrée : `timing` null, règle des 50 %.
- **`StrategyLine`** (`strategy.ts`) : la date moyenne des `contributions` de la ligne, avec
  l'`asOf` du snapshot et l'échéance du contrat. `strategyPositions` reçoit déjà le snapshot.
- **`CondorLine`** (`condors.ts`) : le `startWhen` du composite, l'échéance du condor.
  `closingCost ≤ 0` reste « buy back » d'office, avec un avis de seuil 0 et les jours du condor.

## 4. La table des dates de vente (`apps/web`)

`AccountDataProvider` construit, une fois par journaux, `contractId → date moyenne de vente`
depuis les lignes de journal ouvertes (`endWhen === null`) de **toutes** les stratégies, Autres
comprise, vendeuses (quantité < 0), options seulement ; les composites de condor sont lus par
leurs jambes. La fonction est pure et vit dans `packages/coverage` (`saleInstants(rows)`),
à côté de `strategyPositions`, qui lit la même forme.

`useRiskReport` la reçoit et la passe à `buildRiskReport` avec l'`asOf` du snapshot. Tant que
les journaux chargent, la table est absente : la page Positions affiche la règle des 50 %,
puis se recalcule. Rien n'est stocké.

## 5. L'affichage

`decisionBadge` reste la seule traduction avis → badge ; il gagne l'infobulle. Le badge des
trois tableaux (`PositionRow`, lignes de stratégie, `CondorRows`) la porte par le même
`Tooltip` que les badges de couverture.

- Avec le temps : « Rachat rentable sous {{price}} : {{remaining}} j restants sur {{total}} »
  (en : « Buy back pays below {{price}}: {{remaining}} d left of {{total}} »).
- Sans le temps : « Rachat rentable sous {{price}} : 50 % de la prime » (en : « Buy back pays
  below {{price}}: 50% of the premium »).
- `price` = `formatPrice(threshold)` suivi du code de devise de la position (« 0.42 USD ») :
  l'application formate ses nombres en `en-US` et ses prix sans symbole.
- Jours arrondis à l'entier le plus proche.

Le tri et le filtre de la colonne Décision ne changent pas.

## 6. Tests

- `packages/coverage`, Vitest écrit à la main : 30 j / 30 $ / 10 j restants → seuil 10 ;
  première moitié → seuil S/2 ; bascule à mi-vie ; C exactement au seuil → buy back ; échue →
  keep et seuil 0, même à prix 0 ; sans timing → S/2 et jours null ; T ≤ 0 et r > T → S/2 ; asOf en jour seul →
  16:00 ; moyenne pondérée de deux ventes ; `StrategyLine` et `CondorLine` portent l'avis ;
  `buildRiskReport` avec et sans table.
- `apps/web`, sur `fake-indexeddb` avec un ledger semé : `saleInstants` alimente la page
  Positions (l'infobulle montre les jours) ; `decisionBadge` rend les deux textes.

## 7. Hors périmètre

Plancher de fin de vie, commission, modèle de decay non linéaire, décision de roll, toute
colonne nouvelle, tout stockage.
