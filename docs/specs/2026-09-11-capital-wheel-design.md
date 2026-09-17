# Sous-projet 13 — Capital et exposition de la Wheel

Statut : implémenté (2026-09-11).

La page Statistiques Wheel dit ce que la stratégie a gagné, mois par mois, mais pas avec quel
argent. Une prime de 150 USD ne vaut pas la même chose sur 3 000 USD immobilisés que sur 30 000,
et rien ne montre où ce capital est engagé.

Ce sous-projet ajoute à la page trois graphiques : l'**exposition par secteur** (camembert), le
**capital de la stratégie** mois par mois (lignes droites) et le **rendement mensuel** (ligne
droite). Tous se calculent dans le navigateur, à partir des lignes du journal Wheel.

---

## 1. Périmètre

Dans le périmètre :

- un champ `strike` sur `JournalRow` ;
- une fonction pure `computeWheelCapital` dans `packages/ledger/src/journals/capital.ts`, et son
  résultat dans `JournalsReport.wheelCapital` ;
- la plage de mois des statistiques prolongée jusqu'au mois de la dernière transaction du compte ;
- trois cartes sur la page `stats/wheel`, leurs options ECharts dans `apps/web/src/lib/wheelCharts.ts` ;
- cinq teintes catégorielles et un gris dans `apps/web/src/lib/chartColors.ts`.

Hors périmètre, déclaré tel :

- **la valeur de marché** : une action assignée compte au strike auquel elle est entrée dans la
  Wheel, même quand le marché est bien en dessous ;
- **l'exposition sectorielle passée** : le camembert montre l'état courant, jamais un mois donné ;
- **LEAPS et Condors** : leurs pages ne reçoivent aucun des trois graphiques ;
- **la conversion de devises** : tout reste par devise, comme les statistiques existantes
  (`docs/points-reportes.md`) ;
- **une vue tableau des deux graphiques en lignes** : légende, étiquettes de fin de courbe et
  infobulle suffisent ; le camembert a son tableau-légende (§4.1) ;
- **le multiplicateur réel d'une option** : `Transaction` n'en porte pas, le calcul prend
  `DEFAULT_MULTIPLIER`.

---

## 2. Ce qui compte

Seules comptent les lignes `strategy === "wheel"` de deux sortes :

| `kind` | Montant | Nom |
|---|---|---|
| `short_put` | `strike × DEFAULT_MULTIPLIER × \|quantity\|` | cash pour les puts |
| `shares` | `openPrice × \|quantity\|` | assigné |

- Une action livrée par un put assigné a pour `openPrice` le strike du put. Une action reprise par
  un call couvert (sous-projet 8) a pour `openPrice` le strike du call : elle compte aussi comme
  assignée.
- Un call vendu ne demande aucun cash : les actions le couvrent.
- Une ligne est **ouverte à la fin du mois M** quand `startWhen < D` et que `endWhen` est `null` ou
  `endWhen ≥ D`, où `D` est le premier jour du mois suivant (`"2026-09-01"` pour août). Les
  comparaisons se font sur les chaînes ISO, comme `monthOf`, donc en UTC.
- **On lit `endWhen`, jamais `ongoing`.** Un put assigné reste `ongoing` tant que ses actions ne
  sont pas vendues. Il cesse pourtant de compter à l'instant de l'assignation, et ses actions
  commencent à compter au même instant : les lire tous deux ouverts compterait le même argent deux
  fois.
- Le mois en cours n'a pas de cas particulier : aucune transaction n'existe après la dernière, donc
  sa fin de mois est l'état à ce jour.
- Une ligne dont le montant est incalculable (`strike`, `openPrice` ou `quantity` à `null`) ne
  compte pas et incrémente `incomplete`, une fois par ligne.

---

## 3. `packages/ledger`

### 3.1 `JournalRow.strike`

```ts
/** Option: the contract's strike. `null` for shares and for a condor composite. */
strike: number | null;
```

