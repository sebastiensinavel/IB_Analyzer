# Sous-projet 14 — Capital des LEAPS, des Condors et du portefeuille

Statut : implémenté (2026-09-12).

Le sous-projet 13 a donné à la page Statistiques Wheel trois graphiques : l'exposition par
secteur, le capital de la stratégie et le rendement mensuel. Les pages LEAPS et Condors n'en ont
aucun, et le tableau de bord ne dit rien de ce que les stratégies gagnent ni de l'argent qu'elles
immobilisent.

Ce sous-projet étend le calcul du capital aux LEAPS et aux Condors, l'applique aux trois
stratégies ensemble sous le nom `portfolio`, et pose les graphiques correspondants sur les pages
LEAPS et Condors et sur le tableau de bord. Le tableau de bord ne calcule rien à part : ses
chiffres sortent des mêmes fonctions, appelées sur les lignes des trois stratégies.

---

## 1. Périmètre

Dans le périmètre :

- `computeStats` et le calcul du capital prennent une liste de stratégies ;
- les montants immobilisés par les LEAPS et par les Condors (§2) ;
- `JournalsReport.stats` et `JournalsReport.capital` indexés par `wheel | leaps | condors |
  portfolio` ; `wheelCapital` disparaît ;
- `lib/wheelCharts.ts` devient `lib/capitalCharts.ts`, générique ; `WheelCapitalCards` éclate en
  cartes réutilisables ;
- page LEAPS : exposition par secteur, capital, rendement mensuel ;
- page Condors : capital, rendement mensuel ;
- tableau de bord : profit/perte total en haut à droite, profits/pertes mensuels, exposition par
  secteur, capital de toutes les stratégies, rendement mensuel ;
- la graine `--seed` montre un LEAPS et un Condor ouverts.

Hors périmètre, déclaré tel :

- **l'exposition par secteur des Condors** sur leur propre page : non demandée. Les Condors
  entrent en revanche dans l'exposition du tableau de bord ;
- **la conversion de devises** : tout reste par devise, comme au sous-projet 13 ;
- **la valeur de marché** : un LEAPS compte à son prix d'achat, jamais à sa valeur courante ;
- **la perte maximale d'un Condor** : il compte sa pire aile brute, crédit non déduit (§2) ;
- **le multiplicateur réel** : `DEFAULT_MULTIPLIER`, comme au sous-projet 13 ;
- **la page Wheel** : son contenu et son rendu ne changent pas.

---

## 2. Ce qui compte

La règle d'ouverture en fin de mois du sous-projet 13 vaut pour toutes les lignes : une ligne est
ouverte à la fin du mois M quand `startWhen < D` et que `endWhen` est `null` ou `endWhen ≥ D`, `D`
étant le premier jour du mois suivant. **On lit `endWhen`, jamais `ongoing`.**

| `strategy` | `kind` | Mesure | Montant |
|---|---|---|---|
| `wheel` | `short_put` | `putCash` | `strike × DEFAULT_MULTIPLIER × \|quantity\|` |
| `wheel` | `shares` | `assigned` | `openPrice × \|quantity\|` |
| `leaps` | `long_call` | `leaps` | `openPrice × DEFAULT_MULTIPLIER × \|quantity\|` |
| `leaps` | `shares` | `leaps` | `openPrice × \|quantity\|` |
| `condors` | `condor` | `condors` | `max(putWidth, callWidth) × DEFAULT_MULTIPLIER × \|quantity\|` |

Toute autre ligne ne compte rien, en particulier un call vendu, qu'il couvre des actions de la
Wheel ou un LEAPS.

- **LEAPS.** Le call acheté compte au prix payé par contrat, commission exclue, comme les lignes de
  la Wheel. Un LEAPS exercé livre ses actions dans le journal LEAPS (`deliverShares`, stratégie
  héritée), avec pour `openPrice` le strike : elles comptent ce strike, comme une action assignée
  de la Wheel. Le LEAPS cesse de compter à son `endWhen`, l'instant même où ses actions commencent :
  aucun double compte. Des actions LEAPS reprises par un call couvert (sous-projet 8) sortent du
  journal LEAPS à cet instant et entrent dans la Wheel au strike du call.
