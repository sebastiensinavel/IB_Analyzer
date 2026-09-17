# Sous-projet 20 — Tri et filtres de colonne des tableaux

Statut : implémenté (2026-09-17).

Aucun tableau de l'application ne se trie. L'Historique se filtre par une barre fixe : un champ
symbole, un type unique, deux dates et des raccourcis de période. Positions se filtre par un seul
champ, qui cherche une sous-chaîne dans le libellé du contrat. On ne peut ni classer les positions
par P/L latent, ni isoler les montants supérieurs à 1 000, ni demander deux tickers à la fois.

Ce sous-projet donne à l'Historique et à Positions :

- un **tri** par clic sur l'en-tête, tri secondaire compris ;
- un **filtre par colonne**, écrit dans une petite grammaire (`>100`, `100..500`, `AAPL|MSFT`,
  `—`), ou coché dans la liste des valeurs présentes pour une colonne à valeurs fixes ;
- une **recherche de page** par ticker, commune à tous les tableaux de la page ;
- un état **mémorisé dans `localStorage`, distinct par compte**.

Rien ne quitte le navigateur. `apps/api` ne change pas, IndexedDB non plus : l'état d'affichage
n'est pas une donnée de portefeuille et n'a pas de table Dexie.

---

## 1. Périmètre

Dans le périmètre :

