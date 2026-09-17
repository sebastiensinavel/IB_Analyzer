# Sous-projet 12 — L'Historique en défilement continu

Statut : implémenté (2026-09-11).

La page Historique pagine 30 lignes à la fois, avec deux boutons Précédent et Suivant. Alpha,
dont les relevés remontent à 2022, en compte plus de 80 pages : atteindre une date ancienne coûte
des dizaines de clics, et un numéro de page ne dit rien de la période qu'il couvre.

Ce sous-projet remplace la pagination par **un seul tableau virtualisé qui défile**, bordé d'une
**barre temporelle** qui porte les années et les mois et permet d'y sauter d'un geste, et ajoute
des **puces de période** à côté des champs de date.

---

## 1. Périmètre

Dans le périmètre :

- le tableau de l'Historique défile dans sa carte, en-tête des colonnes figé, seules les lignes
  visibles rendues (`@tanstack/react-virtual`) ;
- une barre temporelle au bord droit du tableau, au prorata des lignes, pilotable au pointeur et
  au clavier ;
- des puces de période : une par année présente dans le ledger, « 12 derniers mois », « 30
  derniers jours », « Tout » ;
- la suppression de la pagination et de ses clés i18n `history.pagination.*`.

Hors périmètre, déclaré tel :

- **mémoriser la position de défilement** d'une visite à l'autre de la page ;
- **porter le mois courant dans l'URL** ;
- **l'état d'erreur de l'Historique**, déjà noté dans `docs/points-reportes.md` (« Sans
  échéance »), qui y reste ;
- **un nouveau calcul** : `anchoredBalances`, `matchesFilter` et l'ordre des lignes ne changent
  pas. Les soldes restent calculés sur tout le ledger, jamais sur les lignes filtrées.

---

## 2. Disposition

La page occupe la hauteur de l'écran sous la barre de titre (`h-[calc(100svh-3rem)]`, la barre
faisant `h-12`), en colonne flex :

```
┌ Historique ─────────────────────────── état ┐
│ [symbole] [type ▾] [du] [au]                 │  ne défile pas
│ (Tout)(30 jours)(12 mois)(2026)(2025)…       │
├───────────────────────────────────────┬─────┤
│ Date   Type   Symbole  …   Cash USD    │ 2026│  carte : flex-1 min-h-0
│───────────────────────────────────────│  ─  │  en-tête figé
│ …                                     │▐███▌│  fenêtre visible
│ …          (défile ici)               │ 2025│
│ …                                     │  ─  │
└───────────────────────────────────────┴─────┘
```

Seul le tableau défile : titre, filtres et puces restent accessibles. Sur un écran étroit, les
filtres passent à la ligne et le tableau garde la hauteur restante. La barre de défilement native
reste, fine (`scrollbar-width: thin`), entre le tableau et la barre temporelle : la masquer
masquerait aussi la barre horizontale, indispensable sous la largeur minimale du tableau.

Quand aucune ligne ne correspond, la carte « Aucune transaction ne correspond. » remplace tableau
et barre, comme aujourd'hui.

---

## 3. Unités

### 3.1 `apps/web/src/lib/historyTimeline.ts` — pur

Toute la logique de la barre, en index de ligne : la barre et le tableau partagent un seul repère,
l'index de ligne rapporté au nombre de lignes.

```ts
export interface TimelineMonth {
  month: string;  // "YYYY-MM", lu par when.slice(0, 7), la même coupe UTC que dayOf
  start: number;  // index, dans les lignes affichées, de la première ligne du mois
  count: number;
}
export type TimelineStep = "nextMonth" | "previousMonth" | "nextYear" | "previousYear" | "first" | "last";
export interface YearMark { year: string; start: number }

/** `whens` dans l'ordre du tableau, les plus récentes d'abord. */
export function buildTimeline(whens: readonly string[]): TimelineMonth[];
/** Index dans `timeline` du mois qui contient la ligne `rowIndex` ; -1 sur une frise vide. */
export function monthIndexAt(timeline: readonly TimelineMonth[], rowIndex: number): number;
/** "2025-01" décalé de -1 vaut "2024-12". */
export function shiftMonth(month: string, delta: number): string;
/** La ligne où mène une touche, depuis la première ligne visible (§3.4). */
export function stepTarget(timeline: readonly TimelineMonth[], total: number, firstVisible: number, step: TimelineStep): number;
/** La ligne à `fraction` de la hauteur du tableau, bornée à [0, total − 1]. */
export function rowAtFraction(total: number, fraction: number): number;
/** Les libellés d'année d'une piste de `height` px, sans chevauchement de moins de `minGap` px. */
export function yearMarks(timeline: readonly TimelineMonth[], total: number, height: number, minGap: number): YearMark[];
```