- **Condors.** `row.legs` porte les quatre jambes dans l'ordre de `openCondor` : put acheté, put
  vendu, call vendu, call acheté, strikes croissants. `putWidth = legs[1].strike − legs[0].strike`
  et `callWidth = legs[3].strike − legs[2].strike`. C'est la règle de `structureAssignmentCash`
  (`packages/coverage/src/report.ts`) : la pire aile, brute, le crédit étant déjà dans le cash du
  compte. `ledger` ne peut pas importer `coverage` (cycle), et `coverage` l'applique à des
  structures appariées depuis les positions, pas aux jambes d'un journal : le montant se calcule
  donc dans `ledger`, et un commentaire de chaque côté nomme l'autre. Le Condor compte jusqu'à son
  `endWhen`, qui est la sortie la plus tardive de ses jambes.
- Une ligne dont le montant est incalculable (`strike`, `openPrice`, `quantity` à `null`, ou des
  jambes absentes ou sans strike) ne compte pas et incrémente `incomplete`, une fois par ligne.

---

## 3. `packages/ledger`

### 3.1 Portées

Dans `journals/types.ts` :

```ts
/** A statistics page, or the three strategies at once for the dashboard. */
export type CapitalScope = StatsStrategy | "portfolio";
/** The strategies whose lines a scope reads. */
export const SCOPE_STRATEGIES: Record<CapitalScope, readonly StatsStrategy[]> = {
  wheel: ["wheel"],
  leaps: ["leaps"],
  condors: ["condors"],
  portfolio: ["wheel", "leaps", "condors"],
};
```

### 3.2 `computeStats`

```ts
export function computeStats(rows: readonly JournalRow[], strategies: readonly StatsStrategy[], lastWhen: string | null): StrategyStats[];
```

Seul change le filtre : une ligne compte quand sa stratégie est dans `strategies`. L'attribution
des flux, la plage de mois et le tri des devises ne changent pas. Pour `portfolio`, les mois vont
donc du premier flux, toutes stratégies confondues, jusqu'au mois de `lastWhen`, et le total d'une
devise est la somme des totaux des trois stratégies dans cette devise.

### 3.3 `computeCapital`

`journals/capital.ts`. `computeWheelCapital` est renommée et généralisée ; `nextMonthStart` et
`openAt` ne changent pas.

```ts
export type CapitalMeasure = "assigned" | "putCash" | "leaps" | "condors";

export interface CapitalMonth {
  /** YYYY-MM, the same months as the scope's StrategyStats, index for index. */
  month: string;
  cumulativePnl: number;
  /** Wheel shares held, at the price they entered the Wheel at. */
  assigned: number;
  /** Wheel puts open, at strike × multiplier × contracts. */
  putCash: number;
  /** LEAPS open at their purchase price, and shares a LEAPS delivered at its strike. */
  leaps: number;
  /** Condors open, at their worst wing × multiplier × contracts. */
  condors: number;
  /** assigned + putCash + leaps + condors */
  allocated: number;
  /** allocated − cumulativePnl */
  invested: number;
  /** This month's pnl / allocated; `null` when allocated is 0. */
  returnRate: number | null;
}

export interface Exposure {
  ticker: string;
  assigned: number;
  putCash: number;
  leaps: number;
  condors: number;
}

export interface StrategyCapital {
  currency: string;
  months: CapitalMonth[];
  /** Lines still open (`endWhen === null`), summed per ticker; only non-zero tickers, sorted by ticker. */
  exposure: Exposure[];
  /** Lines left out for want of a strike, a price, a quantity or a leg. */
  incomplete: number;
}

export function computeCapital(rows: readonly JournalRow[], strategies: readonly StatsStrategy[], stats: readonly StrategyStats[]): StrategyCapital[];
```

- `stats` est le résultat de `computeStats` pour les mêmes `strategies` : une entrée par élément,
  dans le même ordre, mêmes mois, `cumulativePnl` et `returnRate` tirés de leurs `pnl`.
- Une ligne compte quand sa stratégie est dans `strategies` et que le tableau du §2 lui donne une
  mesure. Pour une page de stratégie, les mesures des autres stratégies valent donc 0.
- `WheelMonth`, `WheelExposure` et `WheelCapital` disparaissent, sans alias.

### 3.4 `JournalsReport`

```ts
export interface JournalsReport {
  rows: JournalRow[];
  reconciliation: Reconciliation;
  stats: Record<CapitalScope, StrategyStats[]>;
  /** One entry per entry of `stats[scope]`, in the same order. */
  capital: Record<CapitalScope, StrategyCapital[]>;
}
```