- la page **Historique** : tableau unique, recherche de page, liste Type sortie au-dessus ;
- la page **Positions** (vue d'ensemble) : un état de tri et de filtres par carte de groupe,
  recherche de page commune aux cartes ;
- le moteur pur de critères, de filtrage et de tri (`apps/web/src/lib/`) ;
- les composants `ColumnHeader` et `ActiveFilters`, et `popover` et `checkbox` dans `packages/ui` ;
- le retrait des filtres actuels de l'Historique : champ symbole, `Select` de type, champs de
  date, raccourcis de période (`periodPresets.ts`), et `matchesFilter`, `filterTransactions` et
  `TransactionFilter` de `packages/ledger`.

Hors périmètre, déclaré tel :

- **les pages Positions Wheel et LEAPS** (`StrategyPositionsPage`) et leur table « Actions
  assignées » : elles utilisent `PositionTable`, qui accepte des en-têtes interactifs sans les
  imposer, et pourront suivre dans un autre sous-projet ;
- **la carte « Suggestion de Position »** : ni tri ni filtre n'y ont de sens, elle est déjà
  ordonnée par le moteur ;
- **la carte « Cash »** de Positions : deux ou trois lignes, en-têtes inchangés ;
- **les Journaux, Secteur et Score, Sources, Exposition** ;
- **un filtre de page par secteur** sur Positions : écarté par l'utilisateur.

---

## 2. Grammaire des critères

Une fonction pure, `parseCriterion(text, type)` (`apps/web/src/lib/tableCriteria.ts`), lit une
saisie pour un type de colonne et rend soit un prédicat `(value) => boolean`, soit une erreur.
Une saisie vide ou faite seulement d'espaces ne filtre rien.

### 2.1 Structure commune

- **OU** : alternatives séparées par `|`. `AAPL|MSFT`, `<0|>1000`.
- **ET** : termes séparés par des espaces dans une alternative. `>0 <500`. Le ET lie plus fort
  que le OU : `>0 <500|>10000` se lit « entre 0 et 500, ou plus de 10 000 ».
- **Négation** : `!` devant un terme. `!SPY`, `!10..20`. `!=` reste l'opérateur « différent ».
- **Valeur absente** : `—` ou `-` seul désigne une cellule `null` ; `!—` et `!-` désignent une
  cellule renseignée. **Tout autre terme est faux sur `null`** : `<0` ne ramène pas un P/L
  inconnu, `!SPY` non plus.
- Espaces entre opérateur et valeur tolérés (`> 100`) ; casse ignorée.

### 2.2 Colonnes `number`

- Opérateurs `=`, `!=`, `<`, `<=`, `>`, `>=`. Un nombre seul vaut `=`.
- Plage inclusive `a..b`, bornes facultatives : `..500`, `100..`.
- Nombre : signe `-` facultatif, séparateur décimal `.` ou `,`, aucun séparateur de milliers, `$`
  ignoré. `<-1000`, `1,5`, `$100`.
- Comparaison sur la **valeur brute**, jamais sur l'arrondi affiché.

### 2.3 Colonnes `date`

- La valeur comparée est le jour et l'heure de New York tels qu'affichés, soit la chaîne de
  `formatDateTime` (`YYYY-MM-DD HH:MM:SS`).
- Une date s'écrit `YYYY`, `YYYY-MM` ou `YYYY-MM-DD` et désigne sa **période entière** :
  - `2025-03` seul vaut « pendant mars 2025 » ;
  - `>=2025-03` part du premier instant de mars, `>2025-03` du premier instant d'avril ;
  - `<2025` s'arrête au dernier instant de 2024, `<=2025` au dernier instant de 2025 ;
  - `2024..2025-06` va du 1er janvier 2024 au 30 juin 2025 inclus ;
  - `!=2025` et `!2025` excluent l'année.
- Un mois hors `01..12` ou un jour qui n'existe pas dans son mois (`2025-02-30`) est invalide.

### 2.4 Colonnes `text`

- Par défaut, **sous-chaîne** : `aap` trouve `AAPL 2026-01-16 150 C`.
- `=` demande l'égalité exacte, `!=` son contraire. Le joker `*` n'a de sens qu'après `=` ou
  `!=` : `=AA*` vaut « commence par AA », `=*C` « finit par C ». Hors `=`, `*` est un caractère
  ordinaire.
- `<`, `>` et les plages sont invalides sur une colonne texte.

### 2.5 Colonnes `enum`

Aucune saisie : la valeur du critère est la **liste des valeurs brutes cochées**
(`["trade", "dividend"]`). Une ligne passe si sa valeur est dans la liste ; la case « — » coche
`null`. Liste vide : aucun filtre.

Une colonne **multi-valuée** (Couverture) donne à chaque ligne un ensemble de valeurs : elle passe
si **au moins une** est cochée ; une ligne sans valeur ne passe que si « — » est coché.

### 2.6 Saisie invalide

`parseCriterion` rend `{ ok: false, error }`, avec `error` un code i18n
(`tableFilter.errors.number`, `.date`, `.textOperator`, `.syntax`). Le champ passe en rouge avec
son message, et rien n'est enregistré tant que la saisie reste invalide : seul un critère valide
atteint le hook (§4.3), si bien que le **dernier critère valide reste appliqué** au tableau et en
`localStorage`. Une saisie frappée caractère par caractère applique donc chacun de ses préfixes
valides au passage (`>1` puis `>10` puis `>100`).

---

## 3. Colonnes, filtrage et tri

### 3.1 Définition d'une colonne

Les fichiers de colonnes existants gagnent, par colonne, un **type** et un **accesseur**. La
forme `{ key, width, numeric }` reste, pour que `PositionTable` et `HistoryTable` posent leurs
`colgroup` sans changement.

```ts
type ColumnType = "text" | "number" | "date" | "enum";

interface ColumnSpec<Row> {
  key: string;
  type: ColumnType;
  /** La valeur comparée : null pour « — ». Un tableau pour une colonne enum multi-valuée. */
  value: (row: Row) => string | number | null | readonly string[];
  /** Le libellé d'une valeur enum dans la liste et les pastilles (traduit par l'appelant). */
  label?: (value: string) => string;
  sortable: boolean;
}
```

Les accesseurs vivent près des colonnes :

- `apps/web/src/lib/historyColumns.ts` : `historyColumnSpecs(t)`, sur `LedgerRow` — une fonction,
  les libellés enum se traduisent par `t` ;
- `apps/web/src/lib/positionColumns.ts` : `positionColumnSpecs(sectorOf)`, sur `AnalyzedPosition`
  — une fonction, la colonne Secteur lit la table sectorielle par `sectorOf`.

**Historique** (`LedgerRow`) :

| Colonne | Type | Valeur |
|---|---|---|
| `dateTime` | date | `formatDateTime(transaction.when)` |
| `type` | enum | `transaction.kind` |
| `symbol` | text | le texte affiché : `formatContract(transaction) \|\| transaction.description` |
| `quantity`, `price`, `totalPrice` (`amount`), `fee` (`commission`) | number | le champ, `null` conservé |
| `cash` | number | `row.cash` |
| `currency` | text | `transaction.currency` |
| `usdCash`, `eurCash` | number | `row.balances.USD`, `row.balances.EUR` |

**Positions** (`AnalyzedPosition`) :

| Colonne | Type | Valeur |
|---|---|---|
| `position` | text | `formatContract(position)` |
| `type` | enum | `position.kind`, libellé `position.label` |
| `sector` | enum | `sectorOf(position.symbol)` |
| `marketValue`, `quantity`, `avgPrice`, `lastPrice`, `unrealizedPnl` | number | le champ |
| `decision` | enum | `position.decision` (`keep`, `buy back`, `null`) |
| `coverage` | enum multi, **non triable** | voir ci-dessous |

La valeur de Couverture se **calcule depuis la position**, jamais en relisant le texte des badges :
les sources de ses allocations (`cash`, `stock`, `leaps`, `spread`), plus `UNCOVERED` si
`uncoveredQuantity > 0` ou si une vente n'a aucune allocation ; `used` ou `unused` pour une
position longue (règle de `usedBadge`) ; ensemble vide pour les autres. Elle vit dans
`lib/riskReport.ts`, à côté de `coverageBadges`, qui suit les mêmes branches.

### 3.2 Recherche de page

Un critère de la grammaire texte (§2.4), appliqué au **ticker** de la ligne :

- Historique : `tickerOf(transaction.symbol)`, `null` pour une ligne sans symbole ;
- Positions : `position.symbol`, déjà le sous-jacent pour une option.

`AAPL|MSFT` garde les actions et toutes les options de ces deux tickers. Sur Positions, c'est un
changement voulu : la recherche ne lit plus le libellé du contrat, donc `150` ne trouve plus un
strike ; ce cas passe par le filtre de la colonne Position.

### 3.3 État d'une vue

```ts
interface TableView {
  sort: readonly { column: string; dir: "asc" | "desc" }[];
  /** Saisie texte pour text/number/date, valeurs brutes cochées pour enum. */
  criteria: Readonly<Record<string, string | readonly (string | null)[]>>;
}
```

La recherche de page est une chaîne à part, propre à la page.

### 3.4 `applyView(rows, specs, view, search?)`

Fonction pure (`apps/web/src/lib/tableView.ts`) :

1. garde les lignes qui passent la recherche de page, puis **chaque** critère valide (ET entre
   colonnes) ; un critère invalide ou d'une colonne inconnue est ignoré ;
2. trie de façon **stable** selon `view.sort`, dans l'ordre des clés ; sans clé, l'ordre d'entrée
   est gardé, et c'est l'ordre par défaut de la page.

Comparaison de tri :

- `null` **en fin de liste dans les deux sens** ;
- `number` : numérique ; `date` : la chaîne `formatDateTime`, qui trie comme elle s'affiche ;
- `text` : `Intl.Collator(undefined, { numeric: true, sensitivity: "base" })`, si bien que
  `AAPL 2026-01-16 95 C` précède `AAPL 2026-01-16 150 C` ;
- `enum` : sur le libellé affiché (`label`), à défaut la valeur brute ;
- une colonne `sortable: false` ou inconnue dans `view.sort` est ignorée.

### 3.5 `facetValues(rows, spec, checked)`

Rend les valeurs d'une colonne enum avec leur nombre de lignes, triées par libellé, `null` (« — »)
en dernier s'il existe. Une valeur **cochée absente des lignes** est rendue avec le nombre 0, pour
rester décochable. Une colonne multi-valuée compte chaque valeur une fois par ligne.

Les lignes passées sont, **par décision** :

- Historique : tout le ledger du compte, avant recherche et filtres — un type ne disparaît pas de
  la liste parce qu'un autre filtre a vidé ses lignes ;
- Positions : les positions du groupe dans le snapshot, avant recherche et filtres.

### 3.6 Clics de tri

- Clic simple sur une colonne : si elle est la **seule** clé, `asc` → `desc` → aucune clé ;
  sinon elle devient la seule clé, en `asc`.
- Shift+clic : ajoute la colonne en fin de clés en `asc`, ou fait avancer la sienne
  `asc` → `desc` → retirée, sans toucher aux autres.
- L'en-tête porte `aria-sort` sur la première clé, et affiche ↑/↓ ; avec plusieurs clés, un
  numéro d'ordre (①, ②…).

Fonction pure `nextSort(sort, column, additive)`, testée à part.

---

## 4. Mémorisation

### 4.1 Clés

Préfixe `ib2:` existant (`ib2:theme`, `ib2:lastAccountId`) :

| Clé | Contenu |
|---|---|
| `ib2:tableView:<accountId>:history` | `TableView` de l'Historique |
| `ib2:tableView:<accountId>:positions:<groupId>` | `TableView` d'un groupe (`long`, `optionSells`, `optionBuys`, `other`) |
| `ib2:pageSearch:<accountId>:history` | recherche de page de l'Historique |
| `ib2:pageSearch:<accountId>:positions` | recherche de page de Positions |

Le compte est dans la clé : les filtres d'alpha ne touchent jamais ceux de beta.

### 4.2 Format et relecture

Valeur JSON `{ "v": 1, "sort": [...], "criteria": {...} }` ; la recherche de page, `{ "v": 1,
"text": "..." }`.

- Les enum stockent la **valeur brute** (`trade`, `buy back`, `UNCOVERED`), jamais un libellé
  traduit : passer de fr à en ne perd rien.
- À la relecture, tout ce qui ne se comprend pas est ignoré sans erreur : JSON illisible, `v`
  différent de 1, colonne inconnue, critère texte devenu invalide, sens de tri inconnu. Le reste
  s'applique.
- Chaque lecture et écriture est sous `try/catch` : un `localStorage` absent ou qui lève (navigation
  privée, données bloquées) donne un état vide et l'application fonctionne sans mémoire.
- Une vue vide (aucun tri, aucun critère) **supprime** sa clé au lieu d'écrire un objet vide.

### 4.3 `useTableView(storageKey, specs)` et `usePageSearch(storageKey)`

Hooks de `apps/web/src/hooks/`. Ils lisent l'état à chaque changement de clé — changer de compte
relit la vue de l'autre compte —, exposent `view`, `setCriterion(column, value)`,
`toggleSort(column, additive)`, `clearColumn(column)`, `clearAll()`, et écrivent à chaque
changement valide. La saisie texte en cours, éventuellement invalide, reste un état local du
popover ; seul un critère valide atteint le hook.

La recherche de page garde la temporisation actuelle de 300 ms avant d'être appliquée et
enregistrée.

### 4.4 Suppression d'un compte

`deleteAccount` (`db/accounts.ts`) supprime aussi, après sa transaction, toutes les clés
`ib2:tableView:<id>:` et `ib2:pageSearch:<id>:` (préfixe exact, `:` final compris, pour qu'un id
préfixe d'un autre n'emporte pas ses clés), comme il efface déjà `lastAccountId`. Fonction
`clearTableViews(accountId)` dans `lib/tableViewStorage.ts`.

---

## 5. Interface

### 5.1 `packages/ui`

Ajout de `popover` et `checkbox` par `pnpm dlx shadcn@latest add` (base-ui), imports `@/`
réécrits en relatifs (`packages/ui/README.md`).

### 5.2 `ColumnHeader`

`apps/web/src/components/table/ColumnHeader.tsx`, rendu dans un `TableHead` :

- le libellé est un `button` de tri quand la colonne est triable, avec la flèche et le numéro
  d'ordre (§3.6) ; texte simple sinon ;
- à côté, une icône entonnoir (`lucide-react`) ouvre un popover ; pleine et colorée
  (`text-primary`) quand la colonne a un critère valide ;
- popover d'une colonne `text`, `number` ou `date` : un champ, une aide d'une ligne propre au
  type (`>100 · 10..20 · A|B · —`), le message d'erreur en rouge, un bouton « Effacer » ;
  Entrée ferme le popover ;
- popover d'une colonne `enum` : une case par valeur de `facetValues`, libellé et nombre, puis
  « Effacer ».

La largeur des colonnes ne change pas : icône et flèche tiennent dans la cellule, le libellé se
tronque (`truncate`) comme aujourd'hui dans l'Historique et passe à la ligne dans Positions.

### 5.3 `ActiveFilters`

`apps/web/src/components/table/ActiveFilters.tsx` : au-dessus d'un tableau, une pastille par
colonne au critère valide — `Type : trade, dividend ×`, `P/L latent : <0 ×` — dont la croix
efface la colonne, puis « Tout effacer », qui vide critères et tri du tableau (pas la recherche
de page). Aucun rendu quand aucun critère n'est actif.

Le texte d'une pastille vient de `criterionSummary` (`apps/web/src/lib/criterionSummary.ts`) : la
saisie telle quelle pour une colonne `text`, `number` ou `date`, les libellés cochés pour une
colonne `enum`.

### 5.4 Historique

- **Barre du haut** : la recherche de page (`history.searchPlaceholder`), puis la liste **Type**,
  `Select` base-ui à choix multiple, dont les options sont `facetValues` de la colonne `type`
  (§3.5). Elle lit et écrit **le même critère** que le popover de la colonne Type : cocher dans
  l'une coche dans l'autre.
- Champs de date, `Select` simple, raccourcis de période et `periodPresets.ts` sont retirés.
- Sous la barre, `ActiveFilters` ; la carte du tableau garde `flex-1` dans la colonne à hauteur
  calculée (`100svh - 3rem`).
- **Soldes** : `anchoredBalances` court toujours sur tout le ledger, dans l'ordre chronologique,
  avant `applyView`. Une ligne garde son solde sous tout tri et tout filtre ; filtrer ou trier sur
  `usdCash`/`eurCash` compare ce solde.
- **Ordre par défaut** : date décroissante, l'entrée de `applyView` étant déjà inversée.
- **Barre temporelle** : affichée seulement quand `view.sort` est vide. Sous tout autre tri, date
  croissante comprise, `TimelineScrubber` n'est pas rendu et seule la barre de défilement native
  reste. `HISTORY_ROW_HEIGHT` et la règle de hauteur constante ne changent pas.
- **Retour en haut** : la clé de `HistoryTable` ne porte plus que le compte. Un changement de
  recherche, de critère ou de tri remet `scrollTop` à 0 dans un `useLayoutEffect` sur une
  `resetKey` (`JSON.stringify([search, view])`) et émet un événement `scroll` synchrone pour que
  le virtualiseur suive avant la peinture. Remonter le tableau à chaque frappe fermerait le
  popover de filtre, qui vit dans son en-tête. Une ligne arrivée en direct ne change pas la
  `resetKey`.
- **Aucun résultat** : le tableau reste affiché — en-têtes, popovers, `ActiveFilters` — et
  `history.noResults` s'affiche dans son corps, sous l'en-tête. La carte « Aucun résultat » qui
  remplaçait le tableau disparaît. `HistoryTable` reçoit donc aussi zéro ligne.

### 5.5 Positions

- **Barre du haut** : la recherche de page seule (`positions.searchPlaceholder`), qui remplace le
  champ actuel.
- **Une carte par groupe**, dans l'ordre de `groupedPositions`, chacune avec sa `TableView`
  (`positions:<groupId>`), ses `ColumnHeader`, son `ActiveFilters` entre le titre et le tableau.
  `PositionTableHeader` accepte une prop facultative pour rendre des `ColumnHeader` ; sans elle, il
  rend les en-têtes simples d'aujourd'hui, que gardent la carte Cash et `StrategyPositionsPage`.
- **Ordre par défaut** : celui de `groupedPositions` (tri par `description`).
- **Visibilité d'une carte** :
  - groupe vide dans le snapshot : masqué, comme aujourd'hui ;
  - groupe vidé par la recherche de page : masqué ;
  - groupe non vide après recherche mais vidé par **ses propres critères** : affiché, en-têtes et
    pastilles compris, `positions.noResults` dans le corps du tableau.
- La carte « Aucun résultat » de la page ne s'affiche que si la recherche de page masque tous les
  groupes.
- `sectorOf` vient de `useAccountRiskReport`, comme aujourd'hui ; la carte Cash est inchangée.

### 5.6 Traductions

`apps/web/src/i18n/{fr,en}.json`, nouvel espace `tableFilter` : titres des popovers, aides par
type, « Effacer », « Tout effacer », « — (vide) », libellés de tri pour lecteur d'écran, codes
d'erreur. `history.searchPlaceholder`, `history.kindFilter` (libellé de la liste multiple),
`positions.searchPlaceholder`. Suppression de `history.presets.*`, `history.startDate`,
`history.endDate`, `history.allKinds` et `history.filterPlaceholder`, `positions.filterPlaceholder`
s'ils ne servent plus.

---

## 6. Tests

**Fonctions pures (Vitest, `apps/web/src/lib/`)**

- `tableCriteria.test.ts` : chaque opérateur par type ; plages ouvertes ; OU, ET et leur priorité ;
  négation ; `—`/`-`/`!—` ; tout autre terme faux sur `null` ; `1,5`, `$100`, `<-1000` ; dates
  partielles à chaque borne (`>2025-03`, `>=2025-03`, `<2025`, `<=2025`, `2024..2025-06`,
  `!=2025`) ; `2025-13` et `2025-02-30` invalides ; sous-chaîne, `=`, `!=`, `=AA*`, `=*C`, `*`
  ordinaire hors `=` ; `<` sur texte invalide ; saisie vide sans filtre.
- `tableView.test.ts` : `applyView` (ET entre colonnes, critère invalide ignoré, colonne inconnue
  ignorée, recherche de page sur le ticker, tri stable, `null` en fin dans les deux sens, tri
  secondaire, `95` avant `150`, enum sur libellé, colonne non triable ignorée) ; `facetValues`
  (comptes, `null` en dernier, valeur cochée absente à 0, multi-valuée) ; `nextSort` (cycle simple,
  remplacement par une autre colonne, ajout et retrait par Shift).
- `tableViewStorage.test.ts` : aller-retour, JSON illisible, `v` inconnu, colonne inconnue et
  critère invalide ignorés, vue vide qui supprime la clé, `localStorage` qui lève, isolement
  alpha/beta, `clearTableViews` qui épargne un compte dont l'id a le même préfixe.
- `riskReport.test.ts` : la valeur de Couverture de chaque forme de position, cohérente avec
  `coverageBadges`.

**Pages (Vitest, `fake-indexeddb`, ledger et snapshot semés en base, jamais de hooks moqués)**

- `HistoryPage.test.tsx` : tri par montant puis retour à l'ordre par défaut ; filtre `>1000` ;
  liste Type du haut et popover de colonne synchronisés ; valeurs de Type comptées sur tout le
  ledger ; barre temporelle absente sous un tri, présente sans tri ; solde d'une ligne identique
  filtrée ou non ; filtre qui vide tout garde en-têtes, pastilles et « Tout effacer » ; état
  retrouvé après remontage ; état distinct entre deux comptes ; recherche `AAPL|MSFT` ; saisie
  invalide en rouge sans filtrer ; champs de date et raccourcis absents. Les tests des anciens
  filtres sont retirés.
- `PositionsPage.test.tsx` : recherche `AAPL|MSFT` sur toutes les cartes ; critère d'un groupe
  sans effet sur les autres ; groupe vidé par son critère affiché avec « Aucun résultat » ; groupe
  vidé par la recherche masqué ; tri par P/L latent avec `null` en fin ; filtre Couverture
  `UNCOVERED` ; carte Cash sans en-têtes interactifs.
- `StrategyPositionsPage.test.tsx` : inchangé et vert (en-têtes simples).
- `db/accounts.test.ts` : `deleteAccount` efface les clés du compte, garde celles de l'autre.

**Retraits** : `periodPresets.test.ts`, les tests `matchesFilter`/`filterTransactions` de
`packages/ledger/src/filter.test.ts` (ceux de `dayOf` restent).

**Visuel** : `run-frontend` sur `--seed`, Historique et Positions en fr, clair et sombre, avec un
popover ouvert et des pastilles actives.

Pas de Playwright : aucune interaction avec le serveur n'est concernée.

---

## 7. Documentation

- `CLAUDE.md` : ligne 20 du tableau des sous-projets ; une règle — tri et filtres de l'Historique
  et de Positions sont un état d'affichage en `localStorage`, clé par compte et par tableau
  (`ib2:tableView:`, `ib2:pageSearch:`), jamais en IndexedDB ni sur le serveur ; les `null` trient
  en dernier ; la barre temporelle n'existe que dans l'ordre par défaut ; les soldes se calculent
  avant tout filtre. Retouche de la règle « L'Historique ne pagine pas » (la clé de remontage
  porte la vue).