Un mois est une **suite contiguë** de lignes de même clé : la frise décrit ce que le tableau
montre, sans supposer un tri qu'elle ne vérifie pas. La somme des `count` vaut toujours le nombre
de lignes. Les clés `"YYYY-MM"` se comparent comme des chaînes.

### 3.2 `apps/web/src/lib/periodPresets.ts` — pur

```ts
export type PeriodPresetId = "all" | "last30Days" | "last12Months" | `year:${number}`;
export interface PeriodPreset { id: PeriodPresetId; from: string; to: string }  // "" pour « Tout »

/** Années présentes dans ces instants, les plus récentes d'abord. */
export function yearsOf(whens: readonly string[]): number[];

/** `today` en "YYYY-MM-DD", jour UTC. Ordre : Tout, 30 jours, 12 mois, puis les années. */
export function periodPresets(years: readonly number[], today: string): PeriodPreset[];

/** La puce dont les deux dates sont exactement celles des champs, sinon null. */
export function activePreset(presets: readonly PeriodPreset[], from: string, to: string): PeriodPresetId | null;
```

- **Année** `y` : du `y-01-01` au `y-12-31`. Les années viennent du **ledger entier** du compte,
  jamais des lignes filtrées — une puce ne disparaît pas parce qu'un filtre la vide — et jamais
  d'une liste codée en dur.
- **12 derniers mois** : du même jour un an plus tôt à `today` ; un 29 février retombe sur le
  28 février.
- **30 derniers jours** : de `today − 30 jours` à `today`.
- **Tout** : les deux champs vides.

Un clic sur une puce remplit les deux champs de date, qu'on peut ensuite retoucher à la main ; la
puce active porte `aria-pressed="true"` et la variante pleine. `today` est calculé par la page
(`new Date().toISOString().slice(0, 10)`), jamais par le module.

### 3.3 `apps/web/src/components/history/HistoryTable.tsx`

Le conteneur de défilement, le tableau et la barre temporelle.

- **Colonnes et constantes** : `apps/web/src/lib/historyColumns.ts` porte `HISTORY_COLUMNS` (ordre,
  largeur en pourcentage, caractère numérique et solde des onze colonnes, sur le modèle de
  `POSITION_COLUMNS`), `HISTORY_ROW_HEIGHT`, `HISTORY_HEADER_HEIGHT` et `SCRUB_LABEL_LINGER_MS`.
  Le tableau est en `table-fixed` avec un `<colgroup>` et une largeur minimale : sans largeurs
  fixes, les colonnes changeraient de taille au fil du défilement, puisque les lignes rendues
  changent.
- **Pas de composant `Table`** de `@ib/ui` : son enveloppe `overflow-x-auto` deviendrait l'ancêtre
  de défilement de l'en-tête, qui se collerait à elle et non au conteneur. Le composant pose son
  propre `<table>` et garde `TableHeader`, `TableRow`, `TableHead`, `TableCell`. Le conteneur est
  une région (`role="region"`, `tabIndex={0}`) nommée par le titre de la page (`aria-labelledby`).
- **Hauteur de ligne constante** : `HISTORY_ROW_HEIGHT` (36 px), une seule constante. Chaque
  cellule du corps est en `h-9` sans padding vertical, tronquée, jamais à la ligne ; le tableau
  est en bordures séparées et la bordure est portée par la cellule, à l'intérieur de sa hauteur.
  `useVirtualizer` reçoit cette hauteur en `estimateSize` et ne mesure rien. C'est ce qui rend la
  barre temporelle exacte : la ligne `i` commence à `i × HISTORY_ROW_HEIGHT`.
