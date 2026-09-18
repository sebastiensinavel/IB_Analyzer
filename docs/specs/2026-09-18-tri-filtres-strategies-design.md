# Sous-projet 21 — Recherche, tri et filtres des pages de stratégie

Statut : implémenté (2026-09-18).

Le sous-projet 20 a donné à l'Historique et à la page Positions de la vue d'ensemble une
recherche par ticker, un tri et un filtre par colonne, mémorisés par compte. Il s'était
explicitement arrêté là : les pages Positions Wheel et LEAPS étaient déclarées hors périmètre,
et les Journaux gardaient leur unique champ « Filtrer sur le ticker… », qui ne cherche qu'une
sous-chaîne.

Ce sous-projet étend le mécanisme aux pages de stratégie et en ajoute deux :

- **Positions Wheel et LEAPS** reçoivent la recherche par ticker, les boutons d'expiration et
  les en-têtes de colonne triables et filtrables ;
- **Positions Condors** et **Positions Autres** sont créées, avec le même équipement ;
- les quatre **Journaux** reçoivent la même recherche de page et des en-têtes de colonne
  triables et filtrables sur leurs dix-sept colonnes.

Le travail est d'abord un travail de mise en commun : le moteur (`lib/tableCriteria.ts`,
`lib/tableView.ts`, `useTableView`, `ColumnHeader`, `ActiveFilters`) est déjà générique sur la
ligne et ne change pas. Ce qui est cloué sur `AnalyzedPosition` — `PositionTable` et
`PositionGroupCard` — devient générique, et les six pages s'y branchent.

Rien ne quitte le navigateur. `apps/api` ne change pas, IndexedDB non plus : l'état d'affichage
n'est pas une donnée de portefeuille et n'a ni table Dexie ni endpoint.

---

## 1. Vocabulaire

Un **encadré** est le bloc titré qui porte un tableau : son titre, ses pilules de filtre actif
et sa grille. La page Positions de la vue d'ensemble en montre quatre (Positions longues,
Achats d'options, Ventes d'options, Autres positions) plus l'encadré Cash. C'est l'unité que ce
document manipule : un encadré a sa propre vue mémorisée, apparaît et disparaît d'un bloc.

Les « carte Cash » et « carte Cohérence du cash » déjà nommées ainsi dans CLAUDE.md gardent leur
nom : ce sous-projet ne les touche pas.

---

## 2. Périmètre

Dans le périmètre :

- les pages **Positions Wheel** et **Positions LEAPS** (`StrategyPositionsPage`), table
  « Actions assignées » comprise ;
- deux pages neuves, **Positions Condors** et **Positions Autres**, servies par le même
  composant ;
- les quatre pages **Journal** (Wheel, LEAPS, Condors, Autres) ;
- la généralisation de `PositionTable` et `PositionGroupCard`, et le passage de la page
  Positions de la vue d'ensemble sur les composants généralisés, à comportement inchangé ;
- dans `packages/coverage`, une fonction unique de positions de stratégie remplaçant
  `wheelPositions` et `leapsPositions`, étendue aux Condors et à Autres.

Hors périmètre, déclaré tel :

- la **carte Cash** de la vue d'ensemble : deux ou trois lignes, en-têtes inchangés, et aucune
  page de stratégie n'en porte ;
- la **carte « Suggestion de Position »**, déjà ordonnée par le moteur ;
- l'**Historique**, **Secteur et Score**, **Sources**, **Consistance**, les pages de
  **statistiques** et le **tableau de bord** ;
- le **serveur** et l'**agent local** : aucun changement.

---

## 3. Briques partagées

### 3.1 `components/table/DataTable.tsx`

Remplace `PositionTable` et `PositionTableHeader`, qui disparaissent.

```ts
export interface ColumnDef {
  key: string;
  /** Part de la table ; absente, la table est en disposition automatique. */
  width?: string;
  numeric: boolean;
}
```

`<DataTable columns minWidth>` pose un `colgroup` et `table-fixed` quand les colonnes ont une
largeur — c'est le cas des dix colonnes de Positions et des neuf de la Wheel —, et laisse la
disposition automatique quand elles n'en ont pas : le tableau des Journaux garde ainsi ses
colonnes dimensionnées par leur contenu et son défilement horizontal, sans que personne ait à
mesurer dix-sept largeurs.

