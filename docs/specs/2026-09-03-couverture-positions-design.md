# Sous-projet 2 — Couverture et positions au palier 2

> Spec validé en brainstorming le 3 septembre 2026. Décline le spec fondateur
> `2026-09-03-architecture-design.md` (§6.3, §6.4, §6.7, §6.8, §9, §11, §12), qui reste la
> référence pour tout ce qui n'est pas précisé ici. Le sous-projet 1
> (`2026-09-03-socle-historique-design.md`) fixe les conventions de `ledger`, `ib-parsers`
> et de la base Dexie que ce spec étend.

---

## 1. Périmètre

Livrer les pages Positions et Dashboard sans serveur ni agent : un import Flex contenant
Open Positions et Cash Report suffit à voir chaque position, sa couverture, la décision de
rachat, le cash requis contre le cash disponible et les positions non couvertes.

**Dans le périmètre :**

- `packages/coverage` : port TS du moteur `ib_analysis`, vérifié par oracle et par les tests
  Python portés un par un.
- `tools/coverage-oracle` : l'ancien moteur Python gelé, ses tests, le générateur de fixtures.
- `packages/ledger` : type `Position`.
- `packages/ib-parsers` : lecture d'Open Positions et de Cash Report dans le Flex XML,
  fixture régénérée.
- `apps/web` : cache des positions et table sectorielle en IndexedDB, import CSV de la
  table sectorielle, pages Positions et Dashboard copiées de l'ancien frontend, carte
  sectorielle sur Sources de données.
- Mise à jour de `CLAUDE.md`, du spec fondateur et de `docs/points-reportes.md`.

**Hors périmètre :**

- Tout ce qui dépend de l'agent : bouton Actualiser, positions intraday, page Aujourd'hui
  (sous-projet 4).