`buildJournals` calcule chacune des quatre portées : `computeStats(rows, SCOPE_STRATEGIES[scope],
lastWhen)`, puis `computeCapital(rows, SCOPE_STRATEGIES[scope], stats[scope])`. Aucune addition de
résultats par stratégie n'existe nulle part : `portfolio` est le même calcul sur plus de lignes,
si bien que son rendement mensuel vaut par construction la somme des profits/pertes des trois
stratégies divisée par la somme de leurs montants alloués.

---

## 4. `apps/web` : graphiques

### 4.1 `lib/capitalCharts.ts`

`lib/wheelCharts.ts` est renommé (avec son test) et généralisé. Fonctions pures, sans React ni `t`.

```ts
export type CapitalSeriesKey = "cumulativePnl" | "assigned" | "allocated" | "invested";
export interface CapitalSeries { key: CapitalSeriesKey; name: string }

/** The lines each scope draws, in order. */
export const SCOPE_SERIES: Record<CapitalScope, readonly CapitalSeriesKey[]> = {
  wheel: ["cumulativePnl", "assigned", "allocated", "invested"],
  leaps: ["cumulativePnl", "allocated", "invested"],
  condors: ["cumulativePnl", "allocated", "invested"],
  portfolio: ["cumulativePnl", "allocated", "invested"],
};

export interface SectorSlice { sector: string; assigned: number; putCash: number; total: number; share: number; folded: boolean }
export function sectorSlices(exposure: readonly Exposure[], sectorOf: (ticker: string) => string | null, unclassified: string): SectorSlice[];
export function swatchColor(slice: SectorSlice, index: number, colors: ChartColors): string;
export function exposureOption(slices: readonly SectorSlice[], other: string, colors: ChartColors, currency: string): EChartsOption;
export function monthGrid(series: readonly CapitalSeries[]): { left: number; right: number };
export function capitalOption(capital: StrategyCapital, series: readonly CapitalSeries[], colors: ChartColors): EChartsOption;
export function returnOption(capital: StrategyCapital, series: readonly CapitalSeries[], colors: ChartColors): EChartsOption;
```

- `sectorSlices` : `total` d'un ticker = `assigned + putCash + leaps + condors`. Tri, repli au-delà
  de cinq parts et part « Autres » inchangés.
- **Une teinte par courbe, la même sur toutes les pages** : `colors.series[i]` où `i` est le rang
  de la clé dans `["cumulativePnl", "assigned", "allocated", "invested"]`. Sur les pages à trois
  courbes, « Alloué » reste aqua et « Cash investi » jaune.
- `monthGrid(series)` réserve la marge droite de la plus longue étiquette de fin des courbes
  passées ; les trois graphiques mensuels d'une page reçoivent les mêmes `series`, si bien que
  leurs mois restent alignés. Chaque page ayant désormais un graphique de capital, le cas `null`
  du sous-projet 13 (un histogramme seul) disparaît.
- Le comportement du sous-projet 13 est conservé sur la Wheel : mêmes options, mêmes tests, à la
  signature près.

### 4.2 Cartes

`components/stats/WheelCapitalCards.tsx` disparaît au profit de cartes indépendantes, dans le même
dossier :

| Composant | Props | Contenu |
|---|---|---|
| `CurrencySelect` | `currencies`, `value`, `onChange` | le sélecteur sorti de `StatsPage`, rendu seulement pour plusieurs devises |
| `PnlTotal` | `stats` | le montant signé, vert ou rouge, et la note `stats.incomplete` |
| `PnlTotalCard` | `stats` | la carte « Profit/Perte total » autour de `PnlTotal`, sur les pages de statistiques et le tableau de bord |
| `MonthlyPnlCard` | `stats`, `series` | la carte « Profits/pertes mensuels », sortie de `StatsPage` |
| `ExposureCard` | `capital`, `detailed`, `empty`, `sectorOf`, `isDark` | camembert et tableau-légende ; `detailed` ajoute Assigné et Couverture des puts |
| `CapitalCard` | `capital`, `series`, `title`, `isDark` | les courbes et la note `stats.incomplete` |
| `ReturnCard` | `capital`, `series`, `isDark` | le rendement mensuel |

