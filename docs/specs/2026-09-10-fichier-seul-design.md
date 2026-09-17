# Sous-projet 9 — L'application complète avec un seul fichier

Statut : implémenté (2026-09-11).

Un utilisateur qui découvre l'application avec un seul relevé HTML voit son Historique et ses
Journaux, mais Positions et Dashboard restent vides, la carte de cohérence des Journaux dit
« aucun snapshot » et le solde cumulé de l'Historique part de 0, loin du cash de TWS. Le
relevé porte pourtant tout ce qu'il faut : ses sections *Open Positions* et *Cash Report*
donnent exactement ce que Flex donne. Ce sous-projet les lit, cale le solde cumulé sur le cash
de fin et vérifie qu'il retombe sur le cash de début, comme la carte de cohérence vérifie le
portefeuille reconstitué.

Trois scénarios doivent être complets : **relevé HTML seul**, **Flex seul**, **relevé HTML et
Flex**. L'agent local seul ne l'est jamais : il n'importe pas d'historique.

---

## 1. Périmètre

Dans le périmètre :

- les positions et le cash disponible lus dans le relevé HTML, écrits comme snapshot du compte
  selon les mêmes règles qu'un snapshot Flex ;
- le Cash Report des deux formats de fichier, par devise, en deux points : *Starting Cash* au
  début de la période, *Ending Cash* à la fin ;
- le solde cumulé de l'Historique calé sur le point de fin le plus récent, et vérifié contre le
  point de début le plus ancien, dans une carte « Cohérence du cash » ;
- l'option `--empty` du driver `run-frontend`, pour capturer les trois scénarios dans la vraie
  application.

Hors périmètre, déclaré tel :

- **reconstituer les positions de départ d'un historique tronqué** (quantités « Prior » du *MTM
  Performance Summary*) : écarté à la conception. Un historique qui ne remonte pas à l'ouverture
  continue de produire des orphelins et des écarts, et la carte de cohérence continue de le dire ;
- **dériver les positions du ledger** : le §13 du spec d'architecture n'est pas rouvert. Ce
  sous-projet *lit* les positions dans un fichier IB, il ne les calcule pas ;
- **le calage du cash par l'agent** : seuls les fichiers écrivent des points de cash ;
- **une vérification période par période** (chaque relevé contre son propre Cash Report) : seuls
  le début le plus ancien et la fin la plus récente sont comparés ;
- **l'identité des options sans Flex** (§2.5) : une option que les relevés nomment par son
  sous-jacent reste sous l'ancien nom quand elle est ajustée ou que son sous-jacent est converti.
  Dette du sous-projet 7, traitée au **sous-projet 10** ; ici, ses écarts sont figés par l'oracle ;
- **corriger l'anonymiseur des relevés** pour l'EUR (§2.3) ;
- `packages/coverage`, le serveur, l'agent, le déploiement : rien n'y touche.

---

## 2. Ce que disent les données

### 2.1 Le relevé porte positions et cash

Les six relevés réels de `private/` (2022 à 2026) ont tous les deux sections :