- Agrégations par secteur et primes (sous-projet 5, avec l'appariement des journaux).
- Positions dérivées du ledger : écartées par le spec fondateur §13.

**Constat corrigé :** l'ancien moteur fait 803 lignes en un fichier et **115 tests**, pas 197.
Le chiffre 197 était celui de tout l'ancien backend. `CLAUDE.md` et le spec fondateur sont
corrigés dans ce sous-projet.

---

## 2. `packages/ledger` : type `Position`

Le type d'entrée commun du moteur vit à côté de `Transaction` : c'est le modèle de données
du compte, `ib-parsers` en dépend déjà, et `coverage` n'a pas à être une dépendance d'un
parseur. Graphe : `ledger` ← `ib-parsers`, `ledger` ← `coverage`, tous ← `apps/web`.

```ts
interface Position {
  /** Sous-jacent pour une option, symbole du titre sinon. */
  symbol: string;
  /** "STK", "OPT", "FOP", "WAR"… tel que la source le rapporte. */
  secType: string;
  right: "C" | "P" | "";
  strike: number | null;
  /** YYYY-MM-DD */
  expiry: string | null;
  multiplier: number | null;
  /** Signée : une position courte est négative. */
  quantity: number;
  /** Par unité (par action, par unité de sous-jacent pour une option). */
  avgPrice: number | null;
  marketPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  currency: string;
  /** Identifiant de contrat IB ; "" quand la source ne le donne pas. */
  conid: string;
  description: string;
}
```

`avgPrice` est **par unité** quelle que soit la source. Flex le donne ainsi
(`costBasisPrice`). TWS donne `averageCost` par contrat : la division par le multiplicateur
que faisait `analyze()` en Python appartient à l'adaptateur agent du sous-projet 4, pas au
moteur. Un montant absent reste `null`, jamais `0`.

---

## 3. `packages/coverage`

### 3.1 Forme du port

Port ligne à ligne de `ib_analysis`, fonction par fonction, même ordre de passes. Le moteur
travaille sur des copies mutables internes, comme le Python, et remplace `id(p)` par une
`Map` d'identité d'objet. Ce que le Python exposait en propriétés devient des **fonctions
pures exportées** sur une sortie JSON plate, comme le faisait déjà l'ancien
`frontend/src/lib/riskReport.ts`.

Entrée : `buildRiskReport(positions: Position[], cashAvailable: number | null): RiskReport`.

Sortie, en camelCase :

```ts
interface CoverageAllocation { source: CoverSource; quantity: number; detail: string }

interface AnalyzedPosition {
  description: string;
  kind: PositionKind;            // short_call | short_put | long_call | long_put | long_stock | short_stock | other
  label: string;                 // KIND_LABELS[kind], anglais, affiché tel quel
  marketValue: number | null;
  quantity: number;
  avgPrice: number | null;
  lastPrice: number | null;
  unrealizedPnl: number | null;
  action: "to evaluate" | "ignore";
  decision: "buy back" | "keep" | null;
  symbol: string; secType: string; right: string;
  strike: number;                // 0 quand absent, comme en Python
  expiry: string;                // YYYY-MM-DD, "" quand absent
  multiplier: number;
  allocations: CoverageAllocation[];
  uncoveredQuantity: number;
  usedQuantity: number;
  requiredCash: number;
  riskNotes: string[];
}

interface Structure {
  symbol: string; expiry: string; kind: StructureKind;   // iron condor | call spread | put spread
  contracts: number; callRisk: number; putRisk: number; credit: number;
}

interface RiskReport {
  cashAvailable: number | null;
  positions: AnalyzedPosition[];
  structures: Structure[];
}
```

`sector`, `fetched_at` et `stale` de l'ancien contrat n'y sont pas : ce sont des données du
cache et de la jointure sectorielle, pas du moteur.

### 3.2 Modules

| Fichier | Contenu |
|---|---|
| `constants.ts` | `BUYBACK_RATIO = 2`, `MAX_STRUCTURE_LOSS = 1000`, `DEFAULT_MULTIPLIER = 100`, `KIND_LABELS`, sources de couverture (`cash`, `stock`, `leaps`, `spread`, `UNCOVERED`), sortes de structures, `DETAIL_GROUPS`. **Seule définition dans tout le dépôt.** |
| `classify.ts` | `classify`, `contractMultiplier`, `describeContract`, `evaluateBuyback`, `analyze` |
| `coverage.ts` | `computeCoverage` et les trois passes : structures à risque défini par expiry, calls courts par actions puis LEAPS, puts courts par cash |
| `report.ts` | `buildRiskReport`, `cashRequired`, `putCashRequired`, `ironCondorCashRequired`, `cashOk`, `uncovered`, `shortStock`, `ironCondors`, `breaches`, `moderateShortCalls`, `issues`, `isOk`, `riskValue`, `structureMaxLoss`, `structureAssignmentCash`, `structureOk`, `structureDescription`, `groupedPositions` |
| `format.ts` | `fmtNum` et `fmtMoney`, reproduction de `:g` et `:,.2f` de Python |

### 3.3 Règles portées, et les trois écarts explicites

Tout le reste est le Python tel quel. Les écarts, chacun testé :

1. **`avgPrice` par unité** (§2) : `analyze` ne divise plus par le multiplicateur.
2. **`null` en entrée.** Les champs d'affichage (`marketValue`, `avgPrice`, `lastPrice`,
   `unrealizedPnl`) traversent `analyze` sans modification et s'affichent « — ». Là où le
   moteur calcule avec un prix de vente absent, `null` vaut `0` : `evaluateBuyback` rend
   `keep` quand `avgPrice` est `null` (comme un prix de vente nul en Python), le crédit
   d'une structure et le coût moyen des actions comptent `0`. Un prix courant
   (`marketPrice`) absent ne vaut en revanche jamais `0` : la décision elle-même devient
   `null` plutôt que de fabriquer un « buy back » à partir d'une donnée qu'on n'a pas ;
   `riskValue` d'une position sans `marketValue` rend aussi `null`. Les fixtures d'oracle ne
   contiennent jamais de `null` sur un champ monétaire ; ce comportement est couvert par des
   tests TS dédiés.
3. **`cashAvailable: null`** : `cashOk` rend `null`, `issues` n'émet pas de ligne de cash. Un
   verdict inconnu n'est jamais un verdict faux.

Les chaînes produites par le moteur (`issues`, `detail` des allocations, `riskNotes`)
sortent telles quelles de l'oracle : `fmtMoney` reproduit `f"{value:,.2f}"` y compris
l'arrondi pair sur une égalité binaire exacte (`0.125 → "0.12"`, là où `toFixed` donne
`"0.13"`), `fmtNum` reproduit `f"{value:g}"` à six chiffres significatifs.

### 3.4 Vérification, deux couches

1. **`tests/oracle.test.ts`** : pour chaque `tests/oracle/*.json`,
   `expect(buildRiskReport(input.positions, input.cashAvailable)).toEqual(expected)`,
   égalité stricte, flottants compris. Les deux moteurs font les mêmes opérations IEEE 754
   dans le même ordre ; un écart est un bug du port, jamais de l'oracle.