- **Virtualisation** : `@tanstack/react-virtual` (`^3.14.11`, dépendance de production
  d'`apps/web`) ; seules les lignes visibles, plus une marge (`overscan` de 10), sont rendues ; une
  ligne vide en haut et une en bas, `aria-hidden`, portent la hauteur des lignes absentes. Clé de
  ligne : `externalId`. `useFlushSync: false` (React 19 avertit sur un `flushSync` en cycle de
  vie) ; `isScrollingResetDelay: SCRUB_LABEL_LINGER_MS`.
- **Saut** : la barre demande une ligne, le tableau écrit `scrollTop = index × HISTORY_ROW_HEIGHT`
  et le virtualiseur suit l'événement `scroll`. Jamais `scrollToOffset` ni `scrollToIndex`, qui
  appellent `Element.scrollTo` : jsdom ne l'a pas, et l'appel y serait silencieusement ignoré.
- **Retour en haut** : la page monte `HistoryTable` avec pour `key` le compte et les valeurs des
  filtres (symbole après l'anti-rebond, type, dates — une puce passe par les dates). Un changement
  de filtre ou de compte remonte le tableau : le nouveau conteneur part de 0 avant toute peinture,
  le pendant du retour en page 1 d'aujourd'hui, sans une image des nouvelles lignes à l'ancienne
  position. Une ligne arrivée en direct (synchro, agent) garde la même clé et laisse le lecteur où
  il est.
- **Ce que la barre reçoit** : `firstVisible = ⌊scrollOffset / HISTORY_ROW_HEIGHT⌋` borné aux
  lignes, `visibleCount = ⌊(hauteur − HISTORY_HEADER_HEIGHT) / HISTORY_ROW_HEIGHT⌋` (au moins 1),
  la hauteur du conteneur et `isScrolling`.

### 3.4 `apps/web/src/components/history/TimelineScrubber.tsx`

Composant de présentation, sans état de données :

```ts
interface TimelineScrubberProps {
  timeline: readonly TimelineMonth[];
  total: number;          // nombre de lignes
  firstVisible: number;   // index de la première ligne visible
  visibleCount: number;
  height: number;         // hauteur de la piste en px : celle du conteneur de défilement
  scrolling: boolean;     // le tableau défile, ou s'est arrêté il y a moins de SCRUB_LABEL_LINGER_MS
  onSeek(rowIndex: number): void;  // amène cette ligne en haut du tableau
}
```

**Un seul repère de coordonnées : l'index de ligne rapporté à `total`.**

- Chaque année est écrite à la hauteur `start / total` de son premier mois ; un libellé qui
  tomberait à moins de 16 px du précédent est omis (`yearMarks`). Chaque mois porte un tiret à sa
  hauteur.
- La fenêtre visible est un bloc de `firstVisible / total` à `(firstVisible + visibleCount) /
  total` : elle recouvre exactement les mois à l'écran.
- **Pointeur** : un appui sur la piste capture le pointeur ; à la hauteur `f`,
  `onSeek(rowAtFraction(total, f))`, et de même à chaque déplacement jusqu'au relâchement. Un
  déplacement sans appui ne fait que désigner une ligne. Le navigateur borne lui-même le
  défilement en fin de tableau.
- **Étiquette flottante** : le mois de la ligne désignée par le pointeur, sinon celui de
  `firstVisible` (« mars 2024 »), à gauche de la piste, pendant le survol et le glisser, et
  pendant un défilement ordinaire jusqu'à `SCRUB_LABEL_LINGER_MS` (1 s) après son arrêt — c'est
  `isScrolling` du virtualiseur, remis à faux après ce délai.
- **Clavier** : `role="slider"`, `aria-orientation="vertical"`, `aria-valuemin` 0,
  `aria-valuemax` `total − 1`, `aria-valuenow` `firstVisible`, `aria-valuetext` le mois de
  `firstVisible`, libellé accessible traduit (`history.timeline`). Les cibles viennent de
  `stepTarget` :
  - ↓ : début du mois suivant (plus ancien), rien au plus ancien ; ↑ : début du mois courant si la
    première ligne visible n'y est pas déjà, sinon début du mois précédent (plus récent) ;
  - Page ↓ : début du plus récent des mois dont la clé est au moins douze mois avant celle du
    mois courant, sinon début du mois le plus ancien ; Page ↑ : début du plus ancien des mois dont
    la clé est au moins douze mois après celle du mois courant, sinon ligne 0 ;
  - Début : ligne 0 ; Fin : ligne `total − 1`.

Le libellé du mois vient de `formatMonth(month, locale)` (`apps/web/src/lib/format.ts`),
`Intl.DateTimeFormat` en `{ month: "long", year: "numeric", timeZone: "UTC" }`.

### 3.5 `apps/web/src/pages/HistoryPage.tsx`

Garde l'état des filtres, l'anti-rebond, `anchoredBalances` et le filtrage ; perd `page`,
`PAGE_SIZE` et les boutons ; donne un `id` (`useId`) à son titre, qui nomme la région du tableau ;
ajoute la rangée de puces sous les filtres (`role="group"` nommé `history.presets.label`) et rend
`HistoryTable` avec sa `key` de filtres. `TransactionRow` suit dans `HistoryTable`.

---

## 4. i18n

Suppression de `history.pagination.*` dans `fr.json` et `en.json`. Ajouts, fr puis en :

| Clé | fr | en |
|---|---|---|
| `history.presets.label` | Période | Period |
| `history.presets.all` | Tout | All |
| `history.presets.last30Days` | 30 derniers jours | Last 30 days |
| `history.presets.last12Months` | 12 derniers mois | Last 12 months |
| `history.timeline` | Frise chronologique | Timeline |

Les puces d'année affichent le nombre seul, sans clé.

---

## 5. Tests

Vitest, TDD. Un test doit échouer si le comportement change.

- **`historyTimeline.test.ts`** : mois du plus récent au plus ancien avec `start` et `count`
  exacts ; une ligne à `2026-03-31T23:30:00Z` compte en mars ; somme des `count` égale au nombre de
  lignes ; lignes non triées décrites telles quelles ; liste vide → aucun mois ; `monthIndexAt` aux
  bornes d'un mois et `-1` sur frise vide ; `shiftMonth` à cheval sur une année ; chaque
  `TimelineStep`, dont les deux replis de Page ↓ et Page ↑ ; `rowAtFraction` borné ; `yearMarks`
  complet sur une grande piste, avec une année omise sur une petite.
- **`periodPresets.test.ts`** : années tirées des instants, décroissantes, sans doublon ;
  « 12 derniers mois » depuis un 29 février → 28 février ; « 30 derniers jours » à cheval sur un
  mois et sur une année ; puce active trouvée, `null` après une retouche, « Tout » active sur deux
  champs vides.
- **`TimelineScrubber.test.tsx`** : `aria-valuetext` et `aria-valuenow` suivent `firstVisible` ; les
  années sont écrites ; chaque touche appelle `onSeek` avec la cible de `stepTarget`, une autre
  touche rien ; un appui à 75 % de la piste appelle `onSeek(⌊0,75 × total⌋)` (rectangle de la
  piste simulé) et affiche le mois, un glisser suit, un déplacement après relâchement ne cherche
  rien ; l'étiquette apparaît avec `scrolling` et disparaît au repos.
- **`HistoryPage.test.tsx`** : tous les tests existants gardés, sur une taille simulée (jsdom ne
  mesure rien ; sans taille, le virtualiseur ne rend aucune ligne). `@tanstack/virtual-core` lit
  `offsetWidth`/`offsetHeight` et se passe de `ResizeObserver`, que jsdom n'a pas : simuler
  `offsetHeight` suffit, aucune doublure n'est posée dans `vitest.setup.ts`. Le test de pagination
  est remplacé par :
  - colonnes aux largeurs de `HISTORY_COLUMNS`, en-têtes dans l'ordre ;
  - avec 200 lignes, le DOM en contient bien moins de 200, et plus de bouton Suivant ;
  - écrire `scrollTop` en bas du conteneur puis émettre `scroll` rend la ligne la plus ancienne ;
  - un changement de filtre remet le défilement à 0 ;
  - Fin sur la barre écrit `scrollTop = (total − 1) × HISTORY_ROW_HEIGHT` ;
  - une puce d'année remplit les deux champs de date, ne laisse que les lignes de cette année,
    passe `aria-pressed` ; « Tout » vide les champs.

**Vérification réelle** : le driver `run-frontend` capture la démonstration (clair, sombre,
400 px). Le driver ne sachant ni défiler ni glisser, un script Playwright jetable, hors du dépôt,
importe les relevés et le Flex de alpha depuis `private/`, puis défile, glisse et saute ; il
vérifie que chaque ligne mesure `HISTORY_ROW_HEIGHT`, que seule la carte défile, que l'en-tête
reste figé et que le mois annoncé par la barre est celui de la première ligne visible. Aucun
scénario e2e ne mentionne la pagination.

---

## 6. Documentation

- `CLAUDE.md` : ligne 12 au tableau des sous-projets, et une règle — l'Historique ne pagine pas ;
  ses lignes ont une hauteur constante (`HISTORY_ROW_HEIGHT`), dont dépend l'exactitude de la barre
  temporelle ; la barre et les puces d'année suivent respectivement les lignes filtrées et le
  ledger entier ; un filtre remonte le tableau, une ligne en direct non ; la position s'écrit dans
  `scrollTop`.
- Dette relevée en revue : `docs/points-reportes.md`, section du sous-projet 12.

---

## 7. Décisions écartées

- **Pagination enrichie** (première et dernière page, saisie du numéro, taille de page) : on
  navigue toujours à l'aveugle, un numéro de page ne dit pas quelle période il couvre.
- **Grille en `div` avec rôles ARIA** : perd la sémantique native et le style du tableau de
  `@ib/ui` pour une seule page.
- **`content-visibility: auto` sans virtualisation** : le navigateur ne peint pas les lignes
  hors écran, mais React crée encore quelque 26 000 cellules à chaque frappe et à chaque passe
  de l'agent.
- **Barre temporelle à mois réguliers** : le repère avancerait par saccades et un glisser ne
  suivrait pas le défilement.
- **Défilement de la page entière** : les filtres disparaîtraient en descendant.
- **Barre de défilement native masquée** : masquerait aussi la barre horizontale.
- **Hauteur de ligne mesurée** : autoriserait des cellules sur deux lignes, mais rendrait la
  position d'un mois approximative tant que les lignes n'ont pas été rendues.
- **Retour en haut par un effet** qui remet `scrollTop` à 0 : le virtualiseur rendrait une image les
  lignes de son ancienne position, jusqu'à l'événement `scroll` ; remonter le tableau n'a pas ce
  décalage.