- ***Open Positions*** : colonnes `Symbol | Quantity | Mult | Cost Price | Cost Basis | Close Price
  | Value | Unrealized P/L | Code`, blocs par catégorie d'actif (`Stocks`, `Equity and Index
  Options`, `Warrants`) et par devise (`USD`, et `EUR` en 2024), lignes `subtotal` et `total`. Les
  lignes de données sont sans classe ou de classe `row-summary no-details` ; aucune ligne de
  détail par lot n'a été observée. Une option s'écrit comme dans *Transactions* :
  `TESTX 16JAN26 15 P`.
- ***Cash Report*** : colonnes `(vide) | Total | Securities | Futures`, blocs `header-currency`
  « Base Currency Summary », puis un par devise (`EUR`, `USD`), lignes libellées *Starting Cash*,
  *Ending Cash*, *Ending Settled Cash* et les mouvements entre les deux, indentés d'espaces
  insécables.

*Cost Price* est unitaire, comme `Position.avgPrice` l'exige : quantité × *Mult* × *Cost Price*
redonne le *Cost Basis* affiché, vérifié sur une option du relevé 2025.

### 2.2 Le ledger retrouve le cash d'IB

Mesure faite sur les relevés réels de alpha, parsés par `parseActivityStatement` : pour chaque
relevé, la somme des `cashImpact` de ses lignes (`runningBalances`) contre *Ending Cash −
Starting Cash* de son propre Cash Report.

| Relevé | Écart USD | Écart EUR |
|---|---|---|
| 2022 (ouverture du compte, Starting Cash nul) | 0,00 | 0,00 |
| 2023 | −0,07 | +0,01 |
| 2024 | 0,00 | 0,00 |
| 2025 | −0,12 | +0,10 |
| 2026-01-01 → 2026-09-09 | +0,13 | 0,00 |
| Cumul des cinq, contre l'*Ending Cash* 2026 | −0,06 | +0,11 |

Les écarts résiduels viennent des montants arrondis au centime dans le HTML. Flex donne des
montants à pleine précision (`endingCash` à sept décimales) : beta, dont la réponse Flex couvre
l'ouverture du compte (`startingCash="0"`), doit retrouver son cash au centime.

### 2.3 Les fixtures anonymisées

`statement_ca_corpus_202{2,3,4}.htm` portent *Open Positions* (23, 34, 41 lignes) et *Cash
Report*. La même mesure y donne **USD cohérent** (−0,10, −0,05, +0,08) et **EUR incohérent**
(écarts de plusieurs milliers) : l'anonymiseur réécrit des montants EUR du ledger sans réécrire
le Cash Report de la même façon. Les fixtures sont un oracle USD, jamais EUR.

`flex_activity_sample.xml` porte trois `CashReportCurrency` : `BASE_SUMMARY`, `EUR`, `USD`, avec
`startingCash` et `endingCash`.

### 2.4 Flex sans Cash Report

La Flex Query de alpha n'a pas de section Cash Report. Ses synchros quotidiennes n'apportent
donc aucun point de cash, et un calage venu d'un relevé doit leur survivre (§4.2).

### 2.5 Relevés seuls : quatre écarts de portefeuille

Rejeu de tous les relevés de alpha, sans Flex, contre les Open Positions du plus récent lues
selon le §3.2 : **4 écarts et 1 orphelin**, deux paires de signes opposés, chaque fois une option
que le relevé nomme par son sous-jacent et qui change de nom en cours de vie :

- une option ajustée par un spin-off, nommée `X` à l'ouverture et `X1` à l'expiration, sous un
  seul conid ; le *Contract Information* donne bien les deux formes empaquetées, mais les lignes
  de *Transactions* ne les portent pas ;
- une option ouverte avant la fusion 1 pour 1 de son sous-jacent et rachetée après, sous le
  nouveau ticker ; aucun relevé ne porte l'ancienne forme empaquetée.

Avec la réponse Flex en plus, qui écrit la forme empaquetée, la règle 7 du §5.2 du spec du
sous-projet 7 referme les deux cas et le test privé existant garde zéro écart. C'est la dette
« une option nommée par son sous-jacent — ce que donnent l'agent et les relevés — reste sous
l'ancien nom » de `points-reportes.md`. Positions, Dashboard, Historique et le cash n'en sont pas
affectés.

**Refermé par le sous-projet 10 (2026-09-16).** La reconstruction de la forme OSI depuis les
termes d'une transaction (`packedOptionSymbol`) referme le premier cas, et la règle 9 — la
conversion 1 pour 1 du sous-jacent greffe l'ancienne orthographe sur la classe du nouveau
ticker, sur preuve qu'elle existe — referme le second : relevés seuls, `alpha.private.test.ts`
retombe à zéro écart, comme avec Flex.

---

## 3. Parseurs (`packages/ib-parsers`)

### 3.1 Types partagés

Un nouveau module `src/snapshot.ts`, ré-exporté par `index.ts` :

```ts
/** Positions and USD cash of one file, as of the close of `asOf`. */
export interface FileSnapshot {
  /** YYYY-MM-DD */
  asOf: string;
  positions: Position[];
  /** USD Ending Cash: TWS's TotalCashBalance at the close. */
  cashAvailable: number | null;
}