Posé par `buildRow` depuis `lot.contract.strike`. Toutes les fabriques de lignes (condor,
règlement, reprise) le renseignent ; les tests existants qui comparent une ligne entière sont mis
à jour.

### 3.2 Plage de mois

`computeStats(rows, strategy, lastWhen)` reçoit `lastWhen`, le `when` le plus récent de toutes les
transactions passées à `buildJournals`, ou `null` sans transaction. Les mois vont du premier flux
jusqu'au plus tardif de deux mois : celui du dernier flux, et celui de `lastWhen`. Les mois
ajoutés valent 0. La règle vaut pour les trois stratégies : l'histogramme LEAPS ou Condors gagne
lui aussi ses mois vides jusqu'à aujourd'hui. Sans ligne pour la stratégie, `computeStats` rend
toujours `[]`.

### 3.3 `computeWheelCapital`

```ts
export interface WheelMonth {
  /** YYYY-MM, the same months as the Wheel's StrategyStats, index for index. */
  month: string;
  cumulativePnl: number;
  assigned: number;
  putCash: number;
  /** assigned + putCash */
  allocated: number;
  /** allocated − cumulativePnl */
  invested: number;
  /** This month's pnl / allocated; `null` when allocated is 0. */
  returnRate: number | null;
}

export interface WheelExposure {
  ticker: string;
  assigned: number;
  putCash: number;
}

export interface WheelCapital {
  currency: string;
  months: WheelMonth[];
  /** Lines still open (`endWhen === null`), summed per ticker; only non-zero tickers, sorted by ticker. */
  exposure: WheelExposure[];
  /** Lines left out for want of a strike, a price or a quantity. */
  incomplete: number;
}

export function computeWheelCapital(rows: readonly JournalRow[], stats: readonly StrategyStats[]): WheelCapital[];
```

- Une entrée par élément de `stats` (les statistiques Wheel), dans le même ordre. Les mois
  reprennent ceux de `StrategyStats.months`, et `cumulativePnl` et `returnRate` se calculent à
  partir de leurs `pnl`. Cela garantit que l'histogramme et les deux courbes partagent le même axe.
- `JournalsReport` gagne `wheelCapital: WheelCapital[]`, calculé dans `buildJournals` après
  `computeStats`.
- `exposure` vaut l'état en fin du dernier mois, par construction. Un ticker est une clé :
  l'identité de contrat a déjà été résolue par le rejeu.

---

## 4. `apps/web` : la page

Sur `StatsPage`, uniquement quand `strategy === "wheel"`, après la carte « Profits/pertes
mensuels », dans cet ordre. Les trois cartes suivent le sélecteur de devise existant : elles lisent
l'élément de `view.report.wheelCapital` dont la devise est celle affichée.

### 4.1 Exposition par secteur

- Le secteur d'un ticker est `sectorOf(ticker)`, lu dans `useAccountRiskReport()`. Un ticker
  inconnu de la table sectorielle tombe dans le groupe « Non classé », traité comme un secteur.
- Groupes triés par total (`assigned + putCash`) décroissant, puis par nom. **Cinq parts nommées
  au plus.** Au-delà, les cinq premières gardent leur part et le reste forme une part « Autres »,
  grise : jamais plus de six parts.
- À côté du camembert, sous lui en largeur étroite, un **tableau-légende** liste **tous** les
  groupes, sans repli : pastille (la couleur de la part, grise pour un groupe replié), secteur,
  assigné, puts, total, part en %.
- Infobulle d'une part : secteur, total, part en %.
- `exposure` vide : pas de camembert, le texte « Aucune position Wheel ouverte. ».

### 4.2 Capital de la stratégie

- Quatre séries `type: "line"`, `smooth: false`, dans cet ordre de teintes : cumul des
  profits/pertes, assigné, alloué, cash investi. Toutes dans la devise affichée, sur **un seul
  axe Y**.