2. **Les 115 tests Python portés un par un**, même nom, même intention, dans
   `classify.test.ts`, `analyze.test.ts`, `coverage.test.ts`. Un test dont le sujet est
   devenu un écart explicite (§3.3) est porté sur le comportement TS et renvoie à ce spec en
   commentaire.

---

## 4. `tools/coverage-oracle`

Projet uv, Python 3.14, premier code Python du dépôt.

- `engine/ib_analysis/` : copie verbatim de l'ancien module et de ses 115 tests, avec un
  shim `PortfolioItem` (attributs seulement) à la place de `ib_async`. Gelé : il ne suit
  jamais une évolution du métier TS.
- `corpus/*.json` : entrées au format `{ positions: Position[], cashAvailable }`. Une
  douzaine de portefeuilles synthétiques écrits à la main, un par famille : calls couverts par
  actions, par LEAPS, par actions et LEAPS ensemble, puts cash-secured sous et au-dessus du
  cash, iron condor sous et au-dessus de la limite, call spread, put spread, condor partiel,
  jambe protectrice au-delà du strike, short stock, vide. Plus `flex-sample.json` : les
  positions de la fixture Flex anonymisée, extraites avec le parseur TS par
  `packages/coverage/src/corpus.test.ts`, piloté par la variable `UPDATE_CORPUS`.
- `generate.py` : construit les `PortfolioItem` (expiry `YYYY-MM-DD` → `YYYYMMDD`,
  `averageCost = avgPrice × multiplier` pour une option), exécute `analyze` puis
  `build_risk_report`, écrit `packages/coverage/tests/oracle/<nom>.json` = `{ input, expected }`
  en camelCase et expiries `YYYY-MM-DD`. Les conversions sont dans le script, jamais dans le
  moteur Python.
- Script racine `pnpm oracle` : extraction du corpus Flex, puis génération. `pnpm check` ne
  lance jamais de Python : il ne fait que comparer aux JSON committés.

Le Python reste dans le dépôt tant qu'on découvre des portefeuilles hors corpus. La question
de sa suppression est reposée au sous-projet 5, quand les journaux feront évoluer le métier.

---

## 5. `packages/ib-parsers`

### 5.1 `parseFlexXml` : snapshot

Le résultat gagne `snapshot: FlexSnapshot | null` :

```ts
interface FlexSnapshot {
  /** reportDate des lignes Open Positions, YYYY-MM-DD */
  asOf: string;
  positions: Position[];
  /** endingCash USD du Cash Report, null quand absent */
  cashAvailable: number | null;
}
```

`null` quand `<OpenPositions>` manque ; l'avertissement `section-missing` « Open Positions »
existe déjà.

### 5.2 Open Positions → `Position`

| `Position` | Attribut Flex |
|---|---|
| `symbol` | `underlyingSymbol` si `assetCategory` est `OPT` ou `FOP`, sinon `symbol` |
| `secType` | `assetCategory`, tel quel ; une catégorie inconnue finit dans « Other positions » |
| `right` | `putCall` |
| `strike`, `multiplier` | nombres ou `null` |
| `expiry` | `expiry` converti en `YYYY-MM-DD` |
| `quantity` | `position`, signée (`side` est redondant et ignoré) |
| `avgPrice` | `costBasisPrice`, déjà par unité |
| `marketPrice` | `markPrice` |
| `marketValue` | `positionValue` |
| `unrealizedPnl` | `fifoPnlUnrealized` |
| `currency`, `conid`, `description` | tels quels |

Seules les lignes `levelOfDetail="SUMMARY"` sont lues : une ligne `LOT` doublerait la
quantité. `column-missing` est câblé avec le test « absent sur toutes les lignes » de Trades,
pour `position`, `markPrice`, `positionValue`, `costBasisPrice`, `fifoPnlUnrealized`,
`multiplier`, `strike`, `expiry`, `putCall`, `underlyingSymbol`.

### 5.3 Cash Report

Ligne `<CashReportCurrency currency="USD" levelOfDetail="Currency">`, attribut `endingCash` :
l'équivalent du `TotalCashBalance` USD que l'ancienne application lisait dans TWS. La ligne
`BASE_SUMMARY` est ignorée.

- Section `<CashReport>` absente : `section-missing` « Cash Report », `cashAvailable: null`.
  La section rejoint la liste des sections vérifiées par `checkSections`.
- Ligne USD absente : `currency-missing` « Cash Report USD », `cashAvailable: null`.

### 5.4 Fixtures