export interface CashPointValues {
  /** YYYY-MM-DD */
  asOf: string;
  /** Per three-letter currency code; a currency the report does not list is absent. */
  balances: Record<string, number>;
}

/** Starting Cash at the start of the file's period, Ending Cash at its end. */
export interface CashReport {
  start: CashPointValues;
  end: CashPointValues;
}
```

`FlexSnapshot` (utilisé seulement dans `flex.ts`) est remplacé par `FileSnapshot`.
`FlexParseResult` gagne `cashReport: CashReport | null` ; `StatementParseResult` gagne
`snapshot: FileSnapshot | null` et `cashReport: CashReport | null`. Tout retour d'erreur les met
à `null`.

### 3.2 *Open Positions* du relevé

`readSection(ctx, "OpenPositions", false)`. Section absente : `snapshot: null` et avertissement
`section-missing` « Open Positions ».

`readSection` apprend à ne garder, **pour cette section seulement**, que les lignes sans classe
ou portant la classe `row-summary` : une ligne de détail par lot répète une partie de la
quantité de sa ligne de synthèse, comme une ligne `LOT` Flex. Les autres sections gardent leur
comportement.

| `Position` | Relevé |
|---|---|
| `symbol` | `splitOptionSymbol(Symbol).symbol` : le sous-jacent pour une option, le titre sinon |
| `secType` | `secTypeOf(catégorie)` : `STK`, `OPT`, `WAR`, ou la catégorie brute avec `unknown-asset-category` |
| `right`, `strike`, `expiry` | `splitOptionSymbol(Symbol)` |
| `multiplier` | `Mult` |
| `quantity` | `Quantity`, signée |
| `avgPrice` | `Cost Price`, unitaire |
| `marketPrice` | `Close Price` |
| `marketValue` | `Value` |
| `unrealizedPnl` | `Unrealized P/L` |
| `currency` | le bloc `header-currency` en cours |
| `conid` | `""` : la section n'en donne pas |
| `description` | la cellule `Symbol` telle quelle |

`column-missing` est câblé sur `Symbol`, `Quantity`, `Mult`, `Cost Price`, `Close Price`, `Value`
et `Unrealized P/L`.

Une ligne illisible — quantité absente ou non numérique, option de catégorie `OPT` dont
`splitOptionSymbol` ne reconnaît pas le contrat, nombre de cellules inattendu — rend
`snapshot: null` avec un avertissement `row-skipped`, **sans** faire échouer le fichier : un
snapshot amputé d'une jambe est pire que pas de snapshot (même règle que `parseSnapshot` côté
Flex).

`asOf` = `periodEnd`. `cashAvailable` = `cashReport?.end.balances.USD ?? null`.

Une section présente mais sans aucune ligne de données rend un snapshot à `positions: []` : le
compte ne détenait rien.

### 3.3 *Cash Report* du relevé

`readSection(ctx, "CashReport", false)`. Le libellé d'une ligne est la cellule de la première
colonne (en-tête vide), débarrassée de ses espaces insécables ; le montant, la colonne `Total`.

- seuls les blocs dont l'en-tête est un code à trois lettres majuscules (`^[A-Z]{3}$`) sont lus :
  « Base Currency Summary » est ignoré ;
- *Starting Cash* va dans `start.balances[devise]`, *Ending Cash* dans `end.balances[devise]` ;
  *Ending Settled Cash* et les mouvements sont ignorés ;
- un bloc de devise auquel manque l'un des deux libellés est ignoré entier, avec un avertissement
  `row-skipped` : un point de début sans point de fin ne se vérifie pas ;
- `start.asOf` = `periodStart`, `end.asOf` = `periodEnd` ;
- section absente, ou aucune devise lisible : `cashReport: null`, sans avertissement de plus que
  ceux déjà émis.

### 3.4 *Cash Report* Flex

Les `CashReportCurrency` de `levelOfDetail="Currency"` dont `currency` est un code à trois lettres
(`BASE_SUMMARY` est ignoré) : `startingCash` et `endingCash`, avec la même règle d'un bloc
incomplet. `start.asOf` = `fromDate`, `end.asOf` = `toDate` de l'en-tête de la réponse. Section
absente : `cashReport: null` ; `checkSections` signale déjà l'absence. `parseCashReport`, qui
alimente `cashAvailable`, ne change pas.

---

## 4. Stockage (`apps/web/src/db`)

### 4.1 Snapshot

`SnapshotRecord.source` devient `"flex" | "statement_html" | "agent"`. Le champ n'est pas indexé :
aucune migration. Le commentaire de `asOf` dit « Flex ou relevé : jour de la clôture ».

**Import** (`importFile.ts`) : le snapshot d'un relevé suit le chemin de celui d'un Flex, avec
`shouldReplaceSnapshot(current, { source, asOf })` et `source` réel dans l'enregistrement. Un
fichier remplace le snapshot courant si son `asOf` atteint le jour du courant ; à égalité, le
dernier importé l'emporte. `ImportRecord.positions` et `cashAvailable` sont renseignés pour un
relevé exactement comme pour un Flex, et `staleSnapshot` aussi.

**« Relire les relevés » et suppression d'un relevé** (`replayStatements.ts`) : la transaction
couvre en plus `snapshots` et `cashPoints`. Soit `S` le snapshot du relevé restant de plus grand
`periodEnd` qui en porte un (le dernier dans l'ordre de relecture à égalité) :

- snapshot courant absent ou de source `statement_html` : il est remplacé par `S`, ou supprimé
  s'il n'y a pas de `S` ;
- snapshot courant `flex` ou `agent` : remplacé par `S` seulement si `shouldReplaceSnapshot`
  l'accepte.

L'`ImportRecord` du relevé qui a fourni le snapshot écrit porte `positions` et `cashAvailable` ;
ceux des autres relevés portent `null`.

**« Supprimer les transactions »** (`clearDerived.ts`) purge le snapshot comme aujourd'hui ; la
relecture le rétablit désormais. Son commentaire est réécrit.

### 4.2 Points de cash

Nouvelle table, version Dexie 6, purement additive :

```ts
export interface CashPointRecord {
  accountId: string;
  currency: string;
  kind: "start" | "end";
  /** YYYY-MM-DD */
  asOf: string;
  amount: number;
  source: "flex" | "statement_html";
  importedAt: string;
}
// this.version(6).stores({ cashPoints: "[accountId+currency+kind], accountId" });
```

Règle de fusion, pure, dans `db/cashPoints.ts` :
`mergeCashPoints(accountId, current, report, source, at): CashPointRecord[]` rend les
enregistrements à écrire.

- **point de fin** d'une devise : remplacé si `report.end.asOf >= courant.asOf` — le plus récent
  gagne, c'est le calage ;
- **point de début** d'une devise : remplacé si `report.start.asOf <= courant.asOf` — le plus
  ancien gagne, c'est la vérification. Un Flex dont la fenêtre avance chaque jour ne l'écrase
  pas : les lignes de ses synchros précédentes restent dans le ledger ;
- à égalité, le fichier entrant l'emporte ;
- une devise absente du rapport entrant garde ses points : un point ancien reste vrai à sa date.

Écrivains : `importFile` (les deux formats, dans sa transaction existante, qui gagne la table),
et `replayStatements`, qui supprime les points de source `statement_html` du compte puis fusionne
les relevés restants dans l'ordre de relecture, par-dessus les points Flex conservés. **L'agent
n'en écrit jamais.**

`clearDerived` purge aussi `cashPoints` et son `ClearDerivedReport` gagne `cashPoints: number` ;
le message de la page nomme les points de cash sans les chiffrer, comme les positions.
`deleteAccount` supprime les points du compte.

### 4.3 Hooks

`useCashPoints(accountId): CashPointRecord[] | undefined`, requête vivante sur `cashPoints`.

### 4.4 Graine de démonstration

`mocks/seed.ts` sème, pour chaque compte de démo, des points de début et de fin cohérents avec son
petit ledger, pour que `--seed` montre la carte « Cohérence du cash » à l'état OK.

---

## 5. Calcul (`packages/ledger/src/cash.ts`)

```ts
export const CASH_CHECK_TOLERANCE = 10;