`<DataTableHeader columns labelKey interactive?>` pose la ligne d'en-tête. `labelKey` est le
préfixe i18n des libellés (`positions.columns`, `strategyPositions.columns`,
`journal.columns`). Sans `interactive`, des `TableHead` simples ; avec, un `ColumnHeader` par
colonne, inchangé. `InteractiveHeader` devient générique sur la ligne.

`HistoryTable` garde son en-tête propre : il est virtualisé et collant, et n'entre pas dans ce
moule.

### 3.2 `components/table/FilteredTableBox.tsx`

L'encadré générique, sur une ligne `Row` :

```ts
interface FilteredTableBoxProps<Row> {
  /** Absent : pas d'en-tête de carte — le cas des Journaux, dont le titre est celui de la page. */
  title?: string;
  columns: readonly ColumnDef[];
  labelKey: string;
  minWidth?: string;
  specs: readonly ColumnSpec<Row>[];
  /** Toutes les lignes de l'encadré, avant recherche et filtres : ce que comptent les facettes. */
  facetRows: readonly Row[];
  /** Les lignes retenues, dans l'ordre du tri : ce que montre la grille. */
  rows: readonly Row[];
  table: TableViewState;
  /** Clé i18n de la ligne affichée quand `rows` est vide. */
  emptyKey: string;
  rowKey: (row: Row) => string;
  renderRow: (row: Row) => ReactNode;
}
```

Il rend la carte, les pilules `ActiveFilters`, l'en-tête interactif et le corps ; `rows` vide
donne une ligne unique sur toute la largeur portant `t(emptyKey)`. Le calcul des facettes — une
entrée par colonne `enum`, comptée sur `facetRows` — vient de `PositionGroupCard`, qui
disparaît au profit de ce composant.

### 3.3 `lib/tableBoxes.ts`

Pur, testé une fois, il porte la règle qui décide des encadrés visibles. Elle se dit en deux
temps, parce que la barre d'expiration se construit entre les deux :

```ts
export interface TableBoxInput<Row> { id: string; title?: string; all: readonly Row[] }
export interface SearchedBox<Row> extends TableBoxInput<Row> { searched: Row[] }
export interface PreparedBox<Row> extends SearchedBox<Row> { facetRows: readonly Row[]; rows: Row[] }

export function searchBoxes<Row>(
  boxes: readonly TableBoxInput<Row>[],
  specs: readonly ColumnSpec<Row>[],
  search: PageSearch<Row>,
): SearchedBox<Row>[];

export function filterBoxes<Row>(
  boxes: readonly SearchedBox<Row>[],
  specs: readonly ColumnSpec<Row>[],
  views: Readonly<Record<string, TableView>>,
  expiryActive: boolean,
): PreparedBox<Row>[];

export function activeExpiry(
  choices: readonly ExpiryChoice[],
  ids: readonly string[],
  views: Readonly<Record<string, TableView>>,
): string | null;
```

`searchBoxes` porte les deux premières règles :

1. `all` vide — la stratégie n'a rien de ce type — : **l'encadré est écarté**, sans jamais avoir
   été rendu.
2. `searched = applyView(all, specs, EMPTY_VIEW, search)`. Vide : **écarté**. La recherche porte
   sur le ticker, qui veut dire la même chose dans tous les encadrés, et s'efface depuis le haut
   de la page : la faire disparaître ne coince personne.

La page construit alors la barre d'expiration sur les `searched` de **tous** les encadrés
survivants, puis lit l'expiration active avec `activeExpiry` — un libellé n'est actif que s'il
est le critère de la colonne `Position` de **tous** les encadrés déclarés de la page.

`filterBoxes` porte les trois dernières :

3. `rows = applyView(searched, specs, views[id])`. Vide **et** `expiryActive` : **écarté** — une
   expiration choisie vide par construction le tableau des actions, qui n'a pas d'expiration, et
   montrer une grille que rien ne peut remplir n'apprend rien.
4. Vide sans expiration active : **l'encadré reste**, avec sa ligne « Aucune position ne
   correspond. » et ses pilules, seul endroit d'où ses propres filtres de colonne s'effacent.