`ExposureCard` pose le camembert et le tableau côte à côte quand sa carte est assez large
(requête de conteneur `@container`), l'un sous l'autre sinon : elle tient sur la pleine largeur
d'une page de statistiques comme sur la demi-largeur du tableau de bord. Les `data-testid`
`exposure-chart`, `capital-chart`, `return-chart` et `monthly-chart` restent.

Les noms de courbes se traduisent en un seul endroit : le hook `useCapitalSeries(scope)`
(`hooks/useCapitalSeries.ts`) rend les `CapitalSeries` de `SCOPE_SERIES[scope]`, nommées par
`stats.capital.<clé>`. La carte « Couverture en Cash » sort de `DashboardPage` dans
`components/CashCoverageCard.tsx`, inchangée.

---

## 5. `apps/web` : pages

### 5.1 Statistiques

`StatsPage` lit `view.report.stats[strategy]` et `view.report.capital[strategy]` pour la devise
affichée.

| Page | Cartes, dans l'ordre |
|---|---|
| Wheel | total, mensuel, exposition (`detailed`, vide : « Aucune position Wheel ouverte. »), capital (4 courbes), rendement |
| LEAPS | total, mensuel, exposition (Secteur, Total, Part ; vide : « Aucune position LEAPS ouverte. »), capital (3 courbes), rendement |
| Condors | total, mensuel, capital (3 courbes), rendement |

Le titre de la carte capital reste « Capital de la stratégie ».

### 5.2 Tableau de bord

Le tableau de bord lit `useAccountJournals()` et `useAccountRiskReport()`, jamais les hooks
eux-mêmes.

- **En-tête de la page**, la ligne du `h1` et non la barre de titre de la coquille, qui garde ses
  verdicts et `SnapshotStatus` : « Tableau de bord » à gauche ; à droite, `CurrencySelect` sur les
  devises de `stats.portfolio`. La devise par défaut est la première, comme sur les pages de
  statistiques. Sans statistiques, rien à droite.