`flex_activity_sample.xml` régénérée par `scripts/anonymize-flex.mjs` depuis
`private/flex_<compte>_<date>.xml`, qui contient les deux nouvelles sections. Le script est
étendu aux attributs monétaires de Cash Report (tous les `*Cash*`, `deposits`, `withdrawals`,
`commissions`, `dividends`, `brokerInterest`, `netTrades*`, et plus généralement tout
attribut numérique non nul de `CashReportCurrency`). **Avant commit, vérifier à la main
qu'aucune valeur de la fixture ne se retrouve dans le fichier réel**, section par section,
comme l'exige `docs/points-reportes.md`.

Un Flex sans Cash Report et un Flex sans Open Positions sont testés sur des XML construits à
la main dans le test, pas sur la fixture.

---

## 6. `apps/web` : IndexedDB et imports

### 6.1 Schéma Dexie, version 2

| Table | Clé | Index | Contenu |
|---|---|---|---|
| `snapshots` | `accountId` | | `{ source: "flex", asOf, importedAt, positions: Position[], cashAvailable }` |
| `sectors` | `ticker` | | `name`, `category`, `score: number \| null`, `status`, `importedAt` |

Un snapshot est **un document par compte**, remplacé en bloc : pas de plan de plage, pas de
comparaison de contenu. `source` accueillera `agent` au sous-projet 4 sans migration.
`sectors` est **une table pour l'utilisateur**, jamais scopée par compte (spec fondateur
§6.7) ; elle fera partie de la sauvegarde chiffrée. Les tables 1 sont inchangées.

### 6.2 `importFile` d'un Flex

Dans la **même transaction Dexie** que les transactions et le journal d'import :

- `snapshot` présent et `asOf ≥ asOf` en base (ou pas de snapshot en base) :
  `snapshots.put`, avec `importedAt` à l'instant de l'import.
- `snapshot` présent mais plus ancien : le cache est laissé intact, le compte rendu le dit.
- `snapshot` absent : rien, l'avertissement `section-missing` figure déjà dans `issues`.

