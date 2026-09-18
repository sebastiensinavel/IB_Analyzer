# Sous-projet 16 — Positions par stratégie et Suggestion de Position

Statut : implémenté (2026-09-14).

La page Positions montre le portefeuille IB tel que le snapshot le donne : une ligne par
contrat, rangée par genre (positions longues, achats d'options, ventes d'options), sans aucune
notion de stratégie. Pour suivre une Wheel ou des LEAPS, l'utilisateur doit donc retrouver à la
main, dans cette liste, ce qui appartient à la stratégie — et une même position IB peut en
mêler plusieurs : des actions en partie dans la Wheel, un call vendu en partie couvert par des
actions et en partie nu.

Ce sous-projet ajoute, dans les sections Stratégie Wheel et Stratégie LEAPS du menu, une page
**Positions** qui ne montre que la part de la stratégie, et une carte **Suggestion de
Position** au tableau de bord, qui propose des tickers de la table sectorielle où ouvrir une
position sans concentrer le portefeuille.

Rien ne quitte le navigateur : tout se calcule à partir des journaux, du snapshot et de la
table sectorielle déjà en IndexedDB, rien n'est stocké, `apps/api` ne change pas.

---

## 1. Périmètre

Dans le périmètre :

- la clé de contrat sur chaque ligne de journal (`JournalRow.contract`) ;
- l'agrégat des actions Wheel détenues par ticker (`wheelHoldings`, `packages/ledger`) ;
- le croisement des lignes ouvertes d'une stratégie avec le snapshot (`wheelPositions`,
  `leapsPositions`, `packages/coverage`) ;
- la sélection des suggestions (`positionSuggestions`, `packages/coverage`), portée de
  `select_put_sell_candidates` de l'outil Python d'origine ;
- deux routes `positions/wheel` et `positions/leaps`, leur entrée de menu, la page
  `StrategyPositionsPage` ;
- la carte `PositionSuggestionsCard` en bas du tableau de bord.

Hors périmètre, déclaré tel :

- **une page Positions pour les Condors ou pour Autres** : non demandée ;
- **un filtre texte** sur les nouvelles pages : non demandé, la page Positions garde le sien ;
- **la conversion de devise** : les montants s'affichent comme sur Positions, et les valeurs de
  risque s'additionnent sans conversion, comme dans l'outil Python d'origine ;
- **les graphiques de répartition** (« Breakdown ») de son rapport HTML : seule la mesure
  qu'ils utilisaient, la valeur de risque, est reprise pour la suggestion ;
- **le repli sur les colonnes `S-2` à `S-22`** quand le score est vide : l'import CSV les ignore
  déjà (sous-projet 15) ;
- **épingler un call à un lot d'actions précis** : le moteur ne le fait pas (dette du
  sous-projet 8), les agrégats restent par ticker.

---

## 2. `packages/ledger`

### 2.1 `JournalRow.contract`

`JournalRow` gagne un champ obligatoire :

```ts
/** The contract of the line, the ticker canonical like `ticker`; a condor composite has no right nor strike. */
contract: ContractKey;
```

- `buildRow` (`journals/rows.ts`) le copie depuis `lot.contract` ;
- `settlementRow` (`journals/replay.ts`) le lit de la transaction par `contractOf(tx)` ;
- la ligne composite d'un condor passe par `buildRow` et porte donc le contrat que `condor.ts`
  donne déjà à son lot : ticker, `secType` `OPT`, échéance, `right` `""`, `strike` `null`.

`ticker`, `strike` et `currency` restent sur la ligne tels quels. Les fabriques de ligne de
`capital.test.ts`, `stats.test.ts` et `apps/web/src/lib/journalTone.test.ts` reçoivent le
champ. L'oracle des journaux (`journals.oracle.test.ts`) compare le moteur à lui-même, sans
instantané stocké : il n'a rien à régénérer.

### 2.2 `wheelHoldings`

Nouveau fichier `packages/ledger/src/journals/holdings.ts`, exporté par `journals/index.ts` :