- **Première rangée** (`md:grid-cols-2`), l'état présent. À gauche, une colonne : `PnlTotalCard`
  (« Profit/Perte total » de `stats.portfolio` pour la devise affichée, la même carte que sur les
  pages de statistiques), puis la carte « Couverture en Cash », inchangée et toujours en USD. À
  droite, `ExposureCard` de `capital.portfolio` (Secteur, Total, Part ; vide : « Aucune position
  ouverte. »). Le sélecteur de devise ne pilote pas la carte Cash. (Retouche du 2026-09-12 : le
  total quitte l'en-tête pour sa carte, au-dessus de la carte Cash.)
- **Puis en pleine largeur, empilées** : `MonthlyPnlCard`, `CapitalCard` titrée « Capital de toutes
  les stratégies » (3 courbes), `ReturnCard`. Empilées, leurs mois s'alignent.
- **Sans snapshot** (`report === null`) : la carte Cash est remplacée, à sa place, par le message
  `positions.empty` et son lien vers les sources ; les cartes des journaux restent. Sans snapshot
  **et** sans statistiques, la page garde son état vide actuel, seul.
- Pendant le chargement de l'un ou l'autre : `common.loading`, comme aujourd'hui.

---

## 6. Traductions

`fr` et `en`. `stats.exposure.empty` devient un objet :

| Clé | fr | en |
|---|---|---|
| `stats.exposure.empty.wheel` | Aucune position Wheel ouverte. | No open Wheel position. |
| `stats.exposure.empty.leaps` | Aucune position LEAPS ouverte. | No open LEAPS position. |
| `stats.exposure.empty.portfolio` | Aucune position ouverte. | No open position. |
| `stats.capital.titlePortfolio` | Capital de toutes les stratégies | Capital of all strategies |

Le tableau de bord réutilise `stats.total`, `stats.monthly`, `stats.currency`,
`stats.exposure.*`, `stats.capital.*` et `stats.return.title`.

---

## 7. Tests

`packages/ledger` :

- `capital.test.ts` :
  - **LEAPS** : un call acheté compte `openPrice × 100 × contrats` à chaque fin de mois où il est
    ouvert, puis plus rien une fois vendu ; un call vendu contre lui ne compte rien ; un LEAPS
    exercé passe de son prix d'achat au strike de ses actions le mois de l'exercice, sans double
    compte ; exposition sous `leaps` ;
  - **Condors** : la pire aile quand les ailes diffèrent (5 contre 10 de large), multipliée par
    les contrats ; plus rien après la sortie de la dernière jambe ; condor sans jambes
    (`incomplete`) ; exposition sous `condors` ;
  - **portées** : une ligne LEAPS ignorée par la portée `wheel` ; la portée `portfolio` somme les
    quatre mesures ; son `returnRate` égale la somme des `pnl` du mois divisée par la somme des
    montants alloués des trois portées ; tests existants de la Wheel conservés.
- `stats.test.ts` : plusieurs stratégies à la fois, mois commençant au premier flux de n'importe
  laquelle, total égal à la somme des totaux par stratégie ; `others` jamais compté.
- `replay.test.ts` : `stats` et `capital` portent les quatre portées ; le test de capital de la
  Wheel lit `capital.wheel`.
- L'oracle des journaux (`flex_journals_corpus.xml`) garde zéro écart de reconstitution.

`apps/web` :

- `capitalCharts.test.ts` : les tests de `wheelCharts.test.ts`, adaptés ; `total` d'une tranche
  somme les quatre mesures ; trois courbes gardent les teintes de leur clé (alloué aqua, investi
  jaune) ; `monthGrid` sur trois courbes.
- `StatsPage.test.tsx`, sur `fake-indexeddb` : page LEAPS avec exposition, capital et rendement,
  tableau-légende Secteur/Total/Part sans colonne Assigné ; page Condors avec capital et rendement,
  sans camembert ; page Wheel inchangée.
- `DashboardPage.test.tsx` : le profit/perte total égal à la somme des trois totaux du ledger semé ;
  les quatre cartes des journaux ; le sélecteur de devise absent pour une devise, présent pour
  deux ; sans snapshot, message et lien à la place de la carte Cash et graphiques présents ; sans
  snapshot ni transaction, l'état vide seul ; tests existants de la carte Cash conservés.
- `consistency.test.ts` et `seed.test.ts` suivent la nouvelle forme de `JournalsReport`.
- Capture `run-frontend --seed` du tableau de bord et des pages LEAPS et Condors, en clair et en
  sombre, et à 400 px de large pour le tableau de bord. La graine `beta` gagne un Condor encore
  ouvert et, au besoin, un secteur pour le ticker du LEAPS ; son snapshot suit, reconstitution
  sans écart.

---

## 8. Documentation

- `CLAUDE.md` : ligne 14 du tableau des sous-projets ; la règle « Le capital de la Wheel se mesure
  au prix d'entrée » devient la règle du capital des trois stratégies (LEAPS au prix d'achat,
  actions exercées au strike, Condor à sa pire aile brute) et dit que le tableau de bord est la
  portée `portfolio` des mêmes fonctions, jamais une addition de résultats.
- `docs/points-reportes.md` : ce que la revue de branche reportera.

---

## 9. Décisions écartées

| Écarté | Pourquoi |
|---|---|
| Additionner les résultats des trois stratégies (`combineCapital`) | Deuxième copie de l'alignement des mois et des dérivés ; la portée `portfolio` rend la même chose avec le même code |
| Agréger dans `DashboardPage` | Le métier vit dans les paquets, testé sans React |
| Condor à sa perte maximale (aile moins crédit) | Choix de l'utilisateur : la pire aile brute, comme la carte Couverture en Cash |
| Ignorer les actions d'un LEAPS exercé | Choix de l'utilisateur : elles immobilisent le strike payé |
| Courbe « Assigné » sur LEAPS, Condors et tableau de bord | Sans objet hors de la Wheel (demande explicite) |
| Une courbe d'alloué par stratégie sur le tableau de bord | Choix de l'utilisateur : cumul, alloué, investi |
| Colonnes par stratégie ou par mesure dans le tableau-légende du tableau de bord | Choix de l'utilisateur : Secteur, Total, Part |
| Exposition par secteur sur la page Condors | Non demandée |
| Importer `structureAssignmentCash` depuis `coverage` | `coverage` dépend de `ledger` : cycle ; et elle lit des structures de positions, pas des jambes de journal |
| Teinte attribuée par rang de courbe | « Alloué » changerait de couleur d'une page à l'autre |
| Graphiques mensuels côte à côte sur le tableau de bord | Leurs mois ne s'aligneraient plus |