5. `facetRows` vaut toujours `all` : les facettes comptent l'encadré entier, avant recherche et
   avant filtres, comme aujourd'hui.

Le découpage en deux temps est ce qui garde l'expiration choisie dans la barre : les lignes d'un
encadré que l'expiration vide ont déjà nourri les choix, et le bouton reste donc cliquable pour
être défait.

Quand la liste rendue est vide, la page affiche l'encart « Aucune position ne correspond. ».

Une page dont les encadrés n'ont pas tous le même type de ligne — la Wheel, dont les actions
assignées sont des `WheelShareLine` et les ventes d'options des `StrategyLine` — appelle ces
fonctions une fois par type et rend les résultats dans l'ordre déclaré : chaque appel reste
typé, aucun transtypage n'est nécessaire.

La page Positions de la vue d'ensemble se refait dessus : la règle n'existe qu'une fois. Son
comportement ne change pas, et `PositionsPage.test.tsx` doit passer sans retouche — c'est le
filet de sécurité du portage.

### 3.4 `components/table/PageSearchInput.tsx`

Le champ de recherche par ticker, identique sur les six pages : même libellé grisé, même
grammaire (`AAPL`, `AAPL|MSFT`, `!SPY`), même débounce, même mémorisation. Ses libellés
deviennent des clés partagées `search.placeholder` et `search.label` ; `positions.searchPlaceholder`,
`positions.searchLabel` et `journal.filterPlaceholder` disparaissent.

---

## 4. Les quatre pages Positions de stratégie

Un seul composant, `StrategyPositionsPage`, de prop `strategy: "wheel" | "leaps" | "condors" | "others"`.

### 4.1 Le moteur : une fonction unique dans `packages/coverage`

`wheelPositions` et `leapsPositions` sont remplacées par :

```ts
export interface StrategyPositions {
  /** Wheel seule : ses actions assignées, telles qu'aujourd'hui. */
  shares: WheelShareLine[];
  /** Les lignes ouvertes de la stratégie, rangées par groupe de DETAIL_GROUPS. */
  groups: Record<DetailGroupId, StrategyLine[]>;
}

export function strategyPositions(
  rows: readonly JournalRow[],
  strategy: PositionsStrategy,
  snapshot: PricedSnapshot | null,
): StrategyPositions;
```

Quatre changements au moteur existant :

- **`PositionsStrategy` devient les quatre stratégies** (`Strategy` de `@ib/ledger`).
- **`LINE_KIND` apprend `long_put` → `long_put` et `short_shares` → `short_stock`.** Un condor a
  des ailes achetées, et une vente à découvert peut tomber dans Autres. `condor` et `settlement`
  n'y entrent pas : un composite est lu sur ses jambes (ci-dessous) et un règlement en espèces
  n'a pas de quantité, donc `strategyLines` l'ignore déjà.
- **Les condors sont lus sur leurs jambes** : les lignes sont aplaties par `rows.flatMap((row) =>
  row.legs ?? [row])` avant tout filtrage. Un composite porte un contrat sans `right` ni
  `strike` : aucune position du snapshot ne lui répond, il ne se valorise pas. Ses quatre jambes,
  elles, portent un vrai contrat et se valorisent comme n'importe quelle autre ligne. Un condor
  partiellement racheté produit plusieurs composites, chacun avec ses jambes à l'échelle des
  unités concernées ; `strategyLines` les regroupe par contrat et les somme, donc la page montre
  bien ce qui reste ouvert.
- **Pour la Wheel, `groups.long` reste vide** : ses actions sont les `WheelShareLine` de
  `shares`, et les montrer deux fois serait un doublon.

Le rangement d'une ligne dans un groupe suit `DETAIL_GROUPS`, comme la vue d'ensemble :
`long_stock` → `long`, `long_call`/`long_put` → `optionBuys`, `short_call`/`short_put` →
`optionSells`, le reste → `other`.

### 4.2 Les encadrés de chaque page

Une table unique, `STRATEGY_BOXES` (`apps/web/src/lib/strategyBoxes.ts`), dit quels encadrés
chaque page porte, dans quel ordre, sous quel titre. Les ordres et les titres existants ne
bougent pas.