```ts
export interface WheelHolding {
  ticker: string;
  currency: string;
  /** Shares of the open Wheel lots, never the whole IB position. */
  quantity: number;
  /** Σ openPrice × quantity ÷ quantity; `null` when a lot has no price. */
  averageAssignmentPrice: number | null;
  /** Σ openPrice × quantity: the Wheel's `assigned` capital for this ticker. */
  assignedTotal: number | null;
  /** Contracts of the Wheel calls still open on the ticker. */
  openCallContracts: number;
  /** Σ strike × contracts ÷ contracts; `null` without an open call. */
  averageCallStrike: number | null;
  /** min(quantity, openCallContracts × DEFAULT_MULTIPLIER). */
  coveredShares: number;
}

export function wheelHoldings(rows: readonly JournalRow[]): WheelHolding[];
```

Règles :

- les lignes lues sont celles de stratégie `wheel` ouvertes selon **`endWhen === null`, jamais
  selon `ongoing`** — la raison de `capital.ts` : un put assigné reste `ongoing` tant que ses
  actions ne sont pas vendues ;
- `kind === "shares"` donne les actions, `kind === "short_call"` les calls ;
- l'`openPrice` d'une ligne d'actions Wheel est le strike du put qui l'a livrée ou celui du call
  qui l'a reprise (sous-projet 8) ; les deux se moyennent ensemble. Après une opération sur
  titres, il a été divisé par le ratio comme partout ailleurs ;
- regroupement par `(ticker, currency)`, résultat trié par ticker puis devise ;
- un groupe sans action Wheel ouverte est absent, même avec un call Wheel encore ouvert ;
- le multiplicateur d'un call est `DEFAULT_MULTIPLIER`, comme dans `capital.ts` ;
- une quantité ou un prix `null` rend `averageAssignmentPrice` et `assignedTotal` `null`, un
  strike `null` rend `averageCallStrike` `null` : jamais 0.

---

## 3. `packages/coverage` — positions par stratégie

Nouveau fichier `packages/coverage/src/strategy.ts`, exporté par `src/index.ts`.

### 3.1 Types

```ts
/** A strategy's part of one IB contract: one line of the option or share tables. */
export interface StrategyLine {
  contract: ContractKey;
  /** short_put, short_call, long_call or long_stock. */
  kind: PositionKind;
  /** KIND_LABELS[kind], the Type column of the Positions page. */
  label: string;
  /** Signed: the strategy's open journal lines on this contract, summed. */
  quantity: number;
  /** Σ openPrice × |quantity| ÷ Σ |quantity|; `null` when a line has no price. */
  avgPrice: number | null;
  /** Market price of the IB position on the same contract; `null` when the snapshot does not hold it. */
  lastPrice: number | null;
  /** lastPrice × quantity × multiplier */
  marketValue: number | null;
  /** (lastPrice − avgPrice) × quantity × multiplier */
  unrealizedPnl: number | null;
  /** Short options only: evaluateBuyback(avgPrice, lastPrice); `null` otherwise or without both prices. */
  decision: "buy back" | "keep" | null;
  /** The whole IB position; `null` when the snapshot does not hold the contract. */
  position: AnalyzedPosition | null;
  /** What of the IB position's cover belongs to the strategy, for a sold option; empty otherwise. */
  coverage: CoverageAllocation[];
}

export type PositionsStrategy = "wheel" | "leaps";

/** The cover each strategy owns on a sold option; UNCOVERED is nobody's here. */
export const STRATEGY_COVER_SOURCES: Record<PositionsStrategy, readonly CoverSource[]> = {
  wheel: ["cash", "stock"],
  leaps: ["leaps"],
};

export interface WheelShareLine extends WheelHolding {
  lastPrice: number | null;
  /** (lastPrice − averageAssignmentPrice) × quantity */
  unrealizedPnl: number | null;
  /** averageCallStrike < averageAssignmentPrice; `false` when either is `null`. */
  callStrikeBelowAssignment: boolean;
}

export interface WheelPositions {
  shares: WheelShareLine[];
  optionSales: StrategyLine[];
}

export interface LeapsPositions {
  optionBuys: StrategyLine[];
  optionSales: StrategyLine[];
  shares: StrategyLine[];
}

/** The snapshot's positions and the risk report built from them, index for index. */
export interface PricedSnapshot {
  positions: readonly Position[];
  report: RiskReport;
}

export function wheelPositions(rows: readonly JournalRow[], snapshot: PricedSnapshot | null): WheelPositions;
export function leapsPositions(rows: readonly JournalRow[], snapshot: PricedSnapshot | null): LeapsPositions;
```