- `docs/specs/2026-09-03-architecture-design.md` : inchangé, il ne mentionne que « filtres » sans
  les décrire.
- `packages/ledger` : `filter.ts` ne garde que `dayOf` ; exports de `index.ts` ajustés.

---

## 8. Décisions écartées

| Décision | Raison |
|---|---|
| TanStack Table | Son atout est un rendu piloté par les colonnes ; nos lignes sont dessinées à la main (badges, tooltips, couleurs). Un moteur pur d'une centaine de lignes coûte moins qu'une adoption partielle |
| Un seul tableau Positions avec une colonne Groupe | L'utilisateur veut une vraie séparation visuelle, et les colonnes pourront différer d'un groupe à l'autre |
| Un seul état de tri et de filtres pour toute la page Positions | Type, Décision et Couverture n'ont pas le même sens d'un groupe à l'autre : un filtre commun viderait des cartes entières |
| Garder les raccourcis de période en écrivant le filtre Date | Choix de l'utilisateur : une année se filtre en tapant `2025` |
| Garder les anciens filtres de l'Historique à côté des filtres de colonne | Deux sources de vérité pour les mêmes colonnes |
| Filtre Secteur sorti au-dessus de Positions | Jugé inutile par l'utilisateur |
| État dans l'URL | Choix de l'utilisateur : `localStorage`, distinct par compte |
| État en IndexedDB | C'est une préférence d'affichage par navigateur, pas une donnée à sauvegarder ni à relire des imports |
| Tri de la colonne Couverture | Une liste de badges n'a pas d'ordre évident |
| Barre temporelle sous tri par date croissante | Elle suppose l'ordre décroissant ; le cas ne justifie pas de la généraliser |
| Recherche de Positions sur le libellé du contrat | La recherche de page porte sur ce qui a le même sens dans tous les tableaux, le ticker ; le libellé reste filtrable par la colonne Position |