| Page | Encadrés, dans l'ordre | Clé de titre |
|---|---|---|
| Wheel | Actions assignées | `strategyPositions.groups.assignedShares` |
| | Ventes d'options | `positions.groups.optionSells` |
| LEAPS | Achats d'options | `positions.groups.optionBuys` |
| | Ventes d'options | `positions.groups.optionSells` |
| | Actions | `strategyPositions.groups.shares` |
| Condors | Achats d'options | `positions.groups.optionBuys` |
| | Ventes d'options | `positions.groups.optionSells` |
| Autres | Positions longues | `positions.groups.long` |
| | Achats d'options | `positions.groups.optionBuys` |
| | Ventes d'options | `positions.groups.optionSells` |
| | Autres positions | `positions.groups.other` |

`strategyPositions.groups.optionSales` et `strategyPositions.groups.optionBuys` deviennent
inutiles — les titres partagés portent le même texte — et disparaissent.
`strategyPositions.empty` disparaît aussi : un encadré sans ligne ne se rend plus.

Un encadré déclaré mais vide n'apparaît pas : la Wheel ne montrera jamais « Achats d'options »,
les Condors ne montreront « Achats d'options » que s'ils ont des ailes ouvertes.

### 4.3 Colonnes

Les encadrés de lignes de stratégie reprennent `POSITION_COLUMNS`, les dix colonnes partagées,
comme aujourd'hui. Leurs specs vivent dans `apps/web/src/lib/strategyColumns.ts` :

```ts
export function strategyColumnSpecs(sectorOf: SectorOf, strategy: PositionsStrategy): ColumnSpec<StrategyLine>[];
export function wheelShareColumnSpecs(sectorOf: SectorOf): ColumnSpec<WheelShareLine>[];
```

`strategyColumnSpecs` — mêmes clés et même ordre que `POSITION_COLUMNS` :

| Colonne | Type | Valeur |
|---|---|---|
| `position` | text | `formatContractLabel(line.contract)` |
| `type` | enum | `line.kind`, libellé `KIND_LABELS` |
| `sector` | enum | `sectorOf(line.contract.ticker)` |
| `marketValue`, `quantity`, `avgPrice`, `lastPrice`, `unrealizedPnl` | number | le champ homonyme |
| `decision` | enum | `line.decision` |
| `coverage` | enum, non triable | `strategyCoverageValues(line, strategy)` |

`wheelShareColumnSpecs` — mêmes clés et même ordre que `WHEEL_SHARE_COLUMNS` : `position` en
texte sur `line.ticker`, `sector` en enum, les six colonnes chiffrées en nombre, et `coverage`
en enum non triable valant `["used"]` ou `["unused"]` selon `coveredShares`.

### 4.4 Recherche et expirations

Le champ de recherche par ticker est celui de §3.4. Le ticker d'une `StrategyLine` est
`line.contract.ticker`, celui d'une `WheelShareLine` est `line.ticker`.

Les boutons d'expiration sont ceux de la vue d'ensemble (`ExpiryFilterBar`, `expiryChoices`,
`reportToday`), construits sur les **seules options de la stratégie affichée** : les expiries des
`StrategyLine` de la page (`line.contract.expiry`), jamais celles du portefeuille entier. Ils
suivent la recherche par ticker et ignorent les filtres de colonne, comme sur la vue d'ensemble,
sans quoi l'expiration choisie serait la seule encore proposée. Aucune option à venir : aucun
bouton.

Choisir une expiration écrit son libellé (`Oct16'26`) dans le critère de la colonne `Position`
de **tous** les encadrés de la page, exactement comme si on l'avait tapé là — c'est le mécanisme
existant. Sur le tableau « Actions assignées », dont la colonne `Position` porte un ticker, il ne
correspond à rien : l'encadré se vide et disparaît, comme le tableau des actions de la vue
d'ensemble.

### 4.5 Colonne Couverture

`STRATEGY_COVER_SOURCES` gagne `condors: ["spread"]`. Une jambe vendue de condor montre donc son
badge `spread ×n`, venu de l'allocation calculée par le moteur de couverture.