### 3.2 Lignes lues

Les lignes de journal ouvertes (`endWhen === null`) de la stratégie, regroupées par
`contractId(row.contract)` :

| Tableau | Stratégie | Genre de ligne | `kind` rendu |
|---|---|---|---|
| Wheel — Actions assignées | `wheel` | `wheelHoldings` (§2.2) | — |
| Wheel — Ventes d'options | `wheel` | `short_put`, `short_call` | le même |
| LEAPS — Achats d'options | `leaps` | `long_call` | `long_call` |
| LEAPS — Ventes d'options | `leaps` | `short_call` | `short_call` |
| LEAPS — Actions | `leaps` | `shares` | `long_stock` |

Une ligne dont `quantity` est `null` n'entre dans aucun tableau.

### 3.3 Appariement avec le snapshot

Une table `contractId(contractOf(snapshot.positions[i]))` → `{ position: snapshot.positions[i],
analyzed: snapshot.report.positions[i] }`, la première position gagnant si deux portaient la
même clé. C'est la clé que `reconcile.ts` compare déjà, et qui ne laisse aucun écart sur
l'oracle des journaux.

L'appariement par indice tient parce que `buildRiskReport` rend `positions.map(analyze)` et que
`computeCoverage` modifie ces objets sur place sans réordonner le tableau. **Un test fige cet
invariant** : un changement d'ordre dans le moteur de couverture doit casser la suite, jamais
fausser les prix en silence.

Une ligne d'actions Wheel s'apparie sur `contractId(sharesContract(ticker, currency))`.

### 3.4 Calculs

- **multiplicateur** : `contractMultiplier(position IB)` quand la position existe, sinon
  `DEFAULT_MULTIPLIER` pour une option ; 1 pour des actions ;
- **signes** : ceux d'IB. Un put vendu à 2,00 (`quantity` −1) qui cote 0,50 a une valeur de
  marché de −50 et un P&L latent de +150 ; un call acheté à 3,00 qui cote 4,00 a une valeur de
  +400 et un P&L de +100 ;
- **décision** : `evaluateBuyback(avgPrice, lastPrice)` sur les options vendues, le prix
  d'entrée du journal remplaçant le coût moyen IB ; `BUYBACK_RATIO` n'est pas redéfini ;
- **valeur absente** : `marketValue` est `null` sans `lastPrice`, `unrealizedPnl` sans
  `lastPrice` ou sans `avgPrice`, `decision` sans l'un des deux ;
- **couverture** : `position` reste la position IB entière du rapport de risque, mais
  `coverage` n'en garde que les répartitions de la stratégie (`STRATEGY_COVER_SOURCES`) : `cash`
  et `stock` pour une vente Wheel, `leaps` pour une vente LEAPS ; une ligne achetée n'en a
  aucune. `UNCOVERED` n'est jamais une répartition : la part nue d'un call relève d'Autres et
  n'apparaît sur aucune des deux pages. Les actions Wheel ont leur propre couverture,
  `coveredShares` (§2.2). *Révisé le 2026-09-15 : la première version montrait les badges de la
  position IB entière, où une vente Wheel pouvait afficher `leaps` et une vente LEAPS `stock`.*

### 3.5 Hors du snapshot