`ImportReport` (statut `ok`) et `ImportRecord` gagnent `positions: number | null` (nombre de
positions écrites, `null` si aucune n'a été lue ou si le fichier était plus ancien) et
`cashAvailable: number | null`.

### 6.3 `importSectorCsv(db, file)`

- Séparateur `;`, première ligne d'en-têtes, colonnes lues **par nom** : `Ticker`, `Name`,
  `Category`, `Score`, `Status`. `S-*` et `Last Date` ignorées. `Ticker` vide : ligne ignorée.
  `Score` vide : `null`.
- En-tête `Ticker` absent : erreur, rien n'est écrit.
- Le fichier est la table entière : `clear` puis `bulkPut` dans une transaction, `importedAt`
  identique sur toutes les lignes.
- Compte rendu : `{ status: "ok", tickers: number }` ou `{ status: "error", detail }`.

### 6.4 Hooks

- `useSnapshot(accountId)` : `undefined` en chargement, `null` sans snapshot.
- `useSectors()` : `Map<ticker, SectorRecord>`.
- `useRiskReport(accountId)` : mémoïse `buildRiskReport(snapshot.positions, snapshot.cashAvailable)`
  sur le snapshot live et rend `{ snapshot, report, sectorOf(symbol): string | null }`. Le
  secteur est joint dans la page ; le moteur n'en sait rien. Un ticker absent de la table
  rend `null` et la cellule reste vide, comme avant.

### 6.5 Graine du skill `run-frontend`

`--seed` sème aussi un snapshot d'une dizaine de positions couvrant chaque famille de
couverture et quelques secteurs, pour que les captures des deux pages montrent quelque chose.

---

## 7. `apps/web` : pages

### 7.1 Copié de l'ancien frontend

`PositionsPage.tsx`, `DashboardPage.tsx`, leurs tests, `lib/riskReport.ts` réduit à
`decisionBadge` et `coverageBadges` (choix de présentation ; le reste vient de
`@ib/coverage`), les clés i18n `positions.*` et `dashboard.*`, et `echarts` /
`echarts-for-react` ajoutés aux dépendances pour la jauge. Champs renommés en camelCase.
Le rendu reste identique à la maquette.

### 7.2 Les trois différences

1. **Pas de bouton Actualiser.** Il revient avec l'agent.
2. **Le badge « Données du {{date}} » est toujours affiché**, avec `asOf` : Flex date de la
   veille par construction.
3. **État vide** : « Aucune position, importez un fichier Flex avec Open Positions » et un
   lien vers Sources de données, sous forme de `<Link>` avec `buttonVariants`
   (`points-reportes.md`, sans échéance). Plus d'état d'erreur réseau : la lecture Dexie
   n'échoue pas en fonctionnement normal.

### 7.3 Dashboard

Carte « Cash headroom » : jauge disponible sur requis, cases Cash requis (puts cash-secured
plus assignation des iron condors) et Cash disponible (`endingCash` USD de la veille), badge
« Couvert » ou « Cash insuffisant ». Avec `cashAvailable: null` : jauge masquée, « — » dans
la case Disponible, badge neutre « Cash inconnu ». La carte des positions non couvertes ne
dépend pas du cash.

### 7.4 Sources de données

- Nouvelle carte « Table sectorielle » : import CSV, nombre de tickers, date du dernier
  import (`max(importedAt)`), message d'erreur du compte rendu.
- `ImportReportCard` affiche positions écrites et cash disponible lus quand ils existent, et
  la mention « positions ignorées, fichier plus ancien que le cache » le cas échéant.
- Le journal des imports montre le nombre de positions dans sa colonne lignes, sous la
  forme « 306 + 30 positions ».

### 7.5 Documentation

- `CLAUDE.md` : statut du sous-projet 2, 115 tests, `Position` dans `ledger`, `pnpm oracle`,
  `tools/coverage-oracle` comme premier projet uv.
- Spec fondateur §6.4 et §14 : 115 tests. Rien d'autre n'y est rouvert.
- `docs/points-reportes.md` : entrées du sous-projet 2 soldées ou déplacées, dont
  `column-missing` désormais câblé sur Open Positions mais toujours pas sur les sections
  de cash.

---

## 8. Tests et acceptation

### 8.1 Automatique, `pnpm check`

- `coverage` : oracle strict sur chaque fixture, 115 tests portés, tests des trois écarts
  (§3.3), tests de `fmtMoney` et `fmtNum` sur les cas d'arrondi.
- `ib-parsers` : snapshot sur la fixture régénérée (30 positions, 24 options, 6 actions,
  cash USD présent), Flex sans Cash Report, sans Open Positions, ligne `LOT` ignorée,
  `column-missing` sur Open Positions.
- `apps/web` : `importFile` écrit le snapshot dans la même transaction, refuse un fichier
  plus ancien, `importSectorCsv` remplace la table, pages Positions et Dashboard sur
  `fake-indexeddb` avec snapshot et secteurs semés, jamais en moquant les hooks : groupes,
  badges de couverture, décision, secteur, jauge, cas `cashAvailable: null`, état vide.
- Aucune constante métier hors de `coverage` : un test grep le vérifie sur `apps/web`.

### 8.2 Manuel, sur données réelles

Importer le Flex réel de `beta` du 2026-09-03 et comparer avec l'ancienne application
lancée le même jour : mêmes positions, mêmes verdicts de couverture, même cash requis,
mêmes positions non couvertes. Les prix et le P&L diffèrent (intraday contre clôture de la
veille), les verdicts de couverture ne doivent pas. Le cash disponible Flex doit être proche
du `TotalCashBalance` USD de TWS, l'écart étant les mouvements du jour.

---

## 9. Décisions prises pendant le brainstorming

| Décision | Raison |
|---|---|
| Cash disponible depuis la section Cash Report de la Flex Query | Cohérent avec les positions du même fichier ; le ledger ne réconcilie pas sur tous les comptes |
| Table sectorielle : colonne Secteur seulement | Les agrégations par secteur ont besoin de l'appariement des primes, sous-projet 5 |
| Port hybride : moteur interne mutable, sortie JSON plate | Port ligne à ligne fidèle à l'oracle, sortie sérialisable pour le cache et les pages |
| Oracle Python gardé gelé dans le dépôt, jamais lancé par `pnpm check` | Régénérable pour un portefeuille hors corpus ; suppression à reconsidérer au sous-projet 5 |
| `Position` dans `ledger`, pas dans `coverage` | `ib-parsers` dépend déjà de `ledger` ; un parseur n'a pas à dépendre du moteur |
| `avgPrice` par unité dans `Position` | Flex le donne ainsi ; la division TWS appartient à l'adaptateur agent |
| Snapshot : un document par compte, remplacé si `asOf` égal ou plus récent | Pas de plage à gérer, écriture atomique, réimport idempotent |
| `label` reste en anglais, tel que le Python le produit | Rendu identique à la maquette ; traduire est un choix de présentation à faire plus tard s'il le faut |