- Légende au-dessus, étiquette de fin de courbe (`endLabel`) portant le nom de la série.
- Infobulle d'axe avec réticule : les quatre valeurs du mois survolé, `formatAmount` et devise.
- `incomplete > 0` : la note « n montants absents ignorés » sous le graphique (clé existante
  `stats.incomplete`).

### 4.3 Rendement mensuel

- Une série `smooth: false`, `returnRate` en %, sans légende : le titre nomme la série.
- Ligne de base à 0 % (`markLine`).
- `returnRate === null` : un trou dans la courbe, `connectNulls: false`. Jamais 0 %.
- Infobulle d'axe : `formatRate` (une décimale), « — » pour un mois sans rendement.

### 4.4 Options ECharts

`apps/web/src/lib/wheelCharts.ts`, fonctions pures sans React :

```ts
export interface SectorSlice { sector: string; assigned: number; putCash: number; total: number; share: number; folded: boolean }
export function sectorSlices(exposure: readonly WheelExposure[], sectorOf: (ticker: string) => string | null, unclassified: string): SectorSlice[];
export function exposureOption(slices: readonly SectorSlice[], other: string, colors: ChartColors, currency: string): EChartsOption;
export function capitalOption(capital: WheelCapital, names: CapitalSeriesNames, colors: ChartColors): EChartsOption;
export function returnOption(capital: WheelCapital, colors: ChartColors): EChartsOption;
```

`ChartColors` est un type nouveau, `ReturnType<typeof chartColors>`, exporté par
`lib/chartColors.ts` ; `EChartsOption` vient du paquet `echarts`. `CapitalSeriesNames` porte les
quatre noms de séries traduits (§5).

Les libellés arrivent traduits : les fonctions n'appellent pas `t`. `StatsPage` assemble, et
chaque graphique a son `data-testid` (`exposure-chart`, `capital-chart`, `return-chart`).

### 4.5 Couleurs

`CHART_COLORS` gagne `series` (cinq teintes, ordre fixe) et `other` (le gris de « Autres »), tirés
de la palette de référence du skill `dataviz` :

| | bleu | orange | aqua | jaune | magenta | gris |
|---|---|---|---|---|---|---|
| clair | `#2a78d6` | `#eb6834` | `#1baf7a` | `#eda100` | `#e87ba4` | `#898781` |
| sombre | `#3987e5` | `#d95926` | `#199e70` | `#c98500` | `#d55181` | `#898781` |

Validées par `validate_palette.js` contre les surfaces de carte réelles (`--card`, `#ffffff` en
clair, `#0b0e11` en sombre) : tout passe. En clair, l'aqua, le jaune et le magenta restent sous 3:1
de contraste, ce qui impose étiquettes visibles ou vue tableau. Les étiquettes de fin de courbe
(§4.2) et le tableau-légende (§4.1) remplissent cette condition.

Les courbes de capital prennent toujours les teintes 1 à 4. Le camembert les attribue par rang de
total : changer de devise peut donc changer la couleur d'un secteur. Le tableau-légende nomme
chaque part, si bien que la couleur ne porte jamais seule l'identité.

---

## 5. Traductions

`fr` et `en`, sous `stats` :

| Clé | fr | en |
|---|---|---|
| `exposure.title` | Exposition par secteur | Exposure by sector |
| `exposure.empty` | Aucune position Wheel ouverte. | No open Wheel position. |
| `exposure.sector` | Secteur | Sector |
| `exposure.assigned` | Assigné | Assigned |
| `exposure.putCash` | Couverture des puts | Put coverage |
| `exposure.total` | Total | Total |
| `exposure.share` | Part | Share |
| `exposure.unclassified` | Non classé | Unclassified |
| `exposure.other` | Autres | Other |
| `capital.title` | Capital de la stratégie | Strategy capital |
| `capital.cumulativePnl` | Cumul des profits/pertes | Cumulative P/L |
| `capital.assigned` | Assigné | Assigned |
| `capital.allocated` | Alloué | Allocated |
| `capital.invested` | Cash investi | Cash invested |
| `return.title` | Rendement mensuel | Monthly return |