Autres est le cas particulier : la part nue n'est **jamais** une allocation — `UNCOVERED` n'en
est pas une, par construction du moteur. Or une vente du journal Autres est précisément ce que
rien ne couvre, et sa quantité *est* la part nue, le moteur ayant déjà séparé la part couverte,
qui vit dans la Wheel ou dans les LEAPS. Une vente d'Autres affiche donc `UNCOVERED ×n`, `n` étant
sa quantité en valeur absolue, sans rien lire du snapshot.

Deux fonctions dans `lib/riskReport.ts`, la seconde nouvelle :

```ts
export function strategyCoverageBadges(line: StrategyLine, strategy: PositionsStrategy): CoverageBadge[];
export function strategyCoverageValues(line: StrategyLine, strategy: PositionsStrategy): string[];
```

| Ligne | Badges | Valeurs filtrables |
|---|---|---|
| Vente, Wheel ou LEAPS | allocations de la stratégie (`cash`/`stock`, `leaps`) | leurs sources |
| Vente, Condors | allocations `spread` | `["spread"]` |
| Vente, Autres | `UNCOVERED ×n`, `n` étant la quantité de la ligne en valeur absolue | `["UNCOVERED"]` |
| Achat d'option (`long_call`, `long_put`) | `used x/y` ou `unused` | `["used"]` ou `["unused"]` |
| Actions | aucun | `[]` |

Le filtre lit les valeurs, jamais le texte des badges : c'est la règle existante de CLAUDE.md,
et `strategyCoverageValues` est ce qui la tient sur ces pages.

---

## 5. Les quatre pages Journal

Le tableau et ses jambes dépliables ne changent pas. Deux ajouts.

### 5.1 Recherche de page

Le champ « Filtrer sur le ticker… », qui cherche une sous-chaîne, devient le champ partagé de
§3.4 : même libellé grisé, même grammaire (`AAPL|MSFT`, `!SPY`), même débounce, mémorisé par
compte et par stratégie. Il porte sur `row.ticker`.

### 5.2 Colonnes

`apps/web/src/lib/journalColumns.ts` porte `JOURNAL_COLUMNS` — les dix-sept clés existantes,
dans l'ordre existant, avec leur `numeric` actuel et **sans largeur** — et
`journalColumnSpecs(t)` :

| Colonnes | Type | Valeur |
|---|---|---|
| `startWhen` | date | `formatDateTime(row.startWhen)` |
| `endWhen` | date | `formatDateTime(row.endWhen)`, `null` si la ligne est ouverte |
| `label`, `ticker` | text | le champ homonyme |
| `note` | text | le commentaire **traduit**, celui qu'on lit ; `null` sans note |
| `quantity`, `openPrice`, `openTotal`, `openCommission`, `openNet`, `closePrice`, `closeTotal`, `closeCommission`, `closeNet`, `pnl` | number | le champ homonyme |
| `assigned`, `ongoing` | enum | `"1"` ou `"0"`, comme la cellule les écrit |

Toutes sont triables. Un `null` trie en dernier dans les deux sens et n'est retenu que par `—`,
comme partout ailleurs : c'est le moteur existant.

### 5.3 Jambes

**Le tri et les filtres ne portent que sur les lignes de tête.** Une jambe reste accrochée à son
condor et s'affiche, dans l'ordre que le moteur lui donne, quand on le déplie. Filtrer les
jambes séparément détacherait une jambe de son composite ou ferait disparaître un condor dont
une jambe correspond : ni l'un ni l'autre n'a de sens pour un journal dont la ligne de tête est
l'unité comptable.

### 5.4 Encadré et messages

La page rend un encadré sans titre — le `h1` nomme déjà la stratégie. La stratégie sans aucune
ligne garde l'encart « Aucune position pour cette stratégie. » (`journal.empty`). La recherche
qui ne ramène rien donne l'encart « Aucune position ne correspond. » (`journal.noResults`). Un
filtre de colonne qui ne ramène rien laisse l'encadré en place, avec ses pilules et la même
phrase dans la grille : la règle de §3.3, sans exception.

---

## 6. Routes, navigation, libellés

Deux routes neuves sous le compte, à côté de `positions/wheel` et `positions/leaps` :