export interface CashPoint {
  currency: string;
  kind: "start" | "end";
  /** YYYY-MM-DD */
  asOf: string;
  amount: number;
}

export interface CashCheck {
  currency: string;
  /** Added to every raw balance of this currency; 0 without an end point. */
  offset: number;
  end: { asOf: string; amount: number } | null;
  /** `balance` is the anchored balance at the close of the day before `asOf`. */
  start: { asOf: string; amount: number; balance: number; gap: number } | null;
}

export function anchoredBalances(
  transactions: readonly Transaction[],
  currencies: readonly string[],
  points: readonly CashPoint[],
): { rows: LedgerRow[]; checks: CashCheck[] };

export function isCashCheckOk(check: CashCheck): boolean | null;
```

- `rows` part de `runningBalances(transactions, currencies)`, inchangée et toujours exportée ;
- `brut(devise, prédicat)` = solde brut après la dernière ligne, dans l'ordre de référence, dont
  `dayOf(when)` satisfait le prédicat ; 0 s'il n'y en a aucune. Les `when` sont des heures
  murales estampillées UTC (`common.ts`) : `dayOf` rend le jour de la place, pour les deux sources ;
- point de fin présent : `offset = amount − brut(devise, jour ≤ asOf)`, ajouté au solde de cette
  devise sur **toutes** les lignes ;
- point de début présent : `balance = brut(devise, jour < asOf) + offset`,
  `gap = arrondi au centime(balance − amount)`. On mesure à la veille du point de début et non
  avant la première ligne : des lignes plus anciennes sans fichier (relevés importés avant la
  version 4 du schéma) ne faussent pas la mesure ;
- un point de début sans point de fin (impossible depuis un fichier, défini quand même) se vérifie
  sur le brut, `offset = 0` ;
- une devise demandée sans point : `offset = 0`, `end = start = null` ;
- `isCashCheckOk` : `null` sans point de début, sinon `|gap| ≤ CASH_CHECK_TOLERANCE`.

`CASH_CHECK_TOLERANCE` n'est défini qu'ici, jamais recodé ailleurs. Il absorbe les arrondis au
centime des relevés HTML (§2.2).

---

## 6. Pages

### 6.1 Historique

`HistoryPage` remplace `runningBalances(ledger, BALANCE_CURRENCIES)` par
`anchoredBalances(ledger, BALANCE_CURRENCIES, points)`, les points venant de `useCashPoints`.

Une carte **« Cohérence du cash »** (`components/CashCheckCard.tsx`), au-dessus de la table, une
ligne par devise de `BALANCE_CURRENCIES`, sur le modèle de `ReconciliationCard` :

- **OK** (`isCashCheckOk` vrai) : badge `success`, « USD : solde calé sur le cash de fin du
  {end.asOf}, retrouvé au {start.asOf} (Starting Cash {amount}) à {gap} près » ;
- **écart** (`isCashCheckOk` faux) : badge `warning` portant l'écart signé, mêmes dates et
  montants, et l'indice « Un historique incomplet, ou un relevé qui finit après la dernière
  synchro Flex, suffit à l'expliquer » ;
- **sans calage** (`end === null`) : badge `outline`, « USD : aucun Cash Report, le solde part de
  0 », l'indice « Ajoutez la section Cash Report à la Flex Query, ou importez un relevé HTML » et
  un lien vers Sources de données ;
- **calé sans vérification** (`end` présent, `start` absent — après la suppression du relevé qui
  portait le point de début) : badge `outline` portant la devise, « USD : solde calé sur le cash
  de fin du {end.asOf} ({amount}), début non vérifié ».

Les montants passent par `formatAmount`, sans symbole : le code devise ouvre chaque ligne.
`history.columns.balanceHint` est réécrit : le solde est calé sur le cash de fin quand un fichier
en porte un, et la carte dit ce qu'il en est. Clés i18n `cashCheck.*` en français et en anglais.

### 6.2 Positions, Dashboard, Journaux

Aucun changement de code : ils lisent le snapshot. `SnapshotStatus` affiche la date pour toute
source autre que l'agent. Les textes changent :

- `positions.empty` : « Aucune position — importez un relevé HTML ou une réponse de Flex Query
  avec Open Positions. » ;
- `reconciliation.none` : « Aucun snapshot de positions : importez un relevé HTML ou une réponse
  Flex, ou lancez l'agent. »

### 6.3 Sources de données

`sources.import.hint` dit qu'un relevé apporte aussi positions et cash. Le compte rendu de purge
compte les points de cash. `ImportReportCard` affiche déjà positions et cash quand ils existent.

---

## 7. Tests

### 7.1 Unitaires

- **`ib-parsers`**, relevé construit : ligne d'action, ligne d'option, bloc EUR, ligne de détail
  par lot ignorée, ligne illisible (snapshot `null`, avertissement, transactions intactes),
  section *Open Positions* absente, section vide (`positions: []`), `column-missing`. Cash Report
  construit : « Base Currency Summary » ignoré, deux devises, bloc incomplet ignoré, section
  absente. Corpus `statement_ca_corpus_202{2,3,4}.htm` : nombre de positions (23, 34, 41) et
  points de cash lus.
- **`ib-parsers`**, Flex : `cashReport` sur `flex_activity_sample.xml` (EUR et USD, `BASE_SUMMARY`
  ignoré), Flex sans Cash Report.
- **`ledger`**, `anchoredBalances` : décalage appliqué à toutes les lignes ; écart au début ;
  devise sans point ; ligne datée du jour du point de fin incluse, du jour du point de début
  exclue ; lignes antérieures au point de début ; début sans fin ; conversion de devises ;
  `isCashCheckOk` aux trois états et à la frontière de la tolérance.
- **`apps/web`**, sur `fake-indexeddb` avec des données semées, jamais en moquant les hooks :
  `mergeCashPoints` ; import d'un relevé qui écrit snapshot et points ; relevé plus ancien que le
  snapshot Flex (`staleSnapshot`) ; Flex sans Cash Report qui garde les points du relevé ;
  relecture qui remplace ou supprime un snapshot de relevé et laisse un snapshot Flex ; relecture
  après suppression du relevé le plus récent ; `clearDerived` et `deleteAccount` qui purgent les
  points ; version 6 du schéma sur une base en version 5 ; `PositionsPage` rendue depuis un
  snapshot de relevé ; `CashCheckCard` aux trois états ; `HistoryPage` qui affiche les soldes
  calés.

### 7.2 Oracles

- **Versionné** : les trois relevés du corpus importés dans l'ordre, **écart USD au début ≤
  `CASH_CHECK_TOLERANCE`** contre le *Starting Cash* 2022. L'EUR n'est pas vérifié (§2.3).
- **Privés** (`*.private.test.ts`, sautés quand les fichiers manquent, sans nom de fichier réel
  écrit dans le dépôt) :
  - **alpha, relevés seuls** : portefeuille reconstitué contre le snapshot du relevé le plus
    récent, **les écarts du §2.5 figés** — exactement 4 différences et 1 orphelin, chaque
    différence à `snapshotQty = 0`, leurs `ledgerQty` de somme nulle —, sans écrire de ticker
    réel dans le dépôt ; le test échoue si la liste change, dans un sens comme dans l'autre, et
    le sous-projet 10 le fera passer à zéro. Écart de cash au début ≤ tolérance en USD et en
    EUR, contre un *Starting Cash* de 0 ;
  - **alpha, relevé le plus récent seul** : snapshot présent ; pour chaque devise, l'écart au
    début égale, à la tolérance près, le solde brut des lignes datées avant le point de début, et
    au moins une devise est en écart (limite du §10) ;
  - **alpha, relevés puis Flex** : le test existant garde zéro écart et zéro orphelin, quel que
    soit le snapshot retenu ;
  - **beta, Flex seul** : écart au début **nul au centime** en USD.

---

## 8. Outillage

Le driver `.claude/skills/run-frontend/driver.mjs` gagne `--empty` : les deux comptes de démo
sont créés sans ledger, snapshot, points de cash, relevés ni secteurs. Combiné à `--ib-account=`
et `--import=`, il reproduit la première visite d'un utilisateur. `--import=` accepte d'être
répété, dans l'ordre donné, pour le scénario relevé et Flex. `SKILL.md` documente les deux.

Vérification finale dans la vraie application, captures lues une à une : Dashboard, Positions,
Historique, Journal Wheel et Sources de données, pour les trois scénarios.

---

## 9. Documentation

- **CLAUDE.md** :
  - lignes 9 (ce sous-projet) et 10 (« Identité des options sans Flex », à faire) du tableau des
    sous-projets ;
  - règle « Supprimer les transactions » : le snapshot revient aussi par « Relire les relevés » ;
    `cashPoints` purgé ;
  - nouvelles règles : un relevé porte un snapshot à sa fin de période, soumis aux règles de
    remplacement des fichiers ; les points de cash (fin la plus récente, début le plus ancien,
    jamais écrits par l'agent) ; `CASH_CHECK_TOLERANCE` dans la liste des constantes métier ;
  - oracle de réconciliation : beta retrouve son *Starting Cash* au centime, et alpha, dont
    les relevés remontent à l'ouverture, réconcilie désormais à la tolérance près ;
  - `--empty` et `--import=` répétable dans le paragraphe Outillage.
- **Spec d'architecture, §2** : note datée du 2026-09-10 — un relevé HTML seul donne historique,
  positions et couverture à sa fin de période, journaux et solde cumulé calé ; Open Positions se
  lit aussi dans le relevé. Le §13 n'est pas modifié.
- **`docs/points-reportes.md`**, section du sous-projet 9 : les limites du §10, avec en tête la
  dette des options renommées sans Flex (§2.5), renvoyée au sous-projet 10 et liée à l'entrée
  existante du sous-projet 7.

---

## 10. Limites connues

- **Relevés seuls, une option renommée en cours de vie ouvre un écart de portefeuille** (§2.5) :
  la carte de cohérence des Journaux de alpha affiche 4 écarts sans Flex. Sous-projet 10.
- **Un relevé seul qui porte des corrections antidatées montre un écart de cash au début.** IB
  compte une correction tardive dans le Cash Report de la période qui la rapporte, mais la date
  du jour qu'elle corrige ; la mesure à la veille du point de début (§5) la range avant le début.
  Ni l'ignorer à l'import (le relevé précédent ne la porte pas) ni mesurer avant la première
  ligne (qui fausserait relevé + Flex) ne corrige le cas ; il faudrait la date de
  comptabilisation, que le relevé ne donne pas.
- **Un relevé qui finit après le dernier jour Flex**, importé ou relu alors que des lignes Flex
  sont déjà en base, n'écrit pas les lignes de ses derniers jours (un relevé n'écrit qu'avant la
  plage Flex), alors que son point de fin les compte. Le décalage les absorbe et la carte montre
  un écart jusqu'à la synchro Flex qui les apporte. Transitoire : au plus un jour avec la synchro
  automatique. Importé avant le Flex, le relevé garde ces lignes et la limite ne se voit pas.
- **Un compte sans aucune position** dont le relevé omet la section *Open Positions* n'a pas de
  snapshot : Positions reste à l'état vide au lieu d'afficher un portefeuille vide.
- **« Relire les relevés » peut remplacer un snapshot Flex du même jour** par celui du relevé :
  même clôture, mêmes positions, `conid` vides. Aucun code ne lit `Position.conid` aujourd'hui.
- **Les fixtures anonymisées ont un EUR incohérent** (§2.3) : aucun oracle EUR versionné.