---

## 6. Tests

`packages/ledger` :

- `capital.test.ts` : put vendu puis racheté dans le mois (0 en fin de mois) ; put ouvert à cheval
  sur deux mois ; put assigné, puis actions revendues deux mois plus tard (le montant passe des puts
  à l'assigné le mois de l'assignation, sans double compte) ; actions reprises au strike d'un call ;
  vente partielle d'actions ; mois à `allocated = 0` (`returnRate` nul) ; `cumulativePnl` et
  `invested` ; ligne sans strike (`incomplete`) ; exposition par ticker sur les seules lignes
  ouvertes ; lignes LEAPS et Others ignorées ; deux devises.
- `stats.test.ts` : mois prolongés jusqu'au mois de `lastWhen`, zéros compris ; `lastWhen`
  antérieur au dernier flux sans effet ; `lastWhen` nul.
- `rows.test.ts` et les tests qui comparent une ligne entière : `strike` renseigné.
- L'oracle des journaux (`flex_journals_corpus.xml`) garde zéro écart de reconstitution.

`apps/web` :

- `wheelCharts.test.ts` : « Non classé » ; repli au-delà de cinq groupes, tableau complet ; tri à
  égalité ; ordre des séries de capital ; trous du rendement ; ligne de base à 0.
- `StatsPage.test.tsx`, sur `fake-indexeddb` avec un ledger Wheel et une table sectorielle semés :
  les trois graphiques rendus, le tableau-légende avec ses secteurs et montants, un ticker inconnu
  en « Non classé », le texte vide sans position ouverte, aucun des trois sur la page LEAPS.
- Capture `run-frontend --seed` de la page, en clair et en sombre. La graine gagne ce qu'il lui
  faut pour montrer un put ouvert, des actions assignées et au moins deux secteurs.

---

## 7. Documentation

- `CLAUDE.md` : ligne 13 du tableau des sous-projets ; une règle « la somme assignée se compte au
  prix d'entrée dans la Wheel, jamais à la valeur de marché, et un put cesse de compter à son
  `endWhen`, jamais à son `ongoing` ».
- `docs/points-reportes.md` : ce que la revue de branche reportera.

---

## 8. Décisions écartées

| Écarté | Pourquoi |
|---|---|
| Mesurer le capital au pic ou en moyenne du mois | Choix de l'utilisateur : la fin de mois, le mois en cours sur ses transactions |
| Compter les actions à la valeur de marché | Demande explicite : le strike d'assignation, même sous le marché |
| Exclure les actions reprises par un call couvert | Choix de l'utilisateur : elles sont dans le journal Wheel, elles comptent au strike du call |
| Calculer dans `StatsPage` | Le métier vit dans les paquets, testé sans React |
| Rejouer les transactions à part | Refaire l'appariement des journaux, deux vérités |

**Révisé le 2026-09-12, à la demande de l'utilisateur** : le **rendement mensuel** se mesure au
**pic du mois**, le plus d'argent immobilisé à la fois pendant le mois (`peakDuring`,
`packages/ledger/src/journals/capital.ts`), et non plus sur l'alloué de fin de mois. Un put
racheté ou un Condor clôturé en perte avant la fin du mois laissait `allocated = 0`, donc un trou
à la place d'un rendement négatif. `returnRate` ne vaut plus `null` que pour un mois sans rien
d'immobilisé (§4.3). Une ligne passe la main à l'instant où elle se termine : un put assigné et
ses actions ne comptent jamais ensemble. Les courbes de capital restent en fin de mois.
| Relire le strike dans `label` | Fragile ; le lot le connaît déjà |
| Couleur fixe par secteur | Impose soit plus de huit teintes, soit un cycle ; le tableau-légende nomme chaque part |
| Vue tableau des graphiques en lignes | Choix de l'utilisateur |