Une ligne dont le contrat n'est pas dans le snapshot — un put vendu aujourd'hui par l'agent après
le Flex d'hier, un historique tronqué, aucun snapshot du tout (`snapshot === null`) — reste
affichée avec sa quantité et son prix du journal ; `lastPrice`, `marketValue`, `unrealizedPnl`,
`decision` et `position` valent `null`.

Une position IB qu'aucune ligne ouverte de la stratégie ne revendique n'apparaît pas : elle
reste sur la page Positions. Un écart de quantité entre journal et snapshot est déjà l'affaire
de la carte Reconstitution de la page Consistance.

### 3.6 Tri

Les `StrategyLine` se trient par ticker, échéance (`null` d'abord), `right`, strike croissant ;
les `WheelShareLine` gardent l'ordre de `wheelHoldings`.

---

## 4. `packages/coverage` — Suggestion de Position

Nouveau fichier `packages/coverage/src/suggestions.ts`, exporté par `src/index.ts`.

### 4.1 Constantes et types

Dans `packages/coverage/src/constants.ts`, une seule définition chacune :

```ts
export const MIN_SUGGESTION_SCORE = 6;
export const MAX_SUGGESTIONS = 20;
/** A ticker already weighing this share of the total risk value, or more, is left out. */
export const MAX_SUGGESTION_TICKER_SHARE = 0.05;
```

Dans `suggestions.ts` :

```ts
/** One row of the sector table, nothing of Dexie. */
export interface SectorEntry {
  ticker: string;
  category: string;
  score: number | null;
  status: string;
}

export interface PositionSuggestion {
  /** 1 for the first row. */
  rank: number;
  ticker: string;
  sector: string;
  score: number;
  /** Risk value of the sector ÷ total risk value; 0 when the total is 0. */
  sectorShare: number;
  /** Risk value of the ticker ÷ total risk value; 0 when the total is 0. */
  tickerShare: number;
}

export function positionSuggestions(entries: readonly SectorEntry[], report: RiskReport | null): PositionSuggestion[];
```

### 4.2 Expositions

- la valeur de risque d'une position est `riskValue` (`report.ts`) : le montant d'assignation
  pour un put vendu (`requiredCash`, 0 pour une jambe de spread), la valeur de marché absolue
  pour tout le reste ; **`null` compte pour 0** ;
- par ticker : clé `tickerOf(position.symbol).toUpperCase()`, la lecture de l'ajout automatique
  à la table sectorielle ;
- par secteur : le secteur d'un ticker est la `category` (espaces retirés) de l'entrée de même
  ticker (espaces retirés, majuscules) quand elle n'est pas vide ; une position sans secteur
  compte sous un groupe « non classé » qu'aucun candidat ne peut porter ;
- le total est la somme sur toutes les positions du rapport, donc du compte affiché ;
- `report === null` : toutes les expositions et le total valent 0.

### 4.3 Éligibilité

Une entrée est candidate quand, à la fois :

- `status.trim().toLowerCase() === "on"` ;
- `category.trim()` n'est pas vide ;
- `score !== null && score >= MIN_SUGGESTION_SCORE` ;
- `tickerShare < MAX_SUGGESTION_TICKER_SHARE`, au sens strict : exactement 5 % écarte.

### 4.4 Tri et coupe

Tri lexicographique sur :

1. exposition du secteur, croissante ;
2. score, décroissant ;
3. exposition du ticker, croissante ;
4. ticker, ordre de chaînes croissant.

Puis coupe aux `MAX_SUGGESTIONS` premiers, `rank` valant la position dans la liste coupée,
à partir de 1.

### 4.5 Écarts à l'outil Python d'origine

- une valeur de risque inconnue compte pour 0 : le Python n'avait jamais de `null` ;
- le statut est comparé sans casse ni espaces, comme le Python qui le normalisait au chargement ;
- aucun repli sur les colonnes `S-*` (§1) ;
- sans snapshot, la liste existe quand même, toutes parts à 0.

---

## 5. Application web

### 5.1 Menu et routes

`apps/web/src/lib/navigation.ts` : les sections `nav.sections.strategyWheel` et
`nav.sections.strategyLeaps` deviennent Journal, Positions, Statistiques. L'entrée réutilise
`labelKey: "nav.positions"` et l'icône `TrendingUp` de la page Positions, et pointe vers
`positions/wheel` ou `positions/leaps`.

`apps/web/src/routes/router.tsx`, sous `/accounts/:accountId` :

```ts
{ path: "positions/wheel", element: <StrategyPositionsPage strategy="wheel" /> },
{ path: "positions/leaps", element: <StrategyPositionsPage strategy="leaps" /> },
```

Le surlignage du menu compare le chemin exact : Positions de la Vue d'ensemble et Positions
Wheel ne s'allument jamais ensemble.

### 5.2 `StrategyPositionsPage`

`apps/web/src/pages/StrategyPositionsPage.tsx`, prop `strategy: "wheel" | "leaps"`.

- titre `strategyPositions.title.<strategy>` : « Positions Wheel », « Positions LEAPS » ;
- lit `useAccountJournals` et `useAccountRiskReport`, jamais `useJournals` ni `useRiskReport` ;
- calcule dans un `useMemo` `wheelPositions` ou `leapsPositions` sur `view.report.rows` et
  `{ positions: snapshot.positions, report }` quand snapshot et rapport existent, `null` sinon ;
- affiche le texte de chargement tant que les journaux ou le rapport chargent.

**Wheel**

1. Carte « Actions assignées », colonnes `WHEEL_SHARE_COLUMNS` (`lib/positionColumns.ts`), en
   disposition fixe :

   | Colonne | Contenu |
   |---|---|
   | Position | ticker |
   | Secteur | `sectorOf(ticker)` en badge |
   | Quantité | `quantity` |
   | Prix moyen | `averageAssignmentPrice` |
   | Prix moyen des calls | `averageCallStrike`, cellule `bg-warning/25` quand `callStrikeBelowAssignment`, info-bulle « Strike moyen des calls sous le prix d'assignation » |
   | Prix total assigné | `assignedTotal` |
   | Dernier prix | `lastPrice` |
   | P&L latent | `unrealizedPnl`, vert si ≥ 0, rouge sinon |
   | Couverture | le badge de la page Positions, `usedBadge(coveredShares, quantity)` (`lib/riskReport.ts`) : « used `coveredShares`/`quantity` » en `success` dès qu'une action est couverte, « unused » en `outline` sinon, non traduit comme les autres badges de couverture (révisé le 2026-09-15 : « couvert x/y » traduit, vert seulement à couverture complète) |

2. Carte « Ventes d'options » : `PositionTable` et `POSITION_COLUMNS`, les dix colonnes de la
   page Positions.

**LEAPS** : cartes « Achats d'options », « Ventes d'options » et « Actions », chacune avec
`PositionTable` et `POSITION_COLUMNS`.

**Cartes vides** : « Actions assignées », « Ventes d'options » et « Achats d'options » restent
affichées avec « Aucune position ouverte dans cette stratégie. » ; la carte « Actions » des LEAPS
n'est pas rendue quand elle est vide.

Toute valeur `null` s'affiche « — ».

### 5.3 Ligne partagée

`PositionRow` sort de `PositionsPage.tsx` vers `apps/web/src/components/PositionRow.tsx` et reçoit
des valeurs prêtes : texte du contrat, type, secteur, valeur de marché, quantité, prix moyen,
dernier prix, P&L latent, décision, badges de couverture déjà calculés. La page Positions
l'alimente depuis `AnalyzedPosition` (`coverageBadges(position)`), la page de stratégie depuis
`StrategyLine` (`strategyCoverageBadges(line)`) ; le texte du contrat d'une `StrategyLine` est
`formatContractLabel(line.contract)`.

`decisionBadge` (`lib/riskReport.ts`) prend la décision seule ; `coverageBadges` accepte `null` et
rend alors une liste vide ; `allocationBadges` rend un badge par répartition, sans `UNCOVERED` ;
`strategyCoverageBadges` rend les répartitions `coverage` d'une vente, le « used x/y » de la
position IB pour un call acheté, rien pour des actions. Le rendu de la page Positions ne change pas : ses tests existants le
gardent.

### 5.4 `PositionSuggestionsCard`

`apps/web/src/components/PositionSuggestionsCard.tsx`, dernière carte du tableau de bord, pleine
largeur, rendue aussi dans la branche sans positions ni statistiques.

- entrées : `useSectors()` converti en `SectorEntry[]` ; rapport : `useAccountRiskReport().report`
  (`null` sans snapshot) ; calcul `positionSuggestions` dans un `useMemo` ;
- titre « Suggestion de Position », puis une phrase qui énonce la règle : score ≥ 6 et statut
  « on », tickers pesant 5 % ou plus du risque exclus, tri par exposition du secteur, puis score,
  puis exposition du ticker, expositions mesurées en valeur de risque ;
- colonnes : `#` (`rank`), Ticker, Secteur, Score, % Secteur exposé (`sectorShare`), % Ticker
  exposé (`tickerShare`) ; pourcentages à une décimale par `formatRate` (`lib/format.ts`), jamais
  par `formatPercent`, qui arrondit à l'entier ;
- liste vide : « Aucune suggestion : aucune ligne de la table sectorielle ne remplit les
  critères. », avec un lien vers la page Secteur et Score ;
- texte de chargement tant que la table sectorielle charge.

### 5.5 Textes

Clés fr et en : `strategyPositions.title.{wheel,leaps}`, `strategyPositions.groups.{assignedShares,
optionSales,optionBuys,shares}`, `strategyPositions.columns.*` pour les colonnes propres aux
actions assignées, `strategyPositions.callBelowAssignment`,
`strategyPositions.empty`, `dashboard.suggestions.{title,rule,empty,emptyLink}` et
`dashboard.suggestions.columns.*`.

---

## 6. Tests

`packages/ledger` (`journals/holdings.test.ts`, lignes produites par `buildJournals` à partir des
fabriques de `journals/fixtures.ts`) :

- un put assigné puis un call vendu : quantité, prix moyen d'assignation, strike du call,
  actions couvertes ;
- deux assignations à des strikes différents : moyenne pondérée, total assigné égal au capital
  `assigned` du ticker ;
- une reprise d'actions au strike d'un call (sous-projet 8) ;
- un call racheté ne compte plus ; deux calls ouverts à des strikes différents se moyennent ;
- un call ouvert sur plus de contrats que d'actions : `coveredShares` plafonné à la quantité ;
- `JournalRow.contract` porté par une option, des actions, un condor et un règlement.

`packages/coverage` (`strategy.test.ts`, `suggestions.test.ts`, positions par
`src/fixtures.ts`) :

- un call vendu partagé entre Wheel et Autres : seule la part Wheel et sa couverture `stock`,
  sans `UNCOVERED` ; un call partagé entre Wheel et LEAPS : `stock` d'un côté, `leaps` de l'autre,
  aucune couverture sur un LEAPS acheté ni sur des actions ; un put vendu : `cash` ;
- un put Wheel absent du snapshot, et `snapshot === null` : prix « — », pas de position ;
- signes de valeur de marché et de P&L latent pour une vente et pour un achat ;
- décision « buy back » à la moitié du prix d'entrée, « keep » au-dessus ;
- `callStrikeBelowAssignment` vrai, faux, et faux sans call ouvert ;
- actions LEAPS livrées par l'exercice d'un LEAPS ;
- l'alignement par indice de `buildRiskReport` ;
- les huit cas de `test_html_report.py` (ordre par exposition puis score, score minimum, statut
  inactif, score ou secteur manquant, plafond de 20, départage par exposition du ticker,
  exclusion à 5 % exactement, mesure en valeur de risque et non en valeur de marché) ;
- statut « On » accepté, valeur de risque inconnue, rapport `null`, `sectorShare` et
  `tickerShare` rendus.

`apps/web`, sur `fake-indexeddb` avec ledger, snapshot et table sectorielle semés en base, jamais
en moquant les hooks :

- `StrategyPositionsPage.test.tsx` : ligne d'actions assignées et sa cellule jaune, vente
  d'option Wheel, les trois cartes LEAPS et la carte Actions absente quand elle est vide, cartes
  vides ;
- `DashboardPage.test.tsx` : ordre, rang et pourcentages des suggestions, état vide et son lien ;
- `PositionsPage.test.tsx` inchangé et vert après l'extraction de `PositionRow` ;
- `navigation.test.ts`, `AppLayout.test.tsx` et `router.test.tsx` suivent le menu et les routes.

---

## 7. Documentation et outillage

- **CLAUDE.md** : ligne 16 du tableau des sous-projets, et deux règles : les positions par
  stratégie se lisent sur les lignes ouvertes du journal (`endWhen === null`) croisées avec le
  snapshot par `contractId`, jamais stockées, la couverture des options réduite à celle de la
  stratégie ; `MIN_SUGGESTION_SCORE`, `MAX_SUGGESTIONS` et
  `MAX_SUGGESTION_TICKER_SHARE` vivent une seule fois dans `packages/coverage`, et l'exposition
  de la suggestion est la valeur de risque du compte affiché, pas le capital des journaux.
- **Graine de démonstration** (`apps/web/src/mocks/seed.ts`) : le compte `beta` porte déjà des
  actions Wheel assignées au strike d'un put (MQZA), un put Wheel ouvert (XOM), un LEAPS et le
  call qu'il couvre (ZZZ), mais aucun call Wheel ouvert. `DEMO_TRANSACTIONS` et `DEMO_POSITIONS`
  (`mocks/journals.ts`) reçoivent un call Wheel MQZA ouvert à un strike inférieur au prix
  d'assignation, pour que `run-frontend --seed` montre la cellule jaune et une couverture ;
  `SAMPLE_JOURNAL_TRANSACTIONS` et `SAMPLE_JOURNAL_SNAPSHOT`, que des tests lisent, ne changent
  pas. Les actions LEAPS restent absentes de la graine : leur carte ne s'affiche pas.
- **`docs/points-reportes.md`** : ce que la revue de branche jugera non bloquant.

---

## 8. Décisions écartées

- **Tout le calcul dans `apps/web/src/lib/`** : les seuils de suggestion deviendraient des
  constantes métier de l'application, et l'agrégat des actions assignées s'éloignerait de
  `capital.ts`, qui lit les mêmes lignes.
- **Tout le calcul dans `packages/ledger`** : impossible sans cycle, `BUYBACK_RATIO` et
  `riskValue` vivant dans `coverage`, qui dépend de `ledger`.
- **Afficher la position IB entière** sur les pages de stratégie : un contrat partagé
  apparaîtrait en entier sur deux pages et mêlerait Wheel et hors-Wheel.
- **Le P&L latent au coût IB** pour les actions assignées : il ferait entrer la plus-value
  d'avant-Wheel, ce que la reprise au strike (sous-projet 8) écarte déjà.
- **Le badge « used x/y » du rapport de risque** pour la couverture des actions assignées : il
  compte toute la position IB, pas la seule part Wheel.
- **La prime des calls** comme « Prix moyen des call » : la comparer au prix d'assignation n'a pas
  de sens ; et **tous les calls vendus depuis l'entrée des actions** : seuls les calls ouverts
  disent à quel prix une assignation vendrait.
- **Mesurer la suggestion sur tous les comptes** : les comptes ne se combinent jamais.
- **Un statut comparé strictement à « on »**, et **une ligne sans secteur rangée sous « Non
  classé »** : le tri par exposition du secteur exige un secteur.
- **Masquer les cartes vides demandées** : seule la carte Actions des LEAPS, rarement remplie,
  disparaît.