```
positions/condors  ->  <StrategyPositionsPage strategy="condors" />
positions/others   ->  <StrategyPositionsPage strategy="others" />
```

`NAV_SECTIONS` gagne une entrée « Positions » dans la section Condors, entre Journal et
Statistiques, et une dans la section Autres, sous Journal ; icône `TrendingUp`, comme les autres
entrées Positions.

`strategyPositions.title` gagne `condors` (« Positions Condors ») et `others` (« Positions
Autres »), et leurs équivalents anglais sur la forme des deux existants.

---

## 7. Ce qui est mémorisé

Toujours dans `localStorage`, jamais dans IndexedDB ni sur le serveur, une clé par compte et par
tableau, toutes effacées par `clearTableViews` au préfixe — donc avec le compte :

| Clé | Ce qu'elle garde |
|---|---|
| `ib2:tableView:<compte>:positions:<groupe>` | vue d'ensemble, inchangée |
| `ib2:tableView:<compte>:positions:<stratégie>:<groupe>` | un encadré de lignes d'une page de stratégie |
| `ib2:tableView:<compte>:positions:wheel:shares` | le tableau « Actions assignées » |
| `ib2:tableView:<compte>:journal:<stratégie>` | le tableau d'un journal |
| `ib2:pageSearch:<compte>:positions` | recherche de la vue d'ensemble, inchangée |
| `ib2:pageSearch:<compte>:positions:<stratégie>` | recherche d'une page de stratégie |
| `ib2:pageSearch:<compte>:journal:<stratégie>` | recherche d'un journal |

Chaque page appelle `useTableView` une fois par encadré déclaré, dans un ordre fixe : le nombre
d'encadrés d'une page est connu à la compilation, jamais calculé au rendu.

---

## 8. Tests

Le principe : **le moteur est testé à fond une fois, les pages reçoivent un test de fumée.** La
grammaire des critères, le tri, la persistance et le panneau de colonne sont déjà couverts par
`tableCriteria.test.ts`, `tableView.test.ts`, `tableViewStorage.test.ts`, `useTableView.test.tsx`
et `ColumnHeader.test.tsx` : aucune page ne les rejoue.

- `packages/coverage/src/strategy.test.ts` (à la main, comme tout `coverage`) : les condors lus
  sur leurs jambes, y compris un condor partiellement racheté ; le rangement par groupe des
  quatre stratégies ; `groups.long` vide pour la Wheel ; les sources de couverture par stratégie.
- `apps/web/src/lib/tableBoxes.test.ts` : les cinq règles de §3.3, une fois.
- `apps/web/src/lib/strategyColumns.test.ts` et `journalColumns.test.ts` : chaque spec extrait la
  valeur que la cellule affiche, et son type, sur le modèle de `positionColumns.test.ts`.
- `apps/web/src/pages/StrategyPositionsPage.test.tsx` : ajusté, pas réécrit. Les encadrés attendus
  par stratégie, la recherche qui fait disparaître un encadré, un bouton d'expiration qui filtre,
  un filtre de colonne qui laisse l'encadré en place.
- `apps/web/src/pages/JournalPage.test.tsx` : ajusté. La recherche, un tri, un filtre, et les
  jambes qui restent sous leur condor quand la vue change.
- `apps/web/src/pages/PositionsPage.test.tsx` : **inchangé**, et il doit passer. C'est lui qui
  prouve que le portage sur les composants génériques n'a rien changé à la vue d'ensemble.

---

## 9. Documentation à mettre à jour

Dans `CLAUDE.md` :

- la règle « Hors Historique et Positions, aucun tableau n'est triable » devient fausse : les
  pages Positions de stratégie et les Journaux le sont aussi, les autres tableaux ne le sont
  toujours pas ;
- la liste des clés `localStorage` gagne les formes de §7 ;
- la règle sur `wheelPositions`/`leapsPositions` cite désormais `strategyPositions` et les quatre
  stratégies, et dit que les condors se lisent sur leurs jambes ;
- la règle sur `STRATEGY_COVER_SOURCES` gagne `spread` pour les Condors et la part nue d'Autres ;
- le tableau des sous-projets gagne la ligne 21.
